/**
 * 리뷰 작업 큐. Webhook은 여기 넣은 뒤 바로 202를 반환하고, 핸들러는 응답 다음에 실행된다.
 * 메모리 구현은 테스트용이다. 운영은 SQLite 큐를 쓴다.
 */
import type { Logger } from "pino";
import type { ReviewJob } from "./review-job.js";

export interface ReviewJobQueue {
  enqueue(job: ReviewJob): void;
  close?(): Promise<void>;
}

export type ReviewJobHandler = (job: ReviewJob) => void | Promise<void>;

/** 큐에 넣은 작업의 식별자만 로그한다. 제목과 diff는 남기지 않는다. */
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

/** 테스트용 큐다. 핸들러는 setImmediate로 호출한 뒤 응답 다음에 실행된다. */
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
