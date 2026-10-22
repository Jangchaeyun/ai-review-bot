import type { Express, Router } from "express";
import { createApp, type AppDeps } from "../../src/app.js";
import { parseEnv } from "../../src/services/load-env.js";
import type { DeliveryStore } from "../../src/services/delivery-store.js";
import type { ReviewJobQueue } from "../../src/services/review-job-queue.js";
import type { ReviewJobRecord } from "../../src/services/review-activity.js";
import type { ReviewLanguage } from "../../src/services/review-language.js";
import { createLogger } from "../../src/utils/logger.js";

export const TEST_WEBHOOK_SECRET = "test-webhook-secret";
export const TEST_GITHUB_APP_ID = "123456";
export const TEST_GITHUB_APP_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----";

export function requiredTestEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    GITHUB_APP_ID: TEST_GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY: TEST_GITHUB_APP_PRIVATE_KEY,
    REVIEW_STATE_PATH: "memory",
    ...overrides,
  };
}

export type TestAppOverrides = {
  deliveryStore?: DeliveryStore;
  reviewJobQueue?: ReviewJobQueue;
  listJobs?: (limit?: number) => ReviewJobRecord[];
  requestReview?: (pullRequestUrl: string, language?: ReviewLanguage) => Promise<ReviewJobRecord>;
};

export function createTestApp(extraRouters?: Router[], overrides?: TestAppOverrides): Express {
  const env = parseEnv(requiredTestEnv({ SERVICE_NAME: "ai-review-bot" }));
  const logger = createLogger(env, { level: "silent" });
  const deps: AppDeps = { env, logger };

  if (extraRouters !== undefined) {
    deps.extraRouters = extraRouters;
  }
  if (overrides?.deliveryStore !== undefined) {
    deps.deliveryStore = overrides.deliveryStore;
  }
  if (overrides?.reviewJobQueue !== undefined) {
    deps.reviewJobQueue = overrides.reviewJobQueue;
  }
  if (overrides?.listJobs !== undefined) {
    deps.listJobs = overrides.listJobs;
  }
  if (overrides?.requestReview !== undefined) {
    deps.requestReview = overrides.requestReview;
  }

  return createApp(deps);
}
