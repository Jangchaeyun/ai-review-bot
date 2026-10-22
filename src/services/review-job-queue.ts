import type { Logger } from "pino";
import type { ReviewJob } from "./review-job.js";

export interface ReviewJobQueue {
  enqueue(job: ReviewJob): void;
  close?(): Promise<void>;
}

export type ReviewJobHandler = (job: ReviewJob) => void | Promise<void>;

export function logAcceptedReviewJob(logger: Logger): ReviewJobHandler {
  return (job) => {
    logger.info(
      {
        outcome: "queued",
        deliveryId: job.deliveryId,
        action: job.action,
        repository: job.repositoryFullName,
        pullRequestNumber: job.pullNumber,
        headSha: job.headSha,
        installationId: job.installationId,
      },
      "review job accepted",
    );
  };
}

export function createInMemoryReviewJobQueue(handler: ReviewJobHandler, logger: Logger): ReviewJobQueue {
  const inflight = new Set<Promise<void>>();
  return {
    enqueue(job) {
      const task = new Promise<void>((resolve) => {
        setImmediate(() => {
          void Promise.resolve()
            .then(() => handler(job))
            .catch((error: unknown) => {
              logger.error(
                {
                  outcome: "queue-failed",
                  deliveryId: job.deliveryId,
                  errorName: error instanceof Error ? error.name : "UnknownError",
                },
                "review job failed",
              );
            })
            .finally(resolve);
        });
      });
      inflight.add(task);
      void task.finally(() => {
        inflight.delete(task);
      });
    },
    async close() {
      await Promise.all([...inflight]);
    },
  };
}
