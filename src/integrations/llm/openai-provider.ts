import { z, ZodError } from "zod";
import { AppError } from "../../utils/app-error.js";
import type { LlmCompletion, LlmCompletionRequest, LlmProvider } from "./llm-provider.js";

type FetchLike = typeof fetch;

const MAX_ATTEMPTS = 3;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RETRY_DELAY_MS = 60_000;

const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().max(200_000).nullable(),
        }),
      }),
    )
    .min(1),
  usage: usageSchema.optional(),
});

const messageSchema = z
  .object({
    role: z.enum(["system", "user"]),
    content: z.string().min(1).max(200_000),
  })
  .strict();

export type OpenAiProviderDeps = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (info: { statusCode: number; attempt: number; delayMs: number }) => void;
};

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function retryDelayMs(response: Response, attempt: number, now: number): number | "too-long" {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null && retryAfter.trim() !== "") {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const delayMs = seconds * 1000;
      return delayMs > MAX_RETRY_DELAY_MS ? "too-long" : delayMs;
    }
    const when = Date.parse(retryAfter);
    if (Number.isFinite(when)) {
      const delayMs = Math.max(0, when - now);
      return delayMs > MAX_RETRY_DELAY_MS ? "too-long" : delayMs;
    }
  }
  return Math.min(200 * 2 ** (attempt - 1), 5_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function statusError(status: number): AppError {
  if (status === 401) {
    return new AppError({
      message: "LLM 인증에 실패했습니다.",
      code: "LLM_UNAUTHORIZED",
      statusCode: 401,
      expose: false,
    });
  }
  if (status === 403) {
    return new AppError({
      message: "LLM 호출 권한이 없습니다.",
      code: "LLM_FORBIDDEN",
      statusCode: 403,
      expose: false,
    });
  }
  if (status === 429) {
    return new AppError({
      message: "LLM 사용량 제한으로 요청을 중단했습니다.",
      code: "LLM_RATE_LIMIT",
      statusCode: 429,
      retryable: true,
      expose: false,
    });
  }
  if (status === 502 || status === 503 || status === 504) {
    return new AppError({
      message: "LLM 공급자를 일시적으로 사용할 수 없습니다.",
      code: "LLM_UNAVAILABLE",
      statusCode: status,
      retryable: true,
      expose: false,
    });
  }
  return new AppError({
    message: "LLM 공급자가 요청을 거부했습니다.",
    code: "LLM_BAD_RESPONSE",
    statusCode: 502,
    expose: false,
  });
}

async function readLimitedBody(response: Response): Promise<string> {
  const payload = await response.arrayBuffer();
  if (payload.byteLength > MAX_RESPONSE_BYTES) {
    throw new AppError({
      message: "LLM 응답이 너무 큽니다.",
      code: "LLM_RESPONSE_TOO_LARGE",
      statusCode: 502,
      expose: false,
    });
  }
  return new TextDecoder().decode(payload);
}

export function createOpenAiCompatibleProvider(deps: OpenAiProviderDeps): LlmProvider {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const endpoint = `${deps.baseUrl}/v1/chat/completions`;

  return {
    async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
      if (deps.apiKey.trim().length === 0) {
        throw new AppError({
          message: "LLM API 키가 없습니다.",
          code: "LLM_UNAUTHORIZED",
          statusCode: 401,
          expose: false,
        });
      }

      let messages: z.infer<typeof messageSchema>[];
      try {
        messages = z.array(messageSchema).min(1).max(8).parse(request.messages);
      } catch (error) {
        throw new AppError({
          message: "LLM 요청 형식이 올바르지 않습니다.",
          code: "LLM_BAD_REQUEST",
          statusCode: 400,
          expose: false,
          cause: error,
        });
      }
      const body = JSON.stringify({
        model: deps.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages,
      });

      let lastTimeout = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const timeoutSignal = AbortSignal.timeout(deps.timeoutMs);
        const callerSignal = request.signal;
        const signal = callerSignal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, callerSignal]);

        try {
          const response = await fetchImpl(endpoint, {
            method: "POST",
            redirect: "manual",
            signal,
            headers: {
              accept: "application/json",
              "content-type": "application/json",
              authorization: `Bearer ${deps.apiKey}`,
            },
            body,
          });

          if (response.status >= 300 && response.status < 400) {
            await response.arrayBuffer().catch(() => undefined);
            throw new AppError({
              message: "LLM 공급자가 예상하지 않은 리다이렉트를 반환했습니다.",
              code: "LLM_UNEXPECTED_REDIRECT",
              statusCode: 502,
              expose: false,
            });
          }

          if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS) {
            const delayMs = retryDelayMs(response, attempt, now());
            await response.arrayBuffer().catch(() => undefined);
            if (delayMs === "too-long") {
              throw new AppError({
                message: "LLM 사용량 제한으로 요청을 중단했습니다.",
                code: "LLM_RATE_LIMIT",
                statusCode: 429,
                retryable: true,
                expose: false,
              });
            }
            deps.onRetry?.({ statusCode: response.status, attempt, delayMs });
            await sleep(delayMs);
            continue;
          }

          if (!response.ok) {
            await response.arrayBuffer().catch(() => undefined);
            throw statusError(response.status);
          }

          const text = await readLimitedBody(response);
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch (error) {
            throw new AppError({
              message: "LLM 응답을 JSON으로 읽지 못했습니다.",
              code: "LLM_BAD_RESPONSE",
              statusCode: 502,
              expose: false,
              cause: error,
            });
          }

          const completion = completionSchema.safeParse(json);
          if (!completion.success) {
            throw new AppError({
              message: "LLM 응답 형식이 올바르지 않습니다.",
              code: "LLM_BAD_RESPONSE",
              statusCode: 502,
              expose: false,
              cause: new ZodError(completion.error.issues),
            });
          }

          const content = completion.data.choices[0]?.message.content;
          if (content === undefined || content === null || content.trim().length === 0) {
            throw new AppError({
              message: "LLM 응답 형식이 올바르지 않습니다.",
              code: "LLM_BAD_RESPONSE",
              statusCode: 502,
              expose: false,
            });
          }
          const usage = completion.data.usage;
          if (usage === undefined) {
            return { content };
          }
          return {
            content,
            usage: {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            },
          };
        } catch (error) {
          if (error instanceof AppError) {
            throw error;
          }
          if (error instanceof ZodError) {
            throw new AppError({
              message: "LLM 요청 형식이 올바르지 않습니다.",
              code: "LLM_BAD_REQUEST",
              statusCode: 400,
              expose: false,
              cause: error,
            });
          }
          lastTimeout = isTimeoutError(error);
          const retryable = lastTimeout || error instanceof TypeError;
          if (retryable && attempt < MAX_ATTEMPTS) {
            const delayMs = Math.min(200 * 2 ** (attempt - 1), 5_000);
            deps.onRetry?.({ statusCode: lastTimeout ? 504 : 502, attempt, delayMs });
            await sleep(delayMs);
            continue;
          }
          if (lastTimeout) {
            throw new AppError({
              message: "LLM 요청 시간이 초과되었습니다.",
              code: "LLM_TIMEOUT",
              statusCode: 504,
              retryable: true,
              expose: false,
              cause: error,
            });
          }
          throw new AppError({
            message: "LLM 공급자에 연결하지 못했습니다.",
            code: "LLM_NETWORK",
            statusCode: 502,
            retryable: true,
            expose: false,
            cause: error,
          });
        }
      }

      throw new AppError({
        message: "LLM 공급자를 일시적으로 사용할 수 없습니다.",
        code: "LLM_UNAVAILABLE",
        statusCode: 503,
        retryable: true,
        expose: false,
      });
    },
  };
}
