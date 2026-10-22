/**
 * 설치 토큰으로 Pull Request 메타데이터와 diff를 읽는다.
 * 응답의 URL을 따라가지 않고, diff 본문은 로그에 남기지 않는다.
 */
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { Logger } from "pino";
import { z, ZodError } from "zod";
import { AppError } from "../../utils/app-error.js";
import { normalizePrivateKey } from "../../utils/private-key.js";
import { createGithubFetch, type FetchLike } from "./github-fetch.js";
import {
  selectReviewFiles,
  type GithubChangedFile,
  type GithubFileStatus,
  type ReviewableFile,
  type ReviewLimits,
  type SkippedFile,
} from "./review-scope.js";

const READ_PERMISSIONS = {
  metadata: "read",
  contents: "read",
  pull_requests: "read",
} as const;

const REPOSITORY_NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/i;

const installationAuthSchema = z.object({
  token: z.string().min(1).max(500),
  expiresAt: z.string().min(1).max(64),
});

const pullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().optional(),
  user: z.object({ login: z.string().min(1).max(100) }).nullable(),
  base: z.object({
    ref: z.string().min(1).max(255),
    sha: z.string().regex(SHA),
  }),
  head: z.object({
    ref: z.string().min(1).max(255),
    sha: z.string().regex(SHA),
  }),
  changed_files: z.number().int().nonnegative().optional(),
});

const commitSchema = z.object({
  sha: z.string().regex(SHA),
  tree: z.object({
    sha: z.string().regex(SHA),
  }),
});

const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string().optional(),
      type: z.string().optional(),
      size: z.number().int().nonnegative().optional(),
    }),
  ),
});

const pullFileSchema = z.object({
  filename: z.string().min(1).max(4096),
  status: z.enum(["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"]),
  patch: z.string().optional(),
  previous_filename: z.string().min(1).max(4096).optional(),
});

export type PullRequestMetadata = {
  number: number;
  title: string;
  draft: boolean;
  state: "open" | "closed";
  authorLogin: string | null;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
};

export type PullRequestReadResult = {
  metadata: PullRequestMetadata;
  files: ReviewableFile[];
  skipped: SkippedFile[];
  fileListIncomplete: boolean;
  limits: ReviewLimits;
};

export type PullRequestQuery = {
  installationId: number;
  owner: string;
  repo: string;
  pullNumber: number;
};

export type PullRequestReaderDeps = {
  appId: string;
  privateKey: string;
  baseUrl: string;
  timeoutMs: number;
  limits: ReviewLimits;
  logger: Logger;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type PullRequestReader = {
  read(query: PullRequestQuery): Promise<PullRequestReadResult>;
};

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maxLength);
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

function githubFailure(error: unknown): AppError {
  const appError = unwrapAppError(error);
  if (appError !== undefined) {
    return appError;
  }
  if (error instanceof ZodError) {
    return badResponse();
  }

  const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;

  if (status === 401) {
    return new AppError({
      message: "GitHub App 인증에 실패했습니다.",
      code: "GITHUB_UNAUTHORIZED",
      statusCode: 401,
      expose: false,
    });
  }
  if (status === 403) {
    return new AppError({
      message: "GitHub API 권한이 없습니다.",
      code: "GITHUB_FORBIDDEN",
      statusCode: 403,
      expose: false,
    });
  }
  if (status === 404) {
    return new AppError({
      message: "Pull Request를 찾을 수 없습니다.",
      code: "GITHUB_NOT_FOUND",
      statusCode: 404,
      expose: false,
    });
  }
  if (status === 422) {
    return new AppError({
      message: "GitHub가 요청을 처리하지 못했습니다.",
      code: "GITHUB_UNPROCESSABLE",
      statusCode: 422,
      expose: false,
    });
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
  });
}

