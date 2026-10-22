/** Webhook부터 가짜 GitHub와 LLM을 거쳐 리뷰가 게시되는 경로를 확인한다. */
import { generateKeyPairSync } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createReviewRuntime } from "../../src/services/review-pipeline.js";
import { parseEnv } from "../../src/services/load-env.js";
import { createLogger } from "../../src/utils/logger.js";
import { postWebhook, pullRequestPayload, signGithubBody } from "../helpers/github-webhook.js";
import { requiredTestEnv, TEST_WEBHOOK_SECRET } from "../helpers/test-app.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const TREE_SHA = "c".repeat(40);
const INSTALLATION_TOKEN = "ghs_pipeline_token_test";
const LLM_KEY = "sk-test-llm-key";
const DIFF_SECRET = "LEAKED_DIFF_SECRET";
const PATCH = ["@@ -1,2 +1,3 @@", " function ping(userInput) {", `+  return eval(userInput); // ${DIFF_SECRET}`, " }"].join("\n");

const DELIVERY_A = "11111111-1111-4111-8111-111111111111";
const DELIVERY_B = "22222222-2222-4222-8222-222222222222";
const DELIVERY_C = "33333333-3333-4333-8333-333333333333";

type Mode = "ok" | "github-unavailable" | "llm-timeout" | "llm-invalid" | "llm-partial";

function captureStream(): { stream: Writable; read: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      void encoding;
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      callback();
    },
  });
  return { stream, read: () => chunks.join("") };
}

function finding(category: string) {
  return {
    findings: [
      {
        category,
        severity: "high",
        title: "eval로 입력을 실행합니다",
        filePath: "src/ping.ts",
        lineStart: 2,
        lineEnd: 2,
        evidence: "return eval(userInput);",
        explanation: "사용자 입력이 eval로 전달됩니다.",
        suggestion: "입력을 실행하지 않는 파서를 사용합니다.",
        confidence: 0.9,
      },
    ],
  };
}

function categoryOf(body: string): string {
  if (body.includes("항상 \\\"security\\\"")) {
    return "security";
  }
  if (body.includes("항상 \\\"performance\\\"")) {
    return "performance";
  }
  return "quality";
}

function createPipelineApp(mode: Mode) {
  const captured = captureStream();
  const calls: Array<{ pathname: string; method: string; body: string }> = [];
  let githubFailures = 0;
  const env = parseEnv(requiredTestEnv({ LLM_API_KEY: LLM_KEY, GITHUB_APP_PRIVATE_KEY: privateKey }));
  const logger = createLogger(env, { level: "info", destination: captured.stream });
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ pathname: url.pathname, method: init?.method ?? "GET", body });

    if (url.hostname === "api.openai.com") {
      if (mode === "llm-timeout") {
        const error = new Error("timeout");
        error.name = "TimeoutError";
        throw error;
      }
      const category = categoryOf(body);
      const content = mode === "llm-invalid" || (mode === "llm-partial" && category === "security")
        ? "not-json"
        : JSON.stringify(finding(category));
      return Response.json({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      });
    }

    if (url.pathname === "/app/installations/42/access_tokens") {
      return Response.json({ token: INSTALLATION_TOKEN, expires_at: "2099-01-01T00:00:00Z" });
    }
    if (url.pathname === "/repos/octo/ai-review-bot/pulls/7" && (init?.method ?? "GET") === "GET") {
      if (mode === "github-unavailable" && githubFailures < 3) {
        githubFailures += 1;
        return Response.json({ message: "unavailable" }, { status: 503 });
      }
      return Response.json({
        number: 7,
        title: "Add ping",
        state: "open",
        draft: false,
        user: { login: "octo" },
        base: { ref: "main", sha: BASE_SHA },
        head: { ref: "feature", sha: HEAD_SHA },
        changed_files: 1,
      });
    }
    if (url.pathname === `/repos/octo/ai-review-bot/git/commits/${HEAD_SHA}`) {
      return Response.json({ sha: HEAD_SHA, tree: { sha: TREE_SHA } });
    }
    if (url.pathname === `/repos/octo/ai-review-bot/git/trees/${TREE_SHA}`) {
      return Response.json({ truncated: false, tree: [{ path: "src/ping.ts", type: "blob", size: 80 }] });
    }
    if (url.pathname === "/repos/octo/ai-review-bot/pulls/7/files") {
      return Response.json([{ filename: "src/ping.ts", status: "modified", patch: PATCH }]);
    }
    if (url.pathname === "/repos/octo/ai-review-bot/pulls/7/reviews" && init?.method === "POST") {
      return Response.json({ id: 15 });
    }
    throw new Error(`unexpected url ${url.pathname}`);
  };

  const runtime = createReviewRuntime({
    env,
    logger,
    fetchImpl,
    sleep: async () => undefined,
    now: () => 1_000,
  });
  return {
    app: createApp({ env, logger, reviewJobQueue: runtime.queue }),
    calls,
    readLog: captured.read,
    githubFailures: () => githubFailures,
  };
}

