/** 설치 토큰 권한과, diff를 로그에 남기지 않는지를 확인한다. */
import { generateKeyPairSync } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createPullRequestReader } from "../../src/integrations/github/pull-request-reader.js";
import type { ReviewLimits } from "../../src/integrations/github/review-scope.js";
import { parseEnv } from "../../src/services/load-env.js";
import { AppError } from "../../src/utils/app-error.js";
import { createLogger } from "../../src/utils/logger.js";
import { requiredTestEnv } from "../helpers/test-app.js";

const HEAD_SHA = "a".repeat(40);
const TREE_SHA = "b".repeat(40);
const BASE_SHA = "c".repeat(40);
const TOKEN = "ghs_installation_token_test";
const DIFF_SECRET = "LEAKED_DIFF_SECRET";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

type RecordedCall = {
  pathname: string;
  method: string;
  authorization: string;
  body: string;
  page: string | null;
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

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function authorizationOf(init?: RequestInit): string {
  if (init?.headers === undefined) {
    return "";
  }
  return new Headers(init.headers).get("authorization") ?? "";
}

function pullPayload(changedFiles: number) {
  return {
    number: 7,
    title: "Add reader",
    state: "open",
    draft: false,
    user: { login: "octo" },
    base: { ref: "main", sha: BASE_SHA },
    head: { ref: "feature", sha: HEAD_SHA },
    changed_files: changedFiles,
  };
}

function textFile(path: string, patch = "ok") {
  return { filename: path, status: "modified", patch };
}

function createGithubMock(behavior: {
  filePages?: unknown[][];
  rateLimitFiles?: boolean;
  forbiddenFiles?: boolean;
  authStatus?: number;
  redirectAuth?: boolean;
  networkFailures?: number;
} = {}) {
  const calls: RecordedCall[] = [];
  let networkFailures = behavior.networkFailures ?? 0;
  let rateLimited = false;
  const filePages = behavior.filePages ?? [[
    textFile("src/app.ts", "console.log('ok')"),
    { filename: "src/gone.ts", status: "removed", patch: "-old" },
    { filename: "assets/logo.png", status: "added" },
    textFile("src/wide.ts", `${DIFF_SECRET}${"x".repeat(40)}`),
    textFile("package-lock.json", "lock"),
    textFile("src/huge.ts", "tiny"),
  ]];

  const fetchImpl: typeof fetch = async (input, init) => {
    if (networkFailures > 0) {
      networkFailures -= 1;
      throw new TypeError("fetch failed");
    }

    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = init?.method ?? "GET";
    calls.push({
      pathname: url.pathname,
      method,
      authorization: authorizationOf(init),
      body: typeof init?.body === "string" ? init.body : "",
      page: url.searchParams.get("page"),
    });

    if (url.pathname === "/app/installations/99/access_tokens") {
      if (behavior.redirectAuth) {
        return new Response(null, { status: 302, headers: { location: "http://evil.example/steal" } });
      }
      if (behavior.authStatus !== undefined) {
        return jsonResponse({ message: "bad credentials" }, behavior.authStatus);
      }
      return jsonResponse({
        token: TOKEN,
        expires_at: "2099-01-01T00:00:00Z",
        permissions: { metadata: "read", contents: "read", pull_requests: "read" },
        repository_selection: "selected",
        repositories: [{ id: 1, name: "ai-review-bot" }],
      });
    }

    if (url.pathname === "/repos/octo/ai-review-bot/pulls/7") {
      return jsonResponse(pullPayload(filePages.reduce((sum, page) => sum + page.length, 0)));
    }
    if (url.pathname === `/repos/octo/ai-review-bot/git/commits/${HEAD_SHA}`) {
      return jsonResponse({ sha: HEAD_SHA, tree: { sha: TREE_SHA } });
    }
    if (url.pathname === `/repos/octo/ai-review-bot/git/trees/${TREE_SHA}`) {
      return jsonResponse({
        truncated: false,
        tree: [
          { path: "src/app.ts", type: "blob", size: 120 },
          { path: "assets/logo.png", type: "blob", size: 8 },
          { path: "src/wide.ts", type: "blob", size: 80 },
          { path: "package-lock.json", type: "blob", size: 10 },
          { path: "src/huge.ts", type: "blob", size: 500_000 },
          { path: "src/page-1.ts", type: "blob", size: 20 },
          { path: "src/page-2.ts", type: "blob", size: 20 },
        ],
      });
    }
    if (url.pathname === "/repos/octo/ai-review-bot/pulls/7/files") {
      if (behavior.forbiddenFiles) {
        return jsonResponse({ message: "forbidden" }, 403);
      }
      if (behavior.rateLimitFiles && !rateLimited) {
        rateLimited = true;
        return jsonResponse({ message: "rate limit" }, 429, { "retry-after": "0" });
      }
      const page = Number(url.searchParams.get("page") ?? "1");
      const batch = filePages[page - 1] ?? [];
      const headers: Record<string, string> = {};
      if (page < filePages.length) {
        headers.link = `<https://api.github.com/repos/octo/ai-review-bot/pulls/7/files?page=${page + 1}>; rel="next"`;
      }
      return jsonResponse(batch, 200, headers);
    }

    throw new Error(`unexpected github url ${url.pathname}`);
  };

  return { fetchImpl, calls };
}

function readerFor(fetchImpl: typeof fetch, limits: ReviewLimits, stream: Writable) {
  const env = parseEnv(requiredTestEnv());
  const logger = createLogger(env, { level: "info", destination: stream });
  return createPullRequestReader({
    appId: "123456",
    privateKey,
    baseUrl: "https://api.github.com",
    timeoutMs: 1_000,
    limits,
    logger,
    fetch: fetchImpl,
    sleep: () => Promise.resolve(),
    now: () => 1_000,
  });
}

const query = { installationId: 99, owner: "octo", repo: "ai-review-bot", pullNumber: 7 };

describe("createPullRequestReader", () => {
  it("reads a pull request with a read-only installation token and records skipped files", async () => {
    const captured = captureStream();
    const github = createGithubMock();
    const result = await readerFor(github.fetchImpl, {
      maxFiles: 20,
      maxFileBytes: 200,
      maxDiffBytes: 40,
    }, captured.stream).read(query);

    const tokenCall = github.calls.find((call) => call.pathname.endsWith("/access_tokens"));
    expect(tokenCall?.method).toBe("POST");
    expect(JSON.parse(tokenCall?.body ?? "{}")).toMatchObject({
      repositories: ["ai-review-bot"],
      permissions: { metadata: "read", contents: "read", pull_requests: "read" },
    });
    expect(JSON.parse(tokenCall?.body ?? "{}").permissions).not.toHaveProperty("administration");
    expect(tokenCall?.authorization.toLowerCase().startsWith("bearer ")).toBe(true);

    const apiCall = github.calls.find((call) => call.pathname.endsWith("/pulls/7"));
    expect(apiCall?.authorization).toBe(`token ${TOKEN}`);
    expect(result.metadata).toMatchObject({ number: 7, headSha: HEAD_SHA, authorLogin: "octo", draft: false });
    expect(result.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    expect(result.skipped.map((file) => file.reason)).toEqual([
      "deleted",
      "binary",
      "diff-too-large",
      "excluded-path",
      "file-too-large",
    ]);
    expect(result.fileListIncomplete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(DIFF_SECRET);

    const output = captured.read();
    expect(output).toContain("pull request files selected");
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain(DIFF_SECRET);
    expect(output).not.toContain("BEGIN PRIVATE KEY");
    expect(output).not.toContain("eyJ");
  });

  it("follows file pagination and reuses the installation token", async () => {
    const captured = captureStream();
    const github = createGithubMock({
      filePages: [[textFile("src/page-1.ts")], [textFile("src/page-2.ts")]],
    });
    const reader = readerFor(github.fetchImpl, { maxFiles: 20, maxFileBytes: 1_000, maxDiffBytes: 1_000 }, captured.stream);

    const first = await reader.read(query);
    const second = await reader.read(query);

    expect(first.files.map((file) => file.path)).toEqual(["src/page-1.ts", "src/page-2.ts"]);
    expect(second.files).toHaveLength(2);
    expect(github.calls.filter((call) => call.pathname.endsWith("/access_tokens"))).toHaveLength(1);
    expect(github.calls.filter((call) => call.pathname.endsWith("/files")).map((call) => call.page)).toEqual([
      "1",
      "2",
      "1",
      "2",
    ]);
  });

  it("retries a rate limit and a network error, and does not retry auth or permission failures", async () => {
    const captured = captureStream();
    const limits = { maxFiles: 20, maxFileBytes: 1_000, maxDiffBytes: 1_000 };
    const rateLimited = createGithubMock({ rateLimitFiles: true, filePages: [[textFile("src/page-1.ts")]] });
    const rateResult = await readerFor(rateLimited.fetchImpl, limits, captured.stream).read(query);
    expect(rateResult.files).toHaveLength(1);
    expect(rateLimited.calls.filter((call) => call.pathname.endsWith("/files"))).toHaveLength(2);

    const networked = createGithubMock({ networkFailures: 1, filePages: [[textFile("src/page-1.ts")]] });
    await readerFor(networked.fetchImpl, limits, captured.stream).read(query);
    expect(networked.calls.length).toBeGreaterThan(0);

    const unauthorized = createGithubMock({ authStatus: 401 });
    await expect(readerFor(unauthorized.fetchImpl, limits, captured.stream).read(query)).rejects.toMatchObject({
      code: "GITHUB_UNAUTHORIZED",
      retryable: false,
    });
    expect(unauthorized.calls).toHaveLength(1);

    const forbidden = createGithubMock({ forbiddenFiles: true, filePages: [[textFile("src/page-1.ts")]] });
    await expect(readerFor(forbidden.fetchImpl, limits, captured.stream).read(query)).rejects.toBeInstanceOf(AppError);
    await expect(readerFor(forbidden.fetchImpl, limits, captured.stream).read(query)).rejects.toMatchObject({
      code: "GITHUB_FORBIDDEN",
    });
    const forbiddenFileCalls = forbidden.calls.filter((call) => call.pathname.endsWith("/files"));
    expect(forbiddenFileCalls).toHaveLength(2);
  });

  it("does not follow an authentication redirect", async () => {
    const captured = captureStream();
    const github = createGithubMock({ redirectAuth: true });
    await expect(readerFor(github.fetchImpl, {
      maxFiles: 1,
      maxFileBytes: 100,
      maxDiffBytes: 100,
    }, captured.stream).read(query)).rejects.toMatchObject({
      code: "GITHUB_UNEXPECTED_REDIRECT",
    });
    expect(github.calls.map((call) => call.pathname)).toEqual(["/app/installations/99/access_tokens"]);
    expect(captured.read()).not.toContain("evil.example");
  });
});
