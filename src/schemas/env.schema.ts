import { z } from "zod";
import { isPrivateKeyPem, normalizePrivateKey } from "../utils/private-key.js";

const githubBaseUrlSchema = z.string().transform((value, context) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "값이 올바르지 않습니다." });
    return z.NEVER;
  }

  const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const allowed = (url.protocol === "https:" || (url.protocol === "http:" && localhost))
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === "";
  if (!allowed) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "값이 올바르지 않습니다." });
    return z.NEVER;
  }
  return url.origin;
});

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "3000";
    }
    return value;
  }, z.coerce.number().int().min(1).max(65535)),
  LOG_LEVEL: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "info";
    }
    return value;
  }, z.enum(["fatal", "error", "warn", "info", "debug", "trace"])),
  SERVICE_NAME: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "ai-review-bot";
    }
    return value;
  }, z.string().min(1).max(64)),
  GITHUB_WEBHOOK_SECRET: z.string().min(1).max(256),
  GITHUB_APP_ID: z.string().regex(/^\d{1,12}$/),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .min(1)
    .max(16384)
    .transform(normalizePrivateKey)
    .refine(isPrivateKeyPem, { message: "값이 올바르지 않습니다." }),
  GITHUB_API_BASE_URL: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "https://api.github.com";
    }
    return value;
  }, githubBaseUrlSchema),
  GITHUB_REQUEST_TIMEOUT_MS: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "10000";
    }
    return value;
  }, z.coerce.number().int().min(1000).max(120_000)),
  REVIEW_MAX_FILES: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "20";
    }
    return value;
  }, z.coerce.number().int().min(1).max(100)),
  REVIEW_MAX_FILE_BYTES: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return String(200 * 1024);
    }
    return value;
  }, z.coerce.number().int().min(1).max(5_000_000)),
  REVIEW_MAX_DIFF_BYTES: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return String(20 * 1024);
    }
    return value;
  }, z.coerce.number().int().min(1).max(1_000_000)),
  REVIEW_MAX_INLINE_COMMENTS: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "10";
    }
    return value;
  }, z.coerce.number().int().min(0).max(50)),
  REVIEW_STATE_PATH: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "data/review-bot.sqlite";
    }
    return value;
  }, z.string().min(1).max(260).refine((value) => value === "memory" || (!value.includes("\0") && !value.split(/[\\/]/).includes("..")), {
    message: "값이 올바르지 않습니다.",
  })),
  LLM_API_KEY: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "";
    }
    return value;
  }, z.string().max(512)),
  LLM_BASE_URL: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "https://api.openai.com";
    }
    return value;
  }, githubBaseUrlSchema),
  LLM_MODEL: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "gpt-4o-mini";
    }
    return value;
  }, z.string().min(1).max(128)),
  LLM_REQUEST_TIMEOUT_MS: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "60000";
    }
    return value;
  }, z.coerce.number().int().min(1000).max(180_000)),
  LLM_MAX_INPUT_CHARS: z.preprocess((value) => {
    if (value === undefined || value === "") {
      return "48000";
    }
    return value;
  }, z.coerce.number().int().min(1000).max(200_000)),
});

export type Env = z.infer<typeof envSchema>;
