import { z } from "zod";
import { SEVERITIES, type Severity } from "../schemas/review-finding.schema.js";

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const reviewSummarySchema = z.object({
  outcome: z.enum(["posted", "skipped", "agents-failed", "failed"]),
  reason: z.enum(["draft", "stale-head", "duplicate"]).optional(),
  partialFailure: z.boolean().optional(),
  reviewId: z.number().int().positive().optional(),
  counts: z.object({
    critical: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
  highlights: z.array(z.object({
    severity: z.enum(SEVERITIES),
    title: z.string().min(1).max(120),
    filePath: z.string().min(1).max(1024),
  })).max(5),
});

export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

type SummaryFinding = {
  severity: Severity;
  title: string;
  filePath: string;
};

function clip(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLength);
}

export function buildReviewSummary(input: {
  outcome: ReviewSummary["outcome"];
  reason?: ReviewSummary["reason"];
  partialFailure?: boolean;
  reviewId?: number;
  findings?: readonly SummaryFinding[];
}): ReviewSummary {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const highlights: ReviewSummary["highlights"] = [];
  const ranked = [...(input.findings ?? [])].sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]);
  for (const finding of ranked) {
    counts[finding.severity] += 1;
    const title = clip(finding.title, 120);
    const filePath = clip(finding.filePath, 1024);
    if (highlights.length < 5 && title.length > 0 && filePath.length > 0) {
      highlights.push({ severity: finding.severity, title, filePath });
    }
  }
  const summary: ReviewSummary = {
    outcome: input.outcome,
    counts,
    highlights,
  };
  if (input.reason !== undefined) {
    summary.reason = input.reason;
  }
  if (input.partialFailure === true) {
    summary.partialFailure = true;
  }
  if (input.reviewId !== undefined) {
    summary.reviewId = input.reviewId;
  }
  return summary;
}
