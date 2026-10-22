/** 서명 실패는 본문을 보지 않고, 받을 이벤트만 큐에 들어가는지 확인한다. */
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { receiveGithubWebhook } from "../../src/services/github-webhook.service.js";
import { InMemoryDeliveryStore } from "../../src/services/delivery-store.js";
import { parseEnv } from "../../src/services/load-env.js";
import type { ReviewJobQueue } from "../../src/services/review-job-queue.js";
import { createLogger } from "../../src/utils/logger.js";
import { pullRequestPayload, signGithubBody } from "../helpers/github-webhook.js";
import { createRecordingReviewJobQueue } from "../helpers/recording-queue.js";
import { requiredTestEnv, TEST_WEBHOOK_SECRET } from "../helpers/test-app.js";

const deliveryId = "11111111-1111-4111-8111-111111111111";

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

function receive(
  body: string,
  options: {
    event?: string;
    delivery?: string;
    signature?: string;
    contentType?: string;
    queue?: ReviewJobQueue;
    store?: InMemoryDeliveryStore;
    stream?: Writable;
  } = {},
) {
  const captured = options.stream === undefined ? captureStream() : undefined;
  const destination = options.stream ?? captured?.stream;
  const env = parseEnv(requiredTestEnv());
  const logger = createLogger(env, {
    level: "info",
    ...(destination === undefined ? {} : { destination }),
  });
  const queue = options.queue ?? createRecordingReviewJobQueue();
  const result = receiveGithubWebhook(
    {
      secret: TEST_WEBHOOK_SECRET,
      logger,
      deliveryStore: options.store ?? new InMemoryDeliveryStore(60_000, () => 1),
      reviewJobQueue: queue,
    },
    {
      rawBody: Buffer.from(body),
      path: "/webhooks/github",
      contentType: options.contentType ?? "application/json",
      signatureHeader: options.signature === undefined ? signGithubBody(body) : options.signature,
      eventName: options.event ?? "pull_request",
      deliveryId: options.delivery === undefined ? deliveryId : options.delivery,
    },
  );

  return { result, queue, output: captured?.read() ?? "" };
}

describe("receiveGithubWebhook", () => {
  it("logs an accepted pull request without the secret or signature", () => {
    const body = pullRequestPayload();
    const { result, queue, output } = receive(body);

    expect(result.statusCode).toBe(202);
    expect(result.body).toEqual({ status: "accepted", deliveryId });
    expect(queue).toMatchObject({ jobs: [expect.objectContaining({ headSha: "a".repeat(40), pullNumber: 7 })] });
    expect(output).toContain("\"outcome\":\"accepted\"");
    expect(output).toContain("octo/ai-review-bot");
    expect(output).not.toContain(TEST_WEBHOOK_SECRET);
    expect(output).not.toContain("sha256=");
  });

  it("does not enqueue a second claim for the same delivery", () => {
    const body = pullRequestPayload({ action: "synchronize" });
    const store = new InMemoryDeliveryStore(60_000, () => 1);
    const queue = createRecordingReviewJobQueue();

    expect(receive(body, { store, queue }).result.statusCode).toBe(202);
    const duplicate = receive(body, { store, queue });

    expect(duplicate.result).toMatchObject({
      statusCode: 200,
      body: { status: "duplicate", reason: "duplicate-delivery" },
    });
    expect(queue.jobs).toHaveLength(1);
    expect(duplicate.output).toContain("duplicate");
  });

  it("releases the claim when enqueue fails", () => {
    const body = pullRequestPayload();
    const store = new InMemoryDeliveryStore(60_000, () => 1);
    const failingQueue: ReviewJobQueue = {
      enqueue() {
        throw new Error("super-secret-token");
      },
    };

    const failed = receive(body, { store, queue: failingQueue });
    expect(failed.result.statusCode).toBe(500);
    expect(JSON.stringify(failed.result.body)).not.toContain("super-secret-token");

    const queue = createRecordingReviewJobQueue();
    const retried = receive(body, { store, queue });
    expect(retried.result.statusCode).toBe(202);
    expect(queue.jobs).toHaveLength(1);
  });

  it("ignores unsupported actions before claiming them", () => {
    const body = pullRequestPayload({ action: "closed" });
    const store = new InMemoryDeliveryStore(60_000, () => 1);
    const queue = createRecordingReviewJobQueue();

    expect(receive(body, { store, queue }).result.body).toEqual({
      status: "ignored",
      reason: "unsupported-action",
    });
    expect(receive(pullRequestPayload(), { store, queue, delivery: deliveryId }).result.statusCode).toBe(202);
  });
});
