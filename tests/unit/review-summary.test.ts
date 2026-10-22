/** 작업 기록에 남기는 요약이 심각도 개수와 제목만 가지는지 확인한다. */
import { describe, expect, it } from "vitest";
import { buildReviewSummary } from "../../src/services/review-summary.js";

describe("buildReviewSummary", () => {
  it("keeps the five highest findings and counts every severity", () => {
    const summary = buildReviewSummary({
      outcome: "posted",
      reviewId: 9,
      partialFailure: false,
      findings: [
        { severity: "low", title: "낮은 지적", filePath: "a.js" },
        { severity: "critical", title: "치명 지적", filePath: "b.js" },
        { severity: "medium", title: "중간 1", filePath: "c.js" },
        { severity: "medium", title: "중간 2", filePath: "d.js" },
        { severity: "high", title: "높은 지적", filePath: "e.js" },
        { severity: "low", title: "낮은 지적 2", filePath: "f.js" },
      ],
    });

    expect(summary.partialFailure).toBeUndefined();
    expect(summary.counts).toEqual({ critical: 1, high: 1, medium: 2, low: 2 });
    expect(summary.highlights.map((item) => item.severity)).toEqual(["critical", "high", "medium", "medium", "low"]);
    expect(summary.highlights).toHaveLength(5);
  });
});
