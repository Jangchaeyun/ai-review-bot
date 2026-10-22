import { type DestinationStream, type LevelWithSilent, type Logger } from "pino";
import pino from "pino";
import type { Env } from "../schemas/env.schema.js";

const REDACT_PATHS = [
  "env",
  "password",
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
