import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../../src/services/load-env.js";
import { requiredTestEnv } from "../helpers/test-app.js";
import {
  createInMemoryReviewJobQueue,
  logAcceptedReviewJob,
} from "../../src/services/review-job-queue.js";
import type { ReviewJob } from "../../src/services/review-job.js";
import { createLogger } from "../../src/utils/logger.js";

const job: ReviewJob = {
  deliveryId: "11111111-1111-4111-8111-111111111111",
  action: "opened",
  installationId: 42,
  repositoryFullName: "octo/ai-review-bot",
  owner: "octo",
  repo: "ai-review-bot",
  pullNumber: 7,
  headSha: "a".repeat(40),
};

function captureStream(): { stream: Writable; read: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, encoding, callback) {
      void encoding;
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      callback();
    },
  });
  return { stream, read: () => chunks.join("") };
}

function testLogger(level: "info" | "error", stream: Writable) {
  const env = parseEnv(requiredTestEnv());
  return createLogger(env, { level, destination: stream });
}

describe("createInMemoryReviewJobQueue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the handler after the current turn", async () => {
    const seen: string[] = [];
    const captured = captureStream();
    const queue = createInMemoryReviewJobQueue((item) => {
      seen.push(item.deliveryId);
    }, testLogger("info", captured.stream));

    queue.enqueue(job);

    expect(seen).toEqual([]);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(seen).toEqual([job.deliveryId]);
  });

  it("logs a queued job without calling fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const captured = captureStream();
    const logger = testLogger("info", captured.stream);
    const queue = createInMemoryReviewJobQueue(logAcceptedReviewJob(logger), logger);

    queue.enqueue(job);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const output = captured.read();
    expect(output).toContain("review job accepted");
    expect(output).toContain(job.deliveryId);
    expect(output).toContain("octo/ai-review-bot");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs a handler failure without the error message", async () => {
    const captured = captureStream();
    const logger = testLogger("error", captured.stream);
    const queue = createInMemoryReviewJobQueue(() => {
      throw new Error("super-secret-token");
    }, logger);

    queue.enqueue(job);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    const output = captured.read();
    expect(output).toContain("review job failed");
    expect(output).not.toContain("super-secret-token");
  });
});
