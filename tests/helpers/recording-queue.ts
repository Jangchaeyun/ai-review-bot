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
