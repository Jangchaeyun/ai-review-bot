/**
 * 프로세스 환경변수를 Env로 좁힌다. 실패 메시지에는 어떤 키가 빠졌는지만 적고 값은 적지 않는다.
 */
import type { ZodError } from "zod";
import { envSchema, type Env } from "../schemas/env.schema.js";
import { AppError } from "../utils/app-error.js";

/** 어떤 키가 잘못됐는지만 적는다. 입력된 환경변수 값은 문장에 넣지 않는다. */
function formatEnvIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".") || "env";
      return `${path}: 값이 올바르지 않습니다.`;
    })
    .join("; ");
}

/** 알려진 키만 Env로 좁힌다. 빠지거나 형식이 틀리면 프로세스가 시작할 수 없게 던진다. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse({
    NODE_ENV: source["NODE_ENV"],
    PORT: source["PORT"],
    LOG_LEVEL: source["LOG_LEVEL"],
    SERVICE_NAME: source["SERVICE_NAME"],
    GITHUB_WEBHOOK_SECRET: source["GITHUB_WEBHOOK_SECRET"],
    GITHUB_APP_ID: source["GITHUB_APP_ID"],
    GITHUB_APP_PRIVATE_KEY: source["GITHUB_APP_PRIVATE_KEY"],
    GITHUB_API_BASE_URL: source["GITHUB_API_BASE_URL"],
    GITHUB_REQUEST_TIMEOUT_MS: source["GITHUB_REQUEST_TIMEOUT_MS"],
    REVIEW_MAX_FILES: source["REVIEW_MAX_FILES"],
    REVIEW_MAX_FILE_BYTES: source["REVIEW_MAX_FILE_BYTES"],
    REVIEW_MAX_DIFF_BYTES: source["REVIEW_MAX_DIFF_BYTES"],
    REVIEW_MAX_INLINE_COMMENTS: source["REVIEW_MAX_INLINE_COMMENTS"],
    REVIEW_STATE_PATH: source["REVIEW_STATE_PATH"],
    LLM_API_KEY: source["LLM_API_KEY"],
    LLM_BASE_URL: source["LLM_BASE_URL"],
    LLM_MODEL: source["LLM_MODEL"],
    LLM_REQUEST_TIMEOUT_MS: source["LLM_REQUEST_TIMEOUT_MS"],
    LLM_MAX_INPUT_CHARS: source["LLM_MAX_INPUT_CHARS"],
  });

  if (!parsed.success) {
    throw new AppError({
      message: `환경변수가 올바르지 않습니다. ${formatEnvIssues(parsed.error)}`,
      code: "INVALID_ENV",
      statusCode: 500,
      expose: false,
    });
  }

  return parsed.data;
}
