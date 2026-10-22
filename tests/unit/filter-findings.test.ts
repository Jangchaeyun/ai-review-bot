/** 근거 필터, 발견 파싱, 중복 통합을 확인한다. */
import { describe, expect, it } from "vitest";
import { aggregateFindings, type SourcedFinding } from "../../src/agents/aggregate-findings.js";
import { indexPatch } from "../../src/agents/diff-index.js";
import { filterFindings, SECURITY_UNCERTAIN_NOTE } from "../../src/agents/filter-findings.js";
import { parseFindings } from "../../src/agents/parse-findings.js";
import type { ReviewFinding } from "../../src/schemas/review-finding.schema.js";

const PATCH = [
  "@@ -1,3 +1,3 @@",
  " function ping(userInput) {",
  "-  return userInput;",
  "+  return eval(userInput);",
  " }",
].join("\n");

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    category: "security",
    severity: "high",
    title: "eval로 입력을 실행합니다",
    filePath: "src/ping.ts",
    lineStart: 2,
    lineEnd: 2,
    evidence: "return eval(userInput);",
    explanation: "사용자 입력이 eval로 전달됩니다.",
    suggestion: "입력을 실행하지 않는 파서를 사용합니다.",
    confidence: 0.9,
    ...overrides,
  };
}

describe("diff index and finding filter", () => {
  it("maps added and context lines and ignores removed lines", () => {
    const index = indexPatch("src/ping.ts", PATCH);
    expect(index.lines.get(1)).toBe("function ping(userInput) {");
    expect(index.lines.get(2)).toBe("  return eval(userInput);");
    expect(index.lines.get(3)).toBe("}");
    expect([...index.lines.values()].join("\n")).not.toContain("return userInput");
  });

  it("keeps a finding whose evidence and lines exist in the new file side", () => {
    const result = filterFindings([finding()], [{ path: "src/ping.ts", patch: PATCH }]);
    expect(result.droppedCount).toBe(0);
    expect(result.accepted).toHaveLength(1);
  });

  it("drops unknown paths, removed-line evidence, and out-of-range lines", () => {
    const result = filterFindings(
      [
        finding({ filePath: "src/missing.ts" }),
        finding({ evidence: "return userInput;" }),
        finding({ lineStart: 40, lineEnd: 41 }),
        finding({ evidence: "not in the diff at all" }),
      ],
      [{ path: "src/ping.ts", patch: PATCH }],
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.droppedCount).toBe(4);
  });

  it("returns an empty acceptance list for an empty model result", () => {
    const result = filterFindings([], [{ path: "src/ping.ts", patch: PATCH }]);
    expect(result).toEqual({ accepted: [], droppedCount: 0 });
  });

  it("strips urls that are not present in the diff", () => {
    const result = filterFindings(
      [
        finding({
          explanation: "자세한 내용은 https://evil.example/steal 을 참고합니다.",
          suggestion: "https://example.com/docs 는 diff에 없습니다.",
        }),
      ],
      [{ path: "src/ping.ts", patch: PATCH }],
    );
    const accepted = result.accepted[0];
    expect(accepted?.explanation).not.toContain("https://");
    expect(accepted?.suggestion).not.toContain("https://");
  });

  it("downgrades an uncertain security finding to low", () => {
    const result = filterFindings([finding({ confidence: 0.4, severity: "critical" })], [{ path: "src/ping.ts", patch: PATCH }]);
    expect(result.accepted[0]).toMatchObject({ severity: "low" });
    expect(result.accepted[0]?.explanation).toContain(SECURITY_UNCERTAIN_NOTE);
  });

  it("adds an English uncertainty note when the review language is English", () => {
    const result = filterFindings(
      [finding({ confidence: 0.4, severity: "critical", explanation: "The input reaches eval." })],
      [{ path: "src/ping.ts", patch: PATCH }],
      "en",
    );
    expect(result.accepted[0]?.severity).toBe("low");
    expect(result.accepted[0]?.explanation).toContain("This is not certain.");
    expect(result.accepted[0]?.explanation).not.toContain(SECURITY_UNCERTAIN_NOTE);
  });
});

describe("parseFindings", () => {
  it("parses fenced JSON and drops items that fail the schema", () => {
    const content = "```json\n" + JSON.stringify({
      findings: [finding({ category: "quality" }), { title: "broken" }, finding({ category: "security" })],
    }) + "\n```";
    const parsed = parseFindings(content, "security");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.category).toBe("security");
    expect(parsed.droppedCount).toBe(2);
  });

  it("accepts an empty findings array", () => {
    expect(parseFindings(JSON.stringify({ findings: [] }), "quality")).toEqual({ findings: [], droppedCount: 0 });
  });
});

describe("aggregateFindings", () => {
  it("merges overlapping findings with the same gist and keeps the higher severity", () => {
    const quality: SourcedFinding = { ...finding({ category: "quality", severity: "low", confidence: 0.4 }), source: "quality" };
    const security: SourcedFinding = { ...finding({ category: "security", severity: "high", confidence: 0.8 }), source: "security" };
    const merged = aggregateFindings([quality, security]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      severity: "high",
      category: "security",
      sources: ["quality", "security"],
    });
  });

  it("keeps separate findings when the lines or the gist differ", () => {
    const first: SourcedFinding = { ...finding(), source: "security" };
    const otherLines: SourcedFinding = {
      ...finding({ title: "eval로 입력을 실행합니다", lineStart: 1, lineEnd: 1, evidence: "function ping(userInput) {" }),
      source: "quality",
    };
    const otherGist: SourcedFinding = {
      ...finding({ title: "다른 문제입니다", category: "performance" }),
      source: "performance",
    };
    expect(aggregateFindings([first, otherLines, otherGist])).toHaveLength(3);
  });

  it("returns an empty list when there is nothing to merge", () => {
    expect(aggregateFindings([])).toEqual([]);
  });
});
