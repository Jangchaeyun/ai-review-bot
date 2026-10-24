/**
 * 구조화 로그를 만든다. 비밀로 쓰는 필드 이름은 [Redacted]로 가린다.
 * 비밀번호 해시와 초대 코드도 같은 방식으로 가린다.
 * 환경변수 객체 전체는 base에 넣지 않는다.
 */
import { type DestinationStream, type LevelWithSilent, type Logger } from "pino";
import pino from "pino";
import type { Env } from "../schemas/env.schema.js";

const REDACT_PATHS = [
  "env",
  "password",
  "passwordHash",
  "*.passwordHash",
  "inviteCode",
  "*.inviteCode",
  "token",
  "secret",
  "apiKey",
  "privateKey",
  "authorization",
  "*.password",
  "*.token",
  "*.secret",
  "*.apiKey",
  "*.privateKey",
  "*.authorization",
  "headers.authorization",
  "headers.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "webhookSecret",
  "*.webhookSecret",
  "signature",
  "*.signature",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "LLM_API_KEY",
  "*.LLM_API_KEY",
  "installationToken",
  "*.installationToken",
] as const;

export type CreateLoggerOptions = {
  level?: LevelWithSilent;
  destination?: DestinationStream;
};

/** 서비스 이름만 기본 필드에 두고, 비밀 경로는 [Redacted]로 가린 로거를 만든다. */
export function createLogger(env: Env, options?: CreateLoggerOptions): Logger {
  const loggerOptions = {
    level: options?.level ?? env.LOG_LEVEL,
    base: { service: env.SERVICE_NAME },
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[Redacted]",
    },
  };

  if (options?.destination === undefined) {
    return pino(loggerOptions);
  }

  return pino(loggerOptions, options.destination);
}
