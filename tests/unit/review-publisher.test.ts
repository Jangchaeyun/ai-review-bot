import { generateKeyPairSync } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { AggregatedFinding } from "../../src/agents/aggregate-findings.js";
import { createReviewPublisher } from "../../src/integrations/github/review-publisher.js";
import { InMemoryReviewPublishStore } from "../../src/services/review-publish-store.js";
import { parseEnv } from "../../src/services/load-env.js";
import { createLogger } from "../../src/utils/logger.js";
import { requiredTestEnv } from "../helpers/test-app.js";

const HEAD_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const TOKEN = "ghs_installation_token_test";
const DIFF_SECRET = "LEAKED_DIFF_SECRET";
const PATCH = ["@@ -1,2 +1,3 @@", " function ping(userInput) {", `+  return eval("${DIFF_SECRET}");`, " }"].join("\n");

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

type RecordedCall = { pathname: string; method: string; authorization: string; body: string };

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

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function finding(overrides: Partial<AggregatedFinding> = {}): AggregatedFinding {
  return {
    category: "security",
    severity: "high",
    title: "eval로 입력을 실행합니다",
    filePath: "src/ping.ts",
    lineStart: 2,
    lineEnd: 2,
    evidence: `return eval("${DIFF_SECRET}");`,
    explanation: "사용자 입력이 eval로 전달됩니다.",
    suggestion: "입력을 실행하지 않는 파서를 사용합니다.",
    confidence: 0.9,
    sources: ["security"],
    ...overrides,
  };
}

function createGithubMock(behavior: { reviewStatuses?: number[]; headSha?: string; draft?: boolean; redirect?: boolean } = {}) {
  const calls: RecordedCall[] = [];
  const reviewStatuses = [...(behavior.reviewStatuses ?? [200])];
  let reviewIndex = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const headers = new Headers(init?.headers);
    calls.push({
      pathname: url.pathname,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? "",
      body: typeof init?.body === "string" ? init.body : "",
    });

    if (behavior.redirect === true) {
      return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
    }
    if (url.pathname === "/app/installations/99/access_tokens") {
      return jsonResponse({ token: TOKEN, expires_at: "2099-01-01T00:00:00Z" });
    }
    if (url.pathname === "/repos/octo/ai-review-bot/pulls/7" && (init?.method ?? "GET") === "GET") {
      return jsonResponse({
        draft: behavior.draft ?? false,
        head: { sha: behavior.headSha ?? HEAD_SHA },
      });
    }
    if (url.pathname === "/repos/octo/ai-review-bot/pulls/7/reviews" && init?.method === "POST") {
      const status = reviewStatuses[Math.min(reviewIndex, reviewStatuses.length - 1)] ?? 200;
      reviewIndex += 1;
      if (status === 429) {
        return jsonResponse({ message: "rate limit" }, 429, { "retry-after": "0" });
      }
      if (status !== 200) {
        return jsonResponse({ message: "unprocessable" }, status);
      }
      return jsonResponse({ id: 15, body: "stored", commit_id: HEAD_SHA });
    }
    throw new Error(`unexpected github url ${url.pathname}`);
  };

  return { fetchImpl, calls };
}

function publisherFor(fetchImpl: typeof fetch, stream: Writable, store = new InMemoryReviewPublishStore()) {
  const env = parseEnv(requiredTestEnv());
  const logger = createLogger(env, { level: "info", destination: stream });
  return createReviewPublisher({
    appId: "123456",
    privateKey,
    baseUrl: "https://api.github.com",
    timeoutMs: 1_000,
    maxInlineComments: env.REVIEW_MAX_INLINE_COMMENTS,
    logger,
    store,
    fetch: fetchImpl,
    sleep: () => Promise.resolve(),
    now: () => 1_000,
  });
}

const input = {
  installationId: 99,
  owner: "octo",
  repo: "ai-review-bot",
  pullNumber: 7,
  headSha: HEAD_SHA,
  draft: false,
  files: [{ path: "src/ping.ts", patch: PATCH }],
  findings: [finding(), finding({ severity: "low", title: "낮은 항목", category: "quality" as const, sources: ["quality" as const] })],
  partialFailure: false,
};