function sanitizeLogMessage(message: unknown): string {
  const text = typeof message === "string" ? message : "";
  return text
    .replace(/bearer\s+\S+/gi, "bearer [Redacted]")
    .replace(/token\s+\S+/gi, "token [Redacted]")
    .replace(/\b(?:ghs_|ghu_|gho_|ghp_|github_pat_)[A-Za-z0-9_]+\b/g, "[Redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[Redacted]")
    .replace(/-----BEGIN[\s\S]*?-----END [^-]+-----/g, "[Redacted]");
}

function octokitLog(logger: Logger) {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: unknown) => {
      logger.warn({ source: "octokit", detail: sanitizeLogMessage(message) }, "github client warning");
    },
    error: (message: unknown) => {
      logger.error({ source: "octokit", detail: sanitizeLogMessage(message) }, "github client error");
    },
  };
}

function assertQuery(query: PullRequestQuery): PullRequestQuery {
  if (!REPOSITORY_NAME.test(query.owner) || !REPOSITORY_NAME.test(query.repo)) {
    throw new AppError({
      message: "저장소 이름이 올바르지 않습니다.",
      code: "INVALID_REPOSITORY",
      statusCode: 400,
    });
  }
  if (!Number.isInteger(query.pullNumber) || query.pullNumber < 1) {
    throw new AppError({
      message: "Pull Request 번호가 올바르지 않습니다.",
      code: "INVALID_PULL_REQUEST",
      statusCode: 400,
    });
  }
  if (!Number.isInteger(query.installationId) || query.installationId < 1) {
    throw new AppError({
      message: "GitHub App 설치 ID가 올바르지 않습니다.",
      code: "INVALID_INSTALLATION",
      statusCode: 400,
    });
  }
  return query;
}

function linkHeader(headers: unknown): string {
  if (typeof headers !== "object" || headers === null || !("link" in headers)) {
    return "";
  }
  return typeof headers.link === "string" ? headers.link : "";
}

function badResponse(): AppError {
  return new AppError({
    message: "GitHub 응답 형식이 올바르지 않습니다.",
    code: "GITHUB_BAD_RESPONSE",
    statusCode: 502,
    expose: false,
  });
}

export function createPullRequestReader(deps: PullRequestReaderDeps): PullRequestReader {
  const privateKey = normalizePrivateKey(deps.privateKey);
  const fetchImpl = createGithubFetch({
    fetchImpl: deps.fetch ?? globalThis.fetch,
    timeoutMs: deps.timeoutMs,
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: deps.now ?? Date.now,
    onRetry: ({ statusCode, attempt, delayMs }) => {
      deps.logger.warn({ statusCode, attempt, delayMs }, "github api retry");
    },
  });
  const log = octokitLog(deps.logger);
  const authClient = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: deps.appId,
      privateKey,
    },
    baseUrl: deps.baseUrl,
    userAgent: "ai-review-bot",
    request: { fetch: fetchImpl },
    log,
  });

  return {
    async read(input) {
      const query = assertQuery(input);
      const repository = `${query.owner}/${query.repo}`;
      try {
        const authentication = installationAuthSchema.parse(
          await authClient.auth({
            type: "installation",
            installationId: query.installationId,
            repositoryNames: [query.repo],
            permissions: READ_PERMISSIONS,
          }),
        );
        const api = new Octokit({
          auth: authentication.token,
          baseUrl: deps.baseUrl,
          userAgent: "ai-review-bot",
          request: { fetch: fetchImpl },
          log,
        });
        const result = await readWithClient(api, query, deps.limits);
        const skipped = countSkipped(result.skipped);
        deps.logger.info(
          {
            outcome: "selected",
            installationId: query.installationId,
            repository,
            pullNumber: query.pullNumber,
            headSha: result.metadata.headSha,
            reviewableCount: result.files.length,
            skipped,
            fileListIncomplete: result.fileListIncomplete,
          },
          "pull request files selected",
        );
        return result;
      } catch (error) {
        const failure = githubFailure(error);
        deps.logger.error(
          {
            outcome: "failed",
            code: failure.code,
            statusCode: failure.statusCode,
            installationId: query.installationId,
            repository,
            pullNumber: query.pullNumber,
          },
          "pull request read failed",
        );
        throw failure;
      }
    },
  };
}

