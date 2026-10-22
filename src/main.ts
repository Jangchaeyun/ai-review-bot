import { createApp } from "./app.js";
import { loadDotEnv } from "./services/load-dotenv.js";
import { parseEnv } from "./services/load-env.js";
import { createReviewRuntime } from "./services/review-pipeline.js";
import type { Env } from "./schemas/env.schema.js";
import { createLogger } from "./utils/logger.js";

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
    ...(runtime.deliveries === undefined ? {} : { deliveryStore: runtime.deliveries }),
  });
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, service: env.SERVICE_NAME }, "server started");
  });

  let stopping = false;
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
