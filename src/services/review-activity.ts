/**
 * 콘솔에 보여주는 작업 기록. 큐 안의 전체 페이로드가 아니라 상태와 요약만 담는다.
 */
import type { ReviewLanguage } from "./review-language.js";
import type { ReviewSummary } from "./review-summary.js";

export const REVIEW_JOB_STATUSES = ["pending", "running", "done", "failed", "superseded"] as const;

export type ReviewJobStatus = (typeof REVIEW_JOB_STATUSES)[number];

export type ReviewJobRecord = {
  deliveryId: string;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  status: ReviewJobStatus;
  updatedAt: number;
  language?: ReviewLanguage;
  summary?: ReviewSummary;
};

export type ReviewActivity = {
  listJobs(limit?: number): ReviewJobRecord[];
};