async function readWithClient(api: Octokit, query: PullRequestQuery, limits: ReviewLimits): Promise<PullRequestReadResult> {
  const pullResponse = await api.rest.pulls.get({
    owner: query.owner,
    repo: query.repo,
    pull_number: query.pullNumber,
  });
  const pull = pullSchema.safeParse(pullResponse.data);
  if (!pull.success) {
    throw badResponse();
  }

  const commitResponse = await api.rest.git.getCommit({
    owner: query.owner,
    repo: query.repo,
    commit_sha: pull.data.head.sha,
  });
  const commit = commitSchema.safeParse(commitResponse.data);
  if (!commit.success || commit.data.sha.toLowerCase() !== pull.data.head.sha.toLowerCase()) {
    throw badResponse();
  }

  const treeResponse = await api.rest.git.getTree({
    owner: query.owner,
    repo: query.repo,
    tree_sha: commit.data.tree.sha,
    recursive: "1",
  });
  const tree = treeSchema.safeParse(treeResponse.data);
  if (!tree.success) {
    throw badResponse();
  }

  const listed = await listAllFiles(api, query);
  const sizes = blobSizes(tree.data.tree);
  const changedFiles: GithubChangedFile[] = [];
  const invalidSkipped: SkippedFile[] = [];

  for (const entry of listed.files) {
    const parsed = pullFileSchema.safeParse(entry);
    if (!parsed.success) {
      invalidSkipped.push({ path: "[invalid-file]", reason: "invalid-metadata" });
      continue;
    }
    const sizeBytes = sizes.get(parsed.data.filename) ?? null;
    changedFiles.push({
      path: parsed.data.filename,
      ...(parsed.data.previous_filename === undefined ? {} : { previousPath: parsed.data.previous_filename }),
      status: parsed.data.status satisfies GithubFileStatus,
      ...(parsed.data.patch === undefined ? {} : { patch: parsed.data.patch }),
      sizeBytes,
    });
  }

  const selected = selectReviewFiles(changedFiles, limits);
  return {
    metadata: {
      number: pull.data.number,
      title: sanitizeText(pull.data.title, 512),
      draft: pull.data.draft ?? false,
      state: pull.data.state,
      authorLogin: pull.data.user?.login ?? null,
      baseRef: sanitizeText(pull.data.base.ref, 255),
      baseSha: pull.data.base.sha,
      headRef: sanitizeText(pull.data.head.ref, 255),
      headSha: pull.data.head.sha,
    },
    files: selected.files,
    skipped: [...invalidSkipped, ...selected.skipped],
    fileListIncomplete: listed.incomplete || (pull.data.changed_files !== undefined && pull.data.changed_files > listed.files.length),
    limits,
  };
}

async function listAllFiles(api: Octokit, query: PullRequestQuery): Promise<{ files: unknown[]; incomplete: boolean }> {
  const files: unknown[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const response = await api.rest.pulls.listFiles({
      owner: query.owner,
      repo: query.repo,
      pull_number: query.pullNumber,
      per_page: 100,
      page,
    });
    const batch = z.array(z.unknown()).safeParse(response.data);
    if (!batch.success) {
      throw badResponse();
    }
    files.push(...batch.data);
    const link = linkHeader(response.headers);
    if (!link.includes('rel="next"') || batch.data.length === 0) {
      return { files, incomplete: false };
    }
  }
  return { files, incomplete: true };
}

function blobSizes(entries: ReadonlyArray<{ path?: string | undefined; type?: string | undefined; size?: number | undefined }>): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type === "blob" && entry.path !== undefined && entry.size !== undefined) {
      sizes.set(entry.path, entry.size);
    }
  }
  return sizes;
}

function countSkipped(skipped: readonly SkippedFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of skipped) {
    counts[file.reason] = (counts[file.reason] ?? 0) + 1;
  }
  return counts;
}
