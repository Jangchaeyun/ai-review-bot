/**
 * 리뷰 댓글을 GitHub에 남긴다. 게시 직전에 head SHA가 아직 최신인지 확인한다.
 * 인라인 코멘트가 422로 거절되면 요약만 다시 게시한다.
 */
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { z, ZodError } from "zod";
import type { AggregatedFinding } from "../../agents/aggregate-findings.js";
import type { ReviewFile } from "../../agents/filter-findings.js";
import { InMemoryReviewPublishStore, reviewPublishKey, type ReviewPublishStore } from "../../services/review-publish-store.js";
import { AppError } from "../../utils/app-error.js";
import { normalizePrivateKey } from "../../utils/private-key.js";
import { createGithubFetch, type FetchLike } from "./github-fetch.js";
import { buildReviewPost, type ReviewCommentDraft } from "./review-body.js";
import type { ReviewLanguage } from "../../services/review-language.js";

const WRITE_PERMISSIONS = {
  metadata: "read",
  pull_requests: "write",
} as const;

const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/i;

const installationAuthSchema = z.object({
  token: z.string().min(1).max(500),
  expiresAt: z.string().min(1).max(64),
});

const pullHeadSchema = z.object({
  draft: z.boolean().optional(),
  head: z.object({
    sha: z.string().regex(SHA),
  }),
});

const reviewSchema = z.object({
  id: z.number().int().positive(),
});

export type ReviewPublishInput = {
  installationId: number;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  draft: boolean;
  files: readonly ReviewFile[];
  findings: readonly AggregatedFinding[];
  partialFailure: boolean;
  language?: ReviewLanguage;
};

export type ReviewPublishResult =
  | {
      status: "posted";
      reviewId: number;
      inlineCount: number;
      fallback: boolean;
    }
  | {
      status: "skipped";
      reason: "duplicate" | "stale-head" | "draft";
    };

export type ReviewPublisher = {
  publish(input: ReviewPublishInput): Promise<ReviewPublishResult>;
};

export type ReviewPublisherDeps = {
  appId: string;
  privateKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxInlineComments: number;
  logger: Logger;
  store?: ReviewPublishStore;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

function sanitizeLogMessage(message: unknown): string {
  const text = typeof message === "string" ? message : "";
  return text
    .replace(/bearer\s+\S+/gi, "bearer [Redacted]")
    .replace(/token\s+\S+/gi, "token [Redacted]")
    .replace(/\b(?:ghs_|ghu_|gho_|ghp_|github_pat_)[A-Za-z0-9_]+\b/g, "[Redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[Redacted]")
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, "[Redacted]")
    .slice(0, 180);
}

function unwrapAppError(error: unknown): AppError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof AppError) {
      return current;
    }
    if (typeof current !== "object" || current === null || !("cause" in current)) {
      return undefined;
    }
    current = current.cause;
  }
  return undefined;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return undefined;
}

function publishFailure(error: unknown): AppError {
  const appError = unwrapAppError(error);
  if (appError !== undefined) {
    return appError;
  }
  if (error instanceof ZodError) {
    return new AppError({
      message: "GitHub 응답 형식이 올바르지 않습니다.",
      code: "GITHUB_BAD_RESPONSE",
      statusCode: 502,
      expose: false,
    });
  }
  const status = statusOf(error);
  if (status === 401) {
    return new AppError({ message: "GitHub App 인증에 실패했습니다.", code: "GITHUB_UNAUTHORIZED", statusCode: 401, expose: false });
  }
  if (status === 403) {
    return new AppError({ message: "GitHub API 권한이 없습니다.", code: "GITHUB_FORBIDDEN", statusCode: 403, expose: false });
  }
  if (status === 404) {
    return new AppError({ message: "Pull Request를 찾을 수 없습니다.", code: "GITHUB_NOT_FOUND", statusCode: 404, expose: false });
  }
  if (status === 422) {
    return new AppError({ message: "GitHub가 리뷰를 받아들이지 않았습니다.", code: "GITHUB_UNPROCESSABLE", statusCode: 422, expose: false });
  }
  if (status === 429) {
    return new AppError({
      message: "GitHub API 사용량 제한에 도달했습니다.",
      code: "GITHUB_RATE_LIMIT",
      statusCode: 429,
      retryable: true,
      expose: false,
    });
  }
  if (status !== undefined && status >= 500) {
    return new AppError({
      message: "GitHub API를 사용할 수 없습니다.",
      code: "GITHUB_UNAVAILABLE",
      statusCode: 502,
      retryable: true,
      expose: false,
    });
  }
  return new AppError({
    message: "GitHub API 요청에 실패했습니다.",
    code: "GITHUB_REQUEST_FAILED",
    statusCode: 502,
    retryable: true,
    expose: false,
    cause: error,
  });
}

function isUnprocessable(error: unknown): boolean {
  return publishFailure(error).code === "GITHUB_UNPROCESSABLE";
}

function assertTarget(input: ReviewPublishInput): void {
  if (!REPOSITORY_NAME.test(input.owner) || !REPOSITORY_NAME.test(input.repo)) {
    throw new AppError({ message: "저장소 이름이 올바르지 않습니다.", code: "INVALID_REPOSITORY", statusCode: 400 });
  }
  if (!Number.isInteger(input.pullNumber) || input.pullNumber < 1) {
    throw new AppError({ message: "Pull Request 번호가 올바르지 않습니다.", code: "INVALID_PULL_REQUEST", statusCode: 400 });
  }
  if (!Number.isInteger(input.installationId) || input.installationId < 1) {
    throw new AppError({ message: "GitHub App 설치 ID가 올바르지 않습니다.", code: "INVALID_INSTALLATION", statusCode: 400 });
  }
  if (!SHA.test(input.headSha)) {
    throw new AppError({ message: "커밋 SHA가 올바르지 않습니다.", code: "INVALID_SHA", statusCode: 400 });
  }
}

