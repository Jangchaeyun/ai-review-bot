/** 큐에 들어간 작업을 테스트가 나중에 확인한다. 실제 리뷰는 실행하지 않는다. */
import type { ReviewJobQueue } from "../../src/services/review-job-queue.js";
import type { ReviewJob } from "../../src/services/review-job.js";

export function createRecordingReviewJobQueue(): ReviewJobQueue & { readonly jobs: ReviewJob[] } {
  const jobs: ReviewJob[] = [];
  return {
    jobs,
    enqueue(job) {
      jobs.push(job);
    },
  };
}