describe("createReviewPublisher", () => {
  it("posts a comment review with a write token and only validated inline lines", async () => {
    const captured = captureStream();
    const github = createGithubMock();
    const result = await publisherFor(github.fetchImpl, captured.stream).publish(input);

    expect(result).toEqual({ status: "posted", reviewId: 15, inlineCount: 1, fallback: false });
    const tokenCall = github.calls.find((call) => call.pathname.endsWith("/access_tokens"));
    expect(JSON.parse(tokenCall?.body ?? "{}")).toMatchObject({
      repositories: ["ai-review-bot"],
      permissions: { metadata: "read", pull_requests: "write" },
    });
    const reviewCall = github.calls.find((call) => call.pathname.endsWith("/reviews"));
    const review = JSON.parse(reviewCall?.body ?? "{}") as { commit_id: string; event: string; body: string; comments: Array<{ line: number; side: string }> };
    expect(review.commit_id).toBe(HEAD_SHA);
    expect(review.event).toBe("COMMENT");
    expect(review.body).toContain("낮은 항목");
    expect(review.comments).toEqual([expect.objectContaining({ line: 2, side: "RIGHT", path: "src/ping.ts" })]);
    expect(reviewCall?.authorization).toBe(`token ${TOKEN}`);
    const output = captured.read();
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(DIFF_SECRET);
    expect(output).not.toContain("BEGIN PRIVATE KEY");
  });

  it("does not post again for the same pull request and commit", async () => {
    const github = createGithubMock();
    const publisher = publisherFor(github.fetchImpl, captureStream().stream);
    await publisher.publish(input);
    const second = await publisher.publish(input);

    expect(second).toEqual({ status: "skipped", reason: "duplicate" });
    expect(github.calls.filter((call) => call.pathname.endsWith("/reviews"))).toHaveLength(1);
  });

  it("skips a stale head and a draft without posting a review", async () => {
    const stale = createGithubMock({ headSha: OTHER_SHA });
    const staleResult = await publisherFor(stale.fetchImpl, captureStream().stream).publish(input);
    expect(staleResult).toEqual({ status: "skipped", reason: "stale-head" });
    expect(stale.calls.some((call) => call.pathname.endsWith("/reviews"))).toBe(false);

    const draft = createGithubMock();
    const draftResult = await publisherFor(draft.fetchImpl, captureStream().stream).publish({ ...input, draft: true });
    expect(draftResult).toEqual({ status: "skipped", reason: "draft" });
    expect(draft.calls).toHaveLength(0);
  });

  it("falls back to a summary review when GitHub rejects the inline comments", async () => {
    const github = createGithubMock({ reviewStatuses: [422, 200] });
    const result = await publisherFor(github.fetchImpl, captureStream().stream).publish(input);
    const reviews = github.calls.filter((call) => call.pathname.endsWith("/reviews"));

    expect(result).toEqual({ status: "posted", reviewId: 15, inlineCount: 0, fallback: true });
    expect(reviews).toHaveLength(2);
    expect(JSON.parse(reviews[0]?.body ?? "{}")).toHaveProperty("comments");
    expect(JSON.parse(reviews[1]?.body ?? "{}")).not.toHaveProperty("comments");
  });

  it("retries a rate limit and does not retry an authorization failure", async () => {
    const limited = createGithubMock({ reviewStatuses: [429, 200] });
    await expect(publisherFor(limited.fetchImpl, captureStream().stream).publish(input)).resolves.toMatchObject({ status: "posted" });
    expect(limited.calls.filter((call) => call.pathname.endsWith("/reviews"))).toHaveLength(2);
  });

  it("releases the claim after an authorization failure so the same commit can be retried", async () => {
    const statuses = [401, 200];
    const github = createGithubMock({ reviewStatuses: statuses });
    const publisher = publisherFor(github.fetchImpl, captureStream().stream);
    await expect(publisher.publish(input)).rejects.toMatchObject({ code: "GITHUB_UNAUTHORIZED" });
    statuses[0] = 200;
    await expect(publisher.publish(input)).resolves.toMatchObject({ status: "posted", reviewId: 15 });
  });

  it("posts a summary when no findings remain", async () => {
    const github = createGithubMock();
    const result = await publisherFor(github.fetchImpl, captureStream().stream).publish({ ...input, findings: [] });
    const review = JSON.parse(github.calls.find((call) => call.pathname.endsWith("/reviews"))?.body ?? "{}") as { body: string; comments?: unknown };
    expect(result).toMatchObject({ status: "posted", inlineCount: 0, fallback: false });
    expect(review.body).toContain("지적할 항목을 찾지 못했습니다.");
    expect(review.comments).toBeUndefined();
  });

  it("does not follow a redirect", async () => {
    const github = createGithubMock({ redirect: true });
    await expect(publisherFor(github.fetchImpl, captureStream().stream).publish(input)).rejects.toMatchObject({
      code: "GITHUB_UNEXPECTED_REDIRECT",
    });
    expect(github.calls.some((call) => call.pathname.includes("evil.example"))).toBe(false);
  });
});
