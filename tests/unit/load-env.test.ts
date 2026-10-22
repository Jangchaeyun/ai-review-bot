/** 환경변수 누락과 잘못된 값이 값 자체를 오류 문장에 남기지 않는지 확인한다. */
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/services/load-env.js";
import { AppError } from "../../src/utils/app-error.js";

describe("parseEnv", () => {
  it("fills defaults, keeps the LLM key, and drops unrelated variables", () => {
    const env = parseEnv({
      NODE_ENV: "test",
      LLM_API_KEY: "super-secret-key",
      UNRELATED_SECRET: "drop-me",
      GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
      GITHUB_APP_ID: "123456",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nLINE\\n-----END PRIVATE KEY-----",
    });

    expect(env).toEqual({
      NODE_ENV: "test",
      PORT: 3000,
      LOG_LEVEL: "info",
      SERVICE_NAME: "ai-review-bot",
      GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
      GITHUB_APP_ID: "123456",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nLINE\n-----END PRIVATE KEY-----",
      GITHUB_API_BASE_URL: "https://api.github.com",
      GITHUB_REQUEST_TIMEOUT_MS: 10_000,
      REVIEW_MAX_FILES: 20,
      REVIEW_MAX_FILE_BYTES: 200 * 1024,
      REVIEW_MAX_DIFF_BYTES: 20 * 1024,
      REVIEW_MAX_INLINE_COMMENTS: 10,
      REVIEW_STATE_PATH: "data/review-bot.sqlite",
      LLM_API_KEY: "super-secret-key",
      LLM_BASE_URL: "https://api.openai.com",
      LLM_MODEL: "gpt-4o-mini",
      LLM_REQUEST_TIMEOUT_MS: 60_000,
      LLM_MAX_INPUT_CHARS: 48_000,
    });
    expect(env).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("parses a numeric port and custom service name", () => {
    const env = parseEnv({
      NODE_ENV: "production",
      PORT: "8080",
      LOG_LEVEL: "warn",
      SERVICE_NAME: "review-bot",
      GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
      GITHUB_APP_ID: "123456",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
    });

    expect(env.PORT).toBe(8080);
    expect(env.LOG_LEVEL).toBe("warn");
    expect(env.SERVICE_NAME).toBe("review-bot");
  });

  it("rejects a missing NODE_ENV without echoing other values", () => {
    expect(() =>
      parseEnv({
        PORT: "super-secret-value",
      }),
    ).toThrow(AppError);

    try {
      parseEnv({
        NODE_ENV: "test",
        PORT: "super-secret-value",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "INVALID_ENV", expose: false });
      expect((error as AppError).message).not.toContain("super-secret-value");
      expect((error as AppError).message).toContain("PORT");
    }
  });

  it("rejects an oversized webhook secret without echoing it", () => {
    const secret = "s".repeat(300);
    expect(() =>
      parseEnv({
        NODE_ENV: "test",
        GITHUB_WEBHOOK_SECRET: secret,
      }),
    ).toThrow(AppError);

    try {
      parseEnv({
        NODE_ENV: "test",
        GITHUB_WEBHOOK_SECRET: secret,
      });
    } catch (error) {
      expect((error as AppError).message).not.toContain(secret);
      expect((error as AppError).message).toContain("GITHUB_WEBHOOK_SECRET");
    }
  });

  it("rejects an internal GitHub base URL without echoing it", () => {
    const baseUrl = "http://169.254.169.254";
    try {
      parseEnv({
        NODE_ENV: "test",
        GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
        GITHUB_APP_ID: "123456",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
        GITHUB_API_BASE_URL: baseUrl,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).not.toContain(baseUrl);
      expect((error as AppError).message).toContain("GITHUB_API_BASE_URL");
    }
  });

  it("rejects a state path that leaves the working directory", () => {
    const statePath = "../review-bot.sqlite";
    try {
      parseEnv({
        NODE_ENV: "test",
        GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
        GITHUB_APP_ID: "123456",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
        REVIEW_STATE_PATH: statePath,
      });
      expect.fail("path should be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).not.toContain(statePath);
      expect((error as AppError).message).toContain("REVIEW_STATE_PATH");
    }
  });

  it("rejects an internal LLM base URL without echoing it", () => {
    const baseUrl = "http://169.254.169.254";
    try {
      parseEnv({
        NODE_ENV: "test",
        GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
        GITHUB_APP_ID: "123456",
        GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
        LLM_BASE_URL: baseUrl,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).message).not.toContain(baseUrl);
      expect((error as AppError).message).toContain("LLM_BASE_URL");
    }
  });
});
