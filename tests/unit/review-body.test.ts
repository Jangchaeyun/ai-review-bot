/** 리뷰 본문과 인라인 코멘트가 서버 규칙대로 조립되는지 확인한다. */
import { describe, expect, it } from "vitest";
import type { AggregatedFinding } from "../../src/agents/aggregate-findings.js";
import { buildReviewPost } from "../../src/integrations/github/review-body.js";

const SHA = "a".repeat(40);
const PATCH = ["@@ -1,2 +1,4 @@", " function ping(userInput) {", "+  const value = userInput;", "+  return eval(value);", " }"].join("\n");

function finding(overrides: Partial<AggregatedFinding> = {}): AggregatedFinding {
  return {
    category: "security",
    severity: "high",
    title: "eval로 입력을 실행합니다",
    filePath: "src/ping.ts",
    lineStart: 3,
    lineEnd: 3,
    evidence: "return eval(value);",
    explanation: "사용자 입력이 eval로 전달됩니다.",
    suggestion: "입력을 실행하지 않는 파서를 사용합니다.",
    confidence: 0.9,
    sources: ["security"],
    ...overrides,
  };
}

const files = [{ path: "src/ping.ts", patch: PATCH }];

describe("buildReviewPost", () => {
  it("groups findings by severity and includes the suggestion", () => {
    const post = buildReviewPost({
      headSha: SHA,
      files,
      partialFailure: true,
      maxInlineComments: 10,
      findings: [finding(), finding({ severity: "low", category: "quality", title: "이름이 짧습니다", sources: ["quality"] })],
    });

    expect(post.body).toContain("## AI 리뷰 요약");
    expect(post.body).toContain("### 높음");
    expect(post.body).toContain("### 낮음");
    expect(post.body).toContain("제안: 입력을 실행하지 않는 파서를 사용합니다.");
    expect(post.body).toContain("일부 분석을 완료하지 못했습니다.");
    expect(post.comments).toHaveLength(1);
    expect(post.comments[0]?.line).toBe(3);
    expect(post.comments[0]?.side).toBe("RIGHT");
  });

  it("uses a multi-line inline comment only when every line exists in the diff", () => {
    const post = buildReviewPost({
      headSha: SHA,
      files,
      partialFailure: false,
      maxInlineComments: 10,
      findings: [
        finding({ severity: "medium", lineStart: 2, lineEnd: 3, title: "연속된 줄" }),
        finding({ severity: "high", lineStart: 90, lineEnd: 91, title: "없는 줄" }),
      ],
    });

    expect(post.comments).toEqual([
      expect.objectContaining({ path: "src/ping.ts", line: 3, start_line: 2, start_side: "RIGHT" }),
    ]);
    expect(post.body).toContain("없는 줄");
  });

  it("writes a summary when there are no findings", () => {
    const post = buildReviewPost({
      headSha: SHA,
      files,
      findings: [],
      partialFailure: false,
      maxInlineComments: 10,
    });

    expect(post.body).toContain("지적할 항목을 찾지 못했습니다.");
    expect(post.comments).toEqual([]);
    expect(post.omittedCount).toBe(0);
  });

  it("keeps low findings in the summary and caps inline comments", () => {
    const post = buildReviewPost({
      headSha: SHA,
      files,
      partialFailure: false,
      maxInlineComments: 1,
      findings: [
        finding({ title: "첫 번째", severity: "critical" }),
        finding({ title: "두 번째", severity: "medium" }),
        finding({ title: "낮은 항목", severity: "low", category: "quality", sources: ["quality"] }),
      ],
    });

    expect(post.comments.map((comment) => comment.body)).toHaveLength(1);
    expect(post.comments[0]?.body).toContain("첫 번째");
    expect(post.body).toContain("낮은 항목");
    expect(post.body).toContain("인라인 코멘트는 심각도 중간 이상 1건만 남깁니다.");
  });

  it("summarizes findings that exceed the detail budget", () => {
    const findings = Array.from({ length: 35 }, (_, index) => finding({ title: `항목 ${index}`, lineStart: 3, lineEnd: 3 }));
    const post = buildReviewPost({
      headSha: SHA,
      files,
      findings,
      partialFailure: false,
      maxInlineComments: 10,
    });

    expect(post.omittedCount).toBe(5);
    expect(post.body).toContain("5건은 이 요약에 적지 않았습니다.");
    expect(post.body.length).toBeLessThanOrEqual(60_000);
  });

  it("writes the summary and inline comment in English when requested", () => {
    const post = buildReviewPost({
      headSha: SHA,
      files,
      partialFailure: true,
      maxInlineComments: 10,
      language: "en",
      findings: [finding({ title: "Input reaches eval", explanation: "User input is passed to eval.", suggestion: "Parse the input instead of executing it." })],
    });

    expect(post.body).toContain("## AI review summary");
    expect(post.body).toContain("### High");
    expect(post.body).toContain("Suggestion: Parse the input instead of executing it.");
    expect(post.body).toContain("Some analysis did not finish.");
    expect(post.body).not.toContain("## AI 리뷰 요약");
    expect(post.comments[0]?.body).toContain("Suggestion: Parse the input instead of executing it.");
  });
});
