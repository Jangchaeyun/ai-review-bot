/** 로그에서 비밀 필드가 [Redacted]로 가려지는지 확인한다. */
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/services/load-env.js";
import { requiredTestEnv } from "../helpers/test-app.js";
import { createLogger } from "../../src/utils/logger.js";

function captureStream(): { stream: Writable; read: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, encoding, callback) {
      void encoding;
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      callback();
    },
  });

  return {
    stream,
    read: () => chunks.join(""),
  };
}

describe("createLogger", () => {
  it("redacts secrets and keeps the service name", () => {
    const captured = captureStream();
    const env = parseEnv(requiredTestEnv({ SERVICE_NAME: "ai-review-bot" }));
    const logger = createLogger(env, { level: "info", destination: captured.stream });

    logger.info(
      {
        token: "super-secret-token",
        webhookSecret: "test-webhook-secret",
        headers: { authorization: "Bearer webhook-secret" },
        LLM_API_KEY: "llm-secret-value",
        port: 3000,
      },
      "ready",
    );

    const output = captured.read();
    expect(output).toContain("ai-review-bot");
    expect(output).toContain("[Redacted]");
    expect(output).toContain("3000");
    expect(output).not.toContain("super-secret-token");
    expect(output).not.toContain("webhook-secret");
    expect(output).not.toContain("test-webhook-secret");
    expect(output).not.toContain("llm-secret-value");
  });
});
