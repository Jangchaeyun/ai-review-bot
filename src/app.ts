/**
 * HTTP 앱을 조립한다. listen은 하지 않아서 테스트가 포트를 열지 않고 요청을 보낼 수 있다.
 * Webhook만 raw body를 보존하고, 나머지 경로는 JSON으로 파싱한다.
 */
import express, { type Express, type Router } from "express";
import type { Logger } from "pino";
import { errorMiddleware } from "./middleware/error-middleware.js";
import { notFoundMiddleware } from "./middleware/not-found-middleware.js";
import type { AccountStore } from "./services/account-store.js";
import { createAccountRouter } from "./routes/account.route.js";
import { createConsoleRouter } from "./routes/console.route.js";
import { createGithubWebhookRouter } from "./routes/github-webhook.route.js";
import type { ReviewJobRecord } from "./services/review-activity.js";
import type { ReviewLanguage } from "./services/review-language.js";
import { createHealthRouter } from "./routes/health.route.js";
import type { Env } from "./schemas/env.schema.js";
import { DELIVERY_TTL_MS, InMemoryDeliveryStore, type DeliveryStore } from "./services/delivery-store.js";
import {
  createInMemoryReviewJobQueue,
  logAcceptedReviewJob,
  type ReviewJobQueue,
} from "./services/review-job-queue.js";

export type AppDeps = {
  env: Env;
  logger: Logger;
  extraRouters?: Router[];
  deliveryStore?: DeliveryStore;
  reviewJobQueue?: ReviewJobQueue;
  listJobs?: (limit?: number) => ReviewJobRecord[];
  requestReview?: (pullRequestUrl: string, language?: ReviewLanguage, requestedBy?: string) => Promise<ReviewJobRecord>;
  accounts?: AccountStore;
};

const WEBHOOK_PATH = "/webhooks/github";

/** 헬스, 콘솔, GitHub Webhook 순서로 라우트를 붙이고 마지막에 404와 오류 처리를 둔다. */
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");

  const jsonParser = express.json({ limit: "1mb" });
  // 서명 검증은 수신 바이트 그대로 해야 한다. 전역 JSON 파서가 스트림을 먼저 읽으면
  // Webhook의 raw body가 사라지므로 이 경로만 파서를 건너뛴다.
  app.use((req, res, next) => {
    if (req.path === WEBHOOK_PATH) {
      next();
      return;
    }
    jsonParser(req, res, next);
  });

  app.use("/health", createHealthRouter(deps.env));
  // 계정 저장소가 있을 때만 가입과 로그인을 연다. 테스트 앱은 이 경로를 빼 둘 수 있다.
  if (deps.accounts !== undefined) {
    app.use(createAccountRouter({ accounts: deps.accounts }));
  }
  app.use(createConsoleRouter({
    listJobs: deps.listJobs ?? (() => []),
    ...(deps.requestReview === undefined ? {} : { requestReview: deps.requestReview }),
    ...(deps.accounts === undefined ? {} : { accounts: deps.accounts }),
  }));
  app.use(
    WEBHOOK_PATH,
    createGithubWebhookRouter({
      secret: deps.env.GITHUB_WEBHOOK_SECRET,
      logger: deps.logger,
      deliveryStore: deps.deliveryStore ?? new InMemoryDeliveryStore(DELIVERY_TTL_MS),
      reviewJobQueue:
        deps.reviewJobQueue ?? createInMemoryReviewJobQueue(logAcceptedReviewJob(deps.logger), deps.logger),
    }),
  );

  for (const router of deps.extraRouters ?? []) {
    app.use(router);
  }

  app.use(notFoundMiddleware);
  app.use(errorMiddleware(deps.logger));
  return app;
}