async function waitFor(check: () => boolean, readLog: () => string): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > 5_000) {
      throw new Error(`pipeline did not finish\n${readLog()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function reviewPosts(calls: Array<{ pathname: string; method: string }>): number {
  return calls.filter((call) => call.pathname.endsWith("/reviews") && call.method === "POST").length;
}

function finishedCount(log: string): number {
  return log.split("\"outcome\":\"review-finished\"").length - 1;
}

describe("webhook review pipeline", () => {
  it("posts one review after a signed webhook and records duration, tokens, and failure rate", async () => {
    const pipeline = createPipelineApp("ok");
    const body = pullRequestPayload();
    const signature = signGithubBody(body);

    const response = await postWebhook(pipeline.app, body, {
      event: "pull_request",
      delivery: DELIVERY_A,
      signature,
    }).expect(202);

    expect(response.body).toEqual({ status: "accepted", deliveryId: DELIVERY_A });
    await waitFor(() => reviewPosts(pipeline.calls) === 1, pipeline.readLog);
    const log = pipeline.readLog();
    expect(log).toContain("\"durationMs\":0");
    expect(log).toContain("\"promptTokens\":30");
    expect(log).toContain("\"completionTokens\":12");
    expect(log).toContain("\"totalTokens\":42");
    expect(log).toContain("\"failureRate\":0");
    expect(log).toContain("\"result\":\"posted\"");
    expect(log).not.toContain(TEST_WEBHOOK_SECRET);
    expect(log).not.toContain(LLM_KEY);
    expect(log).not.toContain(INSTALLATION_TOKEN);
    expect(log).not.toContain(DIFF_SECRET);
    expect(log).not.toContain("BEGIN PRIVATE KEY");
    expect(log).not.toContain(signature.slice("sha256=".length));
  });

  it("rejects a bad signature before any GitHub or LLM call", async () => {
    const pipeline = createPipelineApp("ok");
    await postWebhook(pipeline.app, pullRequestPayload(), {
      event: "pull_request",
      delivery: DELIVERY_A,
      signature: "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }).expect(401);
    expect(pipeline.calls).toHaveLength(0);
  });

  it("does not enqueue a duplicate delivery and does not post a second review for the same commit", async () => {
    const pipeline = createPipelineApp("ok");
    const body = pullRequestPayload();
    const headers = { event: "pull_request", delivery: DELIVERY_A, signature: signGithubBody(body) };
    await postWebhook(pipeline.app, body, headers).expect(202);
    await waitFor(() => reviewPosts(pipeline.calls) === 1, pipeline.readLog);

    const duplicate = await postWebhook(pipeline.app, body, headers).expect(200);
    expect(duplicate.body).toEqual({ status: "duplicate", reason: "duplicate-delivery" });

    const retry = pullRequestPayload();
    await postWebhook(pipeline.app, retry, {
      event: "pull_request",
      delivery: DELIVERY_B,
      signature: signGithubBody(retry),
    }).expect(202);
    await waitFor(() => finishedCount(pipeline.readLog()) >= 2, pipeline.readLog);

    expect(reviewPosts(pipeline.calls)).toBe(1);
    expect(pipeline.readLog()).toContain("\"reason\":\"duplicate\"");
  });

  it("does not post when GitHub stays unavailable, then posts once on a later delivery", async () => {
    const pipeline = createPipelineApp("github-unavailable");
    const body = pullRequestPayload();
    await postWebhook(pipeline.app, body, {
      event: "pull_request",
      delivery: DELIVERY_A,
      signature: signGithubBody(body),
    }).expect(202);
    await waitFor(() => pipeline.readLog().includes("\"result\":\"failed\""), pipeline.readLog);
    expect(reviewPosts(pipeline.calls)).toBe(0);
    expect(pipeline.githubFailures()).toBe(3);
    expect(pipeline.readLog()).toContain("\"code\":\"GITHUB_UNAVAILABLE\"");

    await postWebhook(pipeline.app, body, {
      event: "pull_request",
      delivery: DELIVERY_C,
      signature: signGithubBody(body),
    }).expect(202);
    await waitFor(() => reviewPosts(pipeline.calls) === 1, pipeline.readLog);
    expect(reviewPosts(pipeline.calls)).toBe(1);
    expect(pipeline.readLog()).toContain("\"failureRate\":0.5");
  });

  it("does not post when every agent times out", async () => {
    const pipeline = createPipelineApp("llm-timeout");
    const body = pullRequestPayload();
    await postWebhook(pipeline.app, body, {
      event: "pull_request",
      delivery: DELIVERY_A,
      signature: signGithubBody(body),
    }).expect(202);
    await waitFor(() => pipeline.readLog().includes("\"result\":\"agents-failed\""), pipeline.readLog);
    expect(reviewPosts(pipeline.calls)).toBe(0);
    expect(pipeline.calls.filter((call) => call.pathname === "/v1/chat/completions")).toHaveLength(9);
    expect(pipeline.readLog()).toContain("\"failureRate\":1");
  });

  it("does not post when every LLM response is invalid JSON", async () => {
    const pipeline = createPipelineApp("llm-invalid");
    const body = pullRequestPayload();
    await postWebhook(pipeline.app, body, {
      event: "pull_request",
      delivery: DELIVERY_A,
      signature: signGithubBody(body),
    }).expect(202);
    await waitFor(() => pipeline.readLog().includes("\"result\":\"agents-failed\""), pipeline.readLog);
    expect(reviewPosts(pipeline.calls)).toBe(0);
    expect(pipeline.readLog()).toContain("\"promptTokens\":30");
  });

  it("posts the completed agents when one agent returns an invalid response", async () => {
    const pipeline = createPipelineApp("llm-partial");
    const body = pullRequestPayload();
    await postWebhook(pipeline.app, body, {
      event: "pull_request",
      delivery: DELIVERY_A,
      signature: signGithubBody(body),
    }).expect(202);
    await waitFor(() => reviewPosts(pipeline.calls) === 1, pipeline.readLog);
    const review = pipeline.calls.find((call) => call.pathname.endsWith("/reviews"));
    expect(review?.body).toContain("일부 분석을 완료하지 못했습니다.");
    expect(pipeline.readLog()).toContain("\"partialFailure\":true");
    expect(pipeline.readLog()).not.toContain(DIFF_SECRET);
  });
});
