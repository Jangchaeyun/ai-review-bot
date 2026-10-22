/** 잘못된 서명은 401, 받을 이벤트는 202, 관심 없는 이벤트와 중복 딜리버리는 200이다. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecordingReviewJobQueue } from "../helpers/recording-queue.js";
import { postWebhook, pullRequestPayload, signGithubBody } from "../helpers/github-webhook.js";
import { createTestApp } from "../helpers/test-app.js";

const deliveryId = "22222222-2222-4222-8222-222222222222";

function appWithQueue() {
  const reviewJobQueue = createRecordingReviewJobQueue();
  const app = createTestApp(undefined, { reviewJobQueue });
  return { app, reviewJobQueue };
}

describe("POST /webhooks/github", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a signed pull request and returns before review work calls the network", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled"));
    const { app, reviewJobQueue } = appWithQueue();
    const body = pullRequestPayload();

    const response = await postWebhook(app, body, {
      event: "pull_request",
      delivery: deliveryId,
      signature: signGithubBody(body),
    }).expect(202);

    expect(response.body).toEqual({ status: "accepted", deliveryId });
    expect(reviewJobQueue.jobs).toEqual([
      expect.objectContaining({
        action: "opened",
        repositoryFullName: "octo/ai-review-bot",
        pullNumber: 7,
        headSha: "a".repeat(40),
        installationId: 42,
      }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["synchronize", "reopened"] as const)("accepts %s", async (action) => {
    const { app, reviewJobQueue } = appWithQueue();
    const body = pullRequestPayload({ action });
    const delivery = action === "synchronize"
      ? "33333333-3333-4333-8333-333333333333"
      : "44444444-4444-4444-8444-444444444444";

    await postWebhook(app, body, {
      event: "pull_request",
      delivery,
      signature: signGithubBody(body),
    }).expect(202);

    expect(reviewJobQueue.jobs.map((job) => job.action)).toEqual([action]);
  });

  it("returns 200 for a duplicate delivery and does not enqueue again", async () => {
    const { app, reviewJobQueue } = appWithQueue();
    const body = pullRequestPayload();
    const headers = {
      event: "pull_request",
      delivery: deliveryId,
      signature: signGithubBody(body),
    };

    await postWebhook(app, body, headers).expect(202);
    const duplicate = await postWebhook(app, body, headers).expect(200);

    expect(duplicate.body).toEqual({ status: "duplicate", reason: "duplicate-delivery" });
    expect(reviewJobQueue.jobs).toHaveLength(1);
  });

  it("rejects a missing or invalid signature before parsing JSON", async () => {
    const { app, reviewJobQueue } = appWithQueue();
    const body = "{";

    const missing = await postWebhook(app, body, {
      event: "pull_request",
      delivery: deliveryId,
    }).expect(401);
    const invalid = await postWebhook(app, body, {
      event: "pull_request",
      delivery: deliveryId,
      signature: signGithubBody("{}", "test-webhook-secret"),
    }).expect(401);

    expect(missing.body.error.code).toBe("INVALID_SIGNATURE");
    expect(invalid.body.error.code).toBe("INVALID_SIGNATURE");
    expect(invalid.body.error.message).toBe("서명이 올바르지 않습니다.");
    expect(reviewJobQueue.jobs).toHaveLength(0);
  });

  it("rejects signed malformed JSON and a payload that is not a pull request", async () => {
    const { app, reviewJobQueue } = appWithQueue();
    const malformed = "{";
    const malformedResponse = await postWebhook(app, malformed, {
      event: "pull_request",
      delivery: "55555555-5555-4555-8555-555555555555",
      signature: signGithubBody(malformed),
    }).expect(400);

    const invalidSha = pullRequestPayload({ sha: "not-a-sha" });
    const invalidResponse = await postWebhook(app, invalidSha, {
      event: "pull_request",
      delivery: "66666666-6666-4666-8666-666666666666",
      signature: signGithubBody(invalidSha),
    }).expect(400);

    expect(malformedResponse.body.error.code).toBe("INVALID_JSON");
    expect(invalidResponse.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(invalidResponse.body)).not.toContain("not-a-sha");
    expect(reviewJobQueue.jobs).toHaveLength(0);
  });

  it("ignores ping, other events, unsupported actions, and drafts", async () => {
    const { app, reviewJobQueue } = appWithQueue();
    const ping = await postWebhook(app, JSON.stringify({ zen: "keep it logically awesome" }), {
      event: "ping",
      delivery: "77777777-7777-4777-8777-777777777777",
      signature: signGithubBody(JSON.stringify({ zen: "keep it logically awesome" })),
    }).expect(200);

    const issuesBody = JSON.stringify({ action: "opened" });
    const issues = await postWebhook(app, issuesBody, {
      event: "issues",
      delivery: "88888888-8888-4888-8888-888888888888",
      signature: signGithubBody(issuesBody),
    }).expect(200);

    const closed = pullRequestPayload({ action: "closed" });
    const closedResponse = await postWebhook(app, closed, {
      event: "pull_request",
      delivery: "99999999-9999-4999-8999-999999999999",
      signature: signGithubBody(closed),
    }).expect(200);

    const draft = pullRequestPayload({ draft: true });
    const draftResponse = await postWebhook(app, draft, {
      event: "pull_request",
      delivery: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      signature: signGithubBody(draft),
    }).expect(200);

    expect(ping.body).toEqual({ status: "ignored", reason: "ping" });
    expect(issues.body).toEqual({ status: "ignored", reason: "unsupported-event" });
    expect(closedResponse.body).toEqual({ status: "ignored", reason: "unsupported-action" });
    expect(draftResponse.body).toEqual({ status: "ignored", reason: "draft" });
    expect(reviewJobQueue.jobs).toHaveLength(0);
  });

  it("rejects a reordered body signed with the original bytes", async () => {
    const { app, reviewJobQueue } = appWithQueue();
    const original = '{"z":1,"action":"opened"}';
    const reordered = '{"action":"opened","z":1}';

    const response = await postWebhook(app, reordered, {
      event: "pull_request",
      delivery: deliveryId,
      signature: signGithubBody(original),
    }).expect(401);

    expect(response.body.error.code).toBe("INVALID_SIGNATURE");
    expect(reviewJobQueue.jobs).toHaveLength(0);
  });

  it("rejects an oversized body", async () => {
    const { app } = appWithQueue();
    const body = Buffer.alloc(1_000_001, 0x61);

    const response = await postWebhook(app, body, {
      event: "pull_request",
      delivery: deliveryId,
      signature: signGithubBody(body),
      contentType: "application/json",
    }).expect(413);

    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(JSON.stringify(response.body).length).toBeLessThan(500);
  });
});
