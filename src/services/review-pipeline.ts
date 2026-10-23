/**
 * 큐에 들어온 작업으로 diff를 읽고, 세 에이전트를 돌린 뒤 리뷰를 게시한다.
 * 에이전트가 모두 실패하면 댓글을 만들지 않는다.
 */
import type { Logger } from "pino";
import { createReviewAgents } from "../agents/review-agent.js";
import { createReviewRunner, type ReviewRunner } from "../agents/run-review.js";
import { createPullRequestReader, type PullRequestReader } from "../integrations/github/pull-request-reader.js";
import type { FetchLike } from "../integrations/github/github-fetch.js";
import { createReviewPublisher, type ReviewPublisher } from "../integrations/github/review-publisher.js";
import { createOpenAiCompatibleProvider } from "../integrations/llm/openai-provider.js";
import { EMPTY_LLM_USAGE, type LlmUsage } from "../integrations/llm/llm-provider.js";
import type { Env } from "../schemas/env.schema.js";
import { AppError } from "../utils/app-error.js";
import { InMemoryReviewMetrics, type ReviewMetricSnapshot } from "./review-metrics.js";
import { createInMemoryReviewJobQueue, type ReviewJobHandler, type ReviewJobQueue } from "./review-job-queue.js";
import type { ReviewJob } from "./review-job.js";
import { buildReviewSummary, type ReviewSummary } from "./review-summary.js";
import { reviewLanguageFrom, type ReviewLanguage } from "./review-language.js";
import { InMemoryReviewPublishStore, type ReviewPublishStore } from "./review-publish-store.js";
import { createRequestReview } from "./request-review.js";
import { createMemoryAccountStore, type AccountStore } from "./account-store.js";
import { openReviewState } from "./sqlite-review-state.js";
import type { ReviewJobRecord } from "./review-activity.js";
import type { DeliveryStore } from "./delivery-store.js";

export type ReviewPipelineDeps = {
  reader: PullRequestReader;
  runner: ReviewRunner;
  publisher: ReviewPublisher;
  logger: Logger;
  metrics: InMemoryReviewMetrics;
  now?: () => number;
  onFinished?: (deliveryId: string, summary: ReviewSummary) => void;
};

export function createReviewPipeline(deps: ReviewPipelineDeps): ReviewJobHandler {
  const now = deps.now ?? Date.now;

  return async (job: ReviewJob) => {
    const started = now();
    let usage: LlmUsage = EMPTY_LLM_USAGE;
    try {
      const read = await deps.reader.read({
        installationId: job.installationId,
        owner: job.owner,
        repo: job.repo,
        pullNumber: job.pullNumber,
      });
      // 작업에 언어가 없으면 한국어로 분석하고 댓글도 한국어로 조립한다.
      const language = reviewLanguageFrom(job.language);
      const review = await deps.runner.run({
        title: read.metadata.title,
        files: read.files.map((file) => ({ path: file.path, patch: file.patch })),
        language,
      });
      usage = review.usage;

      if (review.status === "failed") {
        // 세 에이전트가 모두 실패하면 빈 댓글을 남기지 않는다.
        deps.onFinished?.(job.deliveryId, buildReviewSummary({ outcome: "agents-failed" }));
        logFinished(deps, job, started, now(), usage, deps.metrics.record("failed"), {
          result: "agents-failed",
          code: review.code,
        });
        return;
      }

      const published = await deps.publisher.publish({
        installationId: job.installationId,
        owner: job.owner,
        repo: job.repo,
        pullNumber: job.pullNumber,
        headSha: job.headSha,
        draft: read.metadata.draft,
        files: read.files.map((file) => ({ path: file.path, patch: file.patch })),
        findings: review.findings,
        partialFailure: review.partialFailure,
        language,
      });
      const counts = deps.metrics.record("handled");
      if (published.status === "posted") {
        deps.onFinished?.(job.deliveryId, buildReviewSummary({
          outcome: "posted",
          partialFailure: review.partialFailure,
          reviewId: published.reviewId,
          findings: review.findings,
        }));
        logFinished(deps, job, started, now(), usage, counts, {
          result: "posted",
          reviewId: published.reviewId,
          inlineCount: published.inlineCount,
          fallback: published.fallback,
          partialFailure: review.partialFailure,
        });
        return;
      }
      deps.onFinished?.(job.deliveryId, buildReviewSummary({
        outcome: "skipped",
        reason: published.reason,
        partialFailure: review.partialFailure,
        findings: review.findings,
      }));
      logFinished(deps, job, started, now(), usage, counts, {
        result: "skipped",
        reason: published.reason,
      });
    } catch (error) {
      const failure = error instanceof AppError
        ? { code: error.code, statusCode: error.statusCode }
        : { code: "REVIEW_FAILED", statusCode: 500 };
      deps.onFinished?.(job.deliveryId, buildReviewSummary({ outcome: "failed" }));
      logFinished(deps, job, started, now(), usage, deps.metrics.record("failed"), {
        result: "failed",
        code: failure.code,
        statusCode: failure.statusCode,
      });
    }
  };
}

