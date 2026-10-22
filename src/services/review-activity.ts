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