export function createReviewPublisher(deps: ReviewPublisherDeps): ReviewPublisher {
  const privateKey = normalizePrivateKey(deps.privateKey);
  const store = deps.store ?? new InMemoryReviewPublishStore();
  const fetchImpl = createGithubFetch({
    fetchImpl: deps.fetch ?? globalThis.fetch,
    timeoutMs: deps.timeoutMs,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: deps.now ?? Date.now,
    onRetry: ({ statusCode, attempt, delayMs }) => {
      deps.logger.warn({ statusCode, attempt, delayMs }, "github api retry");
    },
  });
  const log = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: unknown) => {
      deps.logger.warn({ source: "octokit", detail: sanitizeLogMessage(message) }, "github client warning");
    },
    error: (message: unknown) => {
      deps.logger.error({ source: "octokit", detail: sanitizeLogMessage(message) }, "github client error");
    },
  };
  const authClient = new Octokit({
    authStrategy: createAppAuth,
    auth: { appId: deps.appId, privateKey },
    baseUrl: deps.baseUrl,
    userAgent: "ai-review-bot",
    request: { fetch: fetchImpl },
    log,
  });

  return {
    async publish(input) {
      assertTarget(input);
      const repository = `${input.owner}/${input.repo}`;
      if (input.draft) {
        deps.logger.info({ outcome: "skipped", reason: "draft", repository, pullNumber: input.pullNumber }, "review publish skipped");
        return { status: "skipped", reason: "draft" };
      }

      const key = reviewPublishKey(input.owner, input.repo, input.pullNumber, input.headSha);
      let claimed = false;
      let posted = false;
      try {
        const authentication = installationAuthSchema.parse(
          await authClient.auth({
            type: "installation",
            installationId: input.installationId,
            repositoryNames: [input.repo],
            permissions: WRITE_PERMISSIONS,
          }),
        );
        const api = new Octokit({
          auth: authentication.token,
          baseUrl: deps.baseUrl,
          userAgent: "ai-review-bot",
          request: { fetch: fetchImpl },
          log,
        });
        const pullResponse = await api.rest.pulls.get({
          owner: input.owner,
          repo: input.repo,
          pull_number: input.pullNumber,
        });
        const pull = pullHeadSchema.safeParse(pullResponse.data);
        if (!pull.success) {
          throw new AppError({ message: "GitHub 응답 형식이 올바르지 않습니다.", code: "GITHUB_BAD_RESPONSE", statusCode: 502, expose: false });
        }
        if (pull.data.draft === true) {
          deps.logger.info({ outcome: "skipped", reason: "draft", repository, pullNumber: input.pullNumber }, "review publish skipped");
          return { status: "skipped", reason: "draft" };
        }
        if (pull.data.head.sha.toLowerCase() !== input.headSha.toLowerCase()) {
          deps.logger.info(
            { outcome: "skipped", reason: "stale-head", repository, pullNumber: input.pullNumber },
            "review publish skipped",
          );
          return { status: "skipped", reason: "stale-head" };
        }

        if (store.claim(key) === "duplicate") {
          deps.logger.info({ outcome: "skipped", reason: "duplicate", repository, pullNumber: input.pullNumber }, "review publish skipped");
          return { status: "skipped", reason: "duplicate" };
        }
        claimed = true;

        const draft = buildReviewPost({
          headSha: input.headSha,
          files: input.files,
          findings: input.findings,
          partialFailure: input.partialFailure,
          maxInlineComments: deps.maxInlineComments,
          ...(input.language === undefined ? {} : { language: input.language }),
        });
        const result = await postReview(api, input, draft.body, draft.comments);
        posted = true;
        deps.logger.info(
          {
            outcome: "posted",
            repository,
            pullNumber: input.pullNumber,
            reviewId: result.reviewId,
            inlineCount: result.inlineCount,
            fallback: result.fallback,
          },
          "review published",
        );
        return result;
      } catch (error) {
        if (claimed && !posted) {
          store.release(key);
        }
        const failure = publishFailure(error);
        deps.logger.error(
          { outcome: "failed", code: failure.code, statusCode: failure.statusCode, repository, pullNumber: input.pullNumber },
          "review publish failed",
        );
        throw failure;
      }
    },
  };
}

async function postReview(
  api: Octokit,
  input: ReviewPublishInput,
  body: string,
  comments: readonly ReviewCommentDraft[],
): Promise<Extract<ReviewPublishResult, { status: "posted" }>> {
  try {
    const reviewId = await createReview(api, input, body, comments);
    return { status: "posted", reviewId, inlineCount: comments.length, fallback: false };
  } catch (error) {
    if (comments.length === 0 || !isUnprocessable(error)) {
      throw error;
    }
    const reviewId = await createReview(api, input, body, []);
    return { status: "posted", reviewId, inlineCount: 0, fallback: true };
  }
}

async function createReview(api: Octokit, input: ReviewPublishInput, body: string, comments: readonly ReviewCommentDraft[]): Promise<number> {
  const base = {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    commit_id: input.headSha,
    body,
    event: "COMMENT" as const,
  };
  const response = comments.length === 0
    ? await api.rest.pulls.createReview(base)
    : await api.rest.pulls.createReview({ ...base, comments: [...comments] });
  const review = reviewSchema.safeParse(response.data);
  if (!review.success) {
    throw new AppError({ message: "GitHub 응답 형식이 올바르지 않습니다.", code: "GITHUB_BAD_RESPONSE", statusCode: 502, expose: false });
  }
  return review.data.id;
}
