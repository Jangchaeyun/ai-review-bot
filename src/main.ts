/**
 * 프로세스 시작점이다. 환경변수를 읽고 서버를 연 뒤, 종료 신호에서는 진행 중인 리뷰가 끝날 때까지 기다린다.
 * 테스트는 이 파일을 실행하지 않고 createApp만 사용한다.
 */
import { createApp } from "./app.js";
import { loadDotEnv } from "./services/load-dotenv.js";
import { parseEnv } from "./services/load-env.js";
import { createReviewRuntime } from "./services/review-pipeline.js";
import type { Env } from "./schemas/env.schema.js";
import { createLogger } from "./utils/logger.js";

/** 필수 환경변수가 없으면 값을 로그에 남기지 않고 프로세스를 끝낸다. */
function readEnv(): Env {
  try {
    loadDotEnv();
    return parseEnv(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "환경변수를 읽지 못했습니다.";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

/** 앱을 열고 종료 신호에서는 서버와 리뷰 상태 파일을 닫은 뒤 프로세스를 끝낸다. */
function main(): void {
  const env = readEnv();
  const logger = createLogger(env);
  const runtime = createReviewRuntime({ env, logger });
  const app = createApp({
    env,
    logger,
    reviewJobQueue: runtime.queue,
    listJobs: runtime.listJobs,
    requestReview: runtime.requestReview,
    accounts: runtime.accounts,
    ...(runtime.deliveries === undefined ? {} : { deliveryStore: runtime.deliveries }),
  });
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, service: env.SERVICE_NAME }, "server started");
  });

  let stopping = false;
  // 같은 신호가 두 번 와도 close를 한 번만 호출한다.
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info({ signal }, "server shutting down");
    server.close((closeError) => {
      if (closeError) {
        logger.error({ errorName: closeError.name }, "server close failed");
        process.exit(1);
      }
      void runtime.close().then(() => {
        process.exit(0);
      }).catch((error: unknown) => {
        logger.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "review state close failed",
        );
        process.exit(1);
      });
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