function logFinished(
  deps: ReviewPipelineDeps,
  job: ReviewJob,
  started: number,
  finished: number,
  usage: LlmUsage,
  metrics: ReviewMetricSnapshot,
  fields: Record<string, string | number | boolean>,
): void {
  const payload = {
    outcome: "review-finished",
    deliveryId: job.deliveryId,
    repository: job.repositoryFullName,
    pullNumber: job.pullNumber,
    headSha: job.headSha,
    language: reviewLanguageFrom(job.language),
    durationMs: Math.max(0, finished - started),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    handled: metrics.handled,
    failed: metrics.failed,
    failureRate: metrics.failureRate,
    ...fields,
  };
  if (fields.result === "failed" || fields.result === "agents-failed") {
    deps.logger.error(payload, "review finished");
    return;
  }
  deps.logger.info(payload, "review finished");
}

export type ReviewRuntimeDeps = {
  env: Env;
  logger: Logger;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  publishStore?: ReviewPublishStore;
  metrics?: InMemoryReviewMetrics;
};

export type ReviewRuntime = {
  queue: ReviewJobQueue;
  metrics: InMemoryReviewMetrics;
  deliveries?: DeliveryStore;
  listJobs: (limit?: number) => ReviewJobRecord[];
  requestReview: (pullRequestUrl: string, language?: ReviewLanguage, requestedBy?: string) => Promise<ReviewJobRecord>;
  accounts: AccountStore;
  close(): Promise<void>;
};

export function createReviewRuntime(deps: ReviewRuntimeDeps): ReviewRuntime {
  const metrics = deps.metrics ?? new InMemoryReviewMetrics();
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const persistent = deps.env.REVIEW_STATE_PATH === "memory"
    ? undefined
    : openReviewState(deps.env.REVIEW_STATE_PATH, { now });
  const reader = createPullRequestReader({
    appId: deps.env.GITHUB_APP_ID,
    privateKey: deps.env.GITHUB_APP_PRIVATE_KEY,
    baseUrl: deps.env.GITHUB_API_BASE_URL,
    timeoutMs: deps.env.GITHUB_REQUEST_TIMEOUT_MS,
    limits: {
      maxFiles: deps.env.REVIEW_MAX_FILES,
      maxFileBytes: deps.env.REVIEW_MAX_FILE_BYTES,
      maxDiffBytes: deps.env.REVIEW_MAX_DIFF_BYTES,
    },
    logger: deps.logger,
    ...(deps.fetchImpl === undefined ? {} : { fetch: deps.fetchImpl }),
    sleep,
    now,
  });
  const provider = createOpenAiCompatibleProvider({
    apiKey: deps.env.LLM_API_KEY,
    baseUrl: deps.env.LLM_BASE_URL,
    model: deps.env.LLM_MODEL,
    timeoutMs: deps.env.LLM_REQUEST_TIMEOUT_MS,
    ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
    sleep,
    now,
  });
  const publisher = createReviewPublisher({
    appId: deps.env.GITHUB_APP_ID,
    privateKey: deps.env.GITHUB_APP_PRIVATE_KEY,
    baseUrl: deps.env.GITHUB_API_BASE_URL,
    timeoutMs: deps.env.GITHUB_REQUEST_TIMEOUT_MS,
    maxInlineComments: deps.env.REVIEW_MAX_INLINE_COMMENTS,
    logger: deps.logger,
    store: deps.publishStore ?? persistent?.publications ?? new InMemoryReviewPublishStore(),
    ...(deps.fetchImpl === undefined ? {} : { fetch: deps.fetchImpl }),
    sleep,
    now,
  });
  const pipeline = createReviewPipeline({
    reader,
    runner: createReviewRunner(createReviewAgents(provider, deps.env.LLM_MAX_INPUT_CHARS), deps.logger),
    publisher,
    logger: deps.logger,
    metrics,
    now,
    ...(persistent === undefined
      ? {}
      : {
          onFinished: (deliveryId: string, summary: ReviewSummary) => {
            try {
              persistent.recordSummary(deliveryId, summary);
            } catch (error: unknown) {
              deps.logger.error(
                { errorName: error instanceof Error ? error.name : "UnknownError", deliveryId },
                "review summary save failed",
              );
            }
          },
        }),
  });
  if (persistent === undefined) {
    const queue = createInMemoryReviewJobQueue(pipeline, deps.logger);
    return {
      metrics,
      queue,
      listJobs: () => [],
      accounts: createMemoryAccountStore(now),
      requestReview: createRequestReview({
        env: deps.env,
        logger: deps.logger,
        enqueue: (job) => queue.enqueue(job),
        ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
        sleep,
        now,
      }),
      close: async () => {
        await queue.close?.();
      },
    };
  }

  const queue = persistent.createQueue(pipeline, deps.logger);
  return {
    metrics,
    queue,
    deliveries: persistent.deliveries,
    listJobs: (limit?: number) => persistent.listJobs(limit),
    accounts: persistent.accounts,
    requestReview: createRequestReview({
      env: deps.env,
      logger: deps.logger,
      enqueue: (job) => queue.enqueue(job),
      ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
      sleep,
      now,
    }),
    close: async () => {
      await queue.close();
      persistent.close();
    },
  };
}
