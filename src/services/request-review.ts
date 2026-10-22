/**
 * 콘솔에서 넣은 Pull Request를 읽어 큐에 넣는다.
 * 초안과 닫힌 Pull Request는 거절하고, 설치 토큰은 그 저장소의 읽기 권한만 요청한다.
 */
import { randomUUID } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { z, ZodError } from "zod";
import type { FetchLike } from "../integrations/github/github-fetch.js";
import { createGithubFetch } from "../integrations/github/github-fetch.js";
import type { Env } from "../schemas/env.schema.js";
import { AppError } from "../utils/app-error.js";
import { normalizePrivateKey } from "../utils/private-key.js";
import { parsePullRequestUrl } from "./parse-pull-request-url.js";
import type { ReviewJobRecord } from "./review-activity.js";
import type { ReviewJob } from "./review-job.js";
import { reviewLanguageFrom, type ReviewLanguage } from "./review-language.js";

const READ_PERMISSIONS = {
  metadata: "read",
  pull_requests: "read",
} as const;

const installationSchema = z.object({
  id: z.number().int().positive(),
});

const tokenSchema = z.object({
  token: z.string().min(1).max(500),
});

const pullSchema = z.object({
  number: z.number().int().positive(),
  draft: z.boolean().optional(),
  state: z.enum(["open", "closed"]),
  head: z.object({
    sha: z.string().regex(/^[0-9a-f]{40}$/i),
  }),
});

export type RequestReviewDeps = {
  env: Env;
  logger: Logger;
  enqueue: (job: ReviewJob) => void;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}

function githubError(error: unknown, notFound: AppError): AppError {
  if (error instanceof AppError) {
    return error;
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
  if (status === 404) {
    return notFound;
  }
  if (status === 401 || status === 403) {
    return new AppError({
      message: "GitHub App으로 이 Pull Request를 읽지 못했습니다.",
      code: "GITHUB_FORBIDDEN",
      statusCode: 403,
      expose: true,
    });
  }
  return new AppError({
    message: "GitHub 조회에 실패했습니다.",
    code: "GITHUB_UNAVAILABLE",
    statusCode: 502,
    expose: true,
    cause: error,
  });
}

export function createRequestReview(deps: RequestReviewDeps): (pullRequestUrl: string, language?: ReviewLanguage) => Promise<ReviewJobRecord> {
  const privateKey = normalizePrivateKey(deps.env.GITHUB_APP_PRIVATE_KEY);
  const fetchImpl = createGithubFetch({
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    timeoutMs: deps.env.GITHUB_REQUEST_TIMEOUT_MS,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: deps.now ?? Date.now,
  });
  const app = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: deps.env.GITHUB_APP_ID,
      privateKey,
    },
    baseUrl: deps.env.GITHUB_API_BASE_URL,
    userAgent: "ai-review-bot",
    request: { fetch: fetchImpl },
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });

  return async (pullRequestUrl, language) => {
    const target = parsePullRequestUrl(pullRequestUrl);
    let installationId: number;
    try {
      const installation = await app.rest.apps.getRepoInstallation({
        owner: target.owner,
        repo: target.repo,
      });
      installationId = installationSchema.parse(installation.data).id;
    } catch (error) {
      throw githubError(error, new AppError({
        message: "이 저장소에 GitHub App이 설치되어 있지 않습니다.",
        code: "APP_NOT_INSTALLED",
        statusCode: 404,
        expose: true,
      }));
    }

    let pull: z.infer<typeof pullSchema>;
    try {
      const authentication = tokenSchema.parse(await app.auth({
        type: "installation",
        installationId,
        repositoryNames: [target.repo],
        permissions: READ_PERMISSIONS,
      }));
      const api = new Octokit({
        auth: authentication.token,
        baseUrl: deps.env.GITHUB_API_BASE_URL,
        userAgent: "ai-review-bot",
        request: { fetch: fetchImpl },
        log: {
          debug: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      });
      const response = await api.rest.pulls.get({
        owner: target.owner,
        repo: target.repo,
        pull_number: target.pullNumber,
      });
      pull = pullSchema.parse(response.data);
    } catch (error) {
      throw githubError(error, new AppError({
        message: "Pull Request를 찾을 수 없습니다.",
        code: "PULL_REQUEST_NOT_FOUND",
        statusCode: 404,
        expose: true,
      }));
    }

    if (pull.number !== target.pullNumber) {
      throw new AppError({
        message: "GitHub 응답 형식이 올바르지 않습니다.",
        code: "GITHUB_BAD_RESPONSE",
        statusCode: 502,
        expose: false,
      });
    }
    if (pull.draft === true) {
      throw new AppError({
        message: "초안 Pull Request는 리뷰하지 않습니다.",
        code: "DRAFT_PULL_REQUEST",
        statusCode: 409,
        expose: true,
      });
    }
    if (pull.state !== "open") {
      throw new AppError({
        message: "열린 Pull Request만 리뷰합니다.",
        code: "PULL_REQUEST_CLOSED",
        statusCode: 409,
        expose: true,
      });
    }

    const updatedAt = deps.now?.() ?? Date.now();
    const reviewLanguage = reviewLanguageFrom(language);
    const job: ReviewJob = {
      deliveryId: randomUUID(),
      action: "synchronize",
      installationId,
      repositoryFullName: `${target.owner}/${target.repo}`,
      owner: target.owner,
      repo: target.repo,
      pullNumber: target.pullNumber,
      headSha: pull.head.sha.toLowerCase(),
      language: reviewLanguage,
    };
    deps.enqueue(job);
    deps.logger.info(
      {
        outcome: "manual-review-accepted",
        installationId,
        repository: job.repositoryFullName,
        pullNumber: job.pullNumber,
        headSha: job.headSha,
        language: reviewLanguage,
      },
      "manual review accepted",
    );
    return {
      deliveryId: job.deliveryId,
      owner: job.owner,
      repo: job.repo,
      pullNumber: job.pullNumber,
      headSha: job.headSha,
      status: "pending",
      language: reviewLanguage,
      updatedAt,
    };
  };
}
