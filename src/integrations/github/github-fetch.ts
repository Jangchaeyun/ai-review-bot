import { AppError } from "../../utils/app-error.js";

export type FetchLike = typeof fetch;

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 60_000;

export type GithubFetchDeps = {
  fetchImpl: FetchLike;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  onRetry?: (info: { statusCode: number; attempt: number; delayMs: number }) => void;
};

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || isTimeoutError(error);
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

function isRetryableStatus(response: Response): boolean {
  if (response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504) {
    return true;
  }
  if (response.status !== 403) {
    return false;
  }
  const remaining = response.headers.get("x-ratelimit-remaining");
  const retryAfter = response.headers.get("retry-after");
  return remaining === "0" || (retryAfter !== null && retryAfter.trim() !== "");
}

async function readLimitedBody(response: Response): Promise<ArrayBuffer> {
  const payload = await response.arrayBuffer();
  if (payload.byteLength > MAX_RESPONSE_BYTES) {
    throw new AppError({
      message: "GitHub 응답이 너무 큽니다.",
      code: "GITHUB_RESPONSE_TOO_LARGE",
      statusCode: 502,
      expose: false,
    });
  }
  return payload;
}

export function createGithubFetch(deps: GithubFetchDeps): FetchLike {
  return async (input, init) => {
    let lastTimeout = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(deps.timeoutMs);
      const callerSignal = init?.signal ?? undefined;
      const signal = callerSignal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, callerSignal]);

      try {
        const response = await deps.fetchImpl(input, {
          ...init,
          redirect: "manual",
          signal,
        });

        if (response.status >= 300 && response.status < 400) {
          await response.arrayBuffer().catch(() => undefined);
          throw new AppError({
            message: "GitHub API가 예상하지 않은 리다이렉트를 반환했습니다.",
            code: "GITHUB_UNEXPECTED_REDIRECT",
            statusCode: 502,
            expose: false,
          });
        }

        if (isRetryableStatus(response) && attempt < MAX_ATTEMPTS) {
          const delayMs = retryDelayMs(response, attempt, deps.now());
          await response.arrayBuffer().catch(() => undefined);
          if (delayMs === "too-long") {
            throw new AppError({
              message: "GitHub API 사용량 제한으로 요청을 중단했습니다.",
              code: "GITHUB_RATE_LIMIT",
              statusCode: 429,
              retryable: true,
              expose: false,
            });
          }
          deps.onRetry?.({ statusCode: response.status, attempt, delayMs });
          await deps.sleep(delayMs);
          continue;
        }

        const payload = await readLimitedBody(response);
        return new Response(payload, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        if (init?.signal?.aborted) {
          throw error;
        }
        lastTimeout = isTimeoutError(error);
        if (!isNetworkError(error) || attempt === MAX_ATTEMPTS) {
          if (lastTimeout) {
            throw new AppError({
              message: "GitHub API 요청 시간이 초과되었습니다.",
              code: "GITHUB_TIMEOUT",
              statusCode: 504,
              retryable: true,
              expose: false,
            });
          }
          throw new AppError({
            message: "GitHub API 네트워크 요청에 실패했습니다.",
            code: "GITHUB_NETWORK",
            statusCode: 502,
            retryable: true,
            expose: false,
          });
        }
        const delayMs = Math.min(200 * 2 ** (attempt - 1), 5_000);
        deps.onRetry?.({ statusCode: 0, attempt, delayMs });
        await deps.sleep(delayMs);
      }
    }

    throw new AppError({
      message: "GitHub API 요청에 실패했습니다.",
      code: "GITHUB_NETWORK",
      statusCode: 502,
      retryable: true,
      expose: false,
    });
  };
}
