/**
 * GitHub에 올릴 리뷰 Markdown과 인라인 코멘트를 서버가 조립한다.
 * 모델이 준 JSON이나 자유 형식 마크다운은 그대로 올리지 않는다.
 */
import type { AggregatedFinding } from "../../agents/aggregate-findings.js";
import { lineRangeInDiff, indexPatch } from "../../agents/diff-index.js";
import type { ReviewFile } from "../../agents/filter-findings.js";
import type { Severity } from "../../schemas/review-finding.schema.js";
import { reviewLanguageFrom, type ReviewLanguage } from "../../services/review-language.js";

const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low"];
const INLINE_SEVERITIES = new Set<Severity>(["critical", "high", "medium"]);
const MAX_BODY_CHARS = 60_000;
const MAX_DETAILED_FINDINGS = 30;
const MAX_INLINE_BODY_CHARS = 2_000;

export type ReviewCommentDraft = {
  path: string;
  body: string;
  line: number;
  side: "RIGHT";
  start_line?: number;
  start_side?: "RIGHT";
};

export type ReviewPostDraft = {
  body: string;
  comments: ReviewCommentDraft[];
  omittedCount: number;
};

export type ReviewBodyInput = {
  headSha: string;
  files: readonly ReviewFile[];
  findings: readonly AggregatedFinding[];
  partialFailure: boolean;
  maxInlineComments: number;
  language?: ReviewLanguage;
};

type ReviewCopy = {
  summaryTitle: string;
  severity: Record<Severity, string>;
  commitLine: (sha: string, fileCount: number) => string;
  partial: string;
  none: string;
  counts: (total: number, parts: string) => string;
  suggestion: (text: string) => string;
  omitted: (count: number) => string;
  inlineCap: (count: number) => string;
  truncated: string;
};

const COPY: Record<ReviewLanguage, ReviewCopy> = {
  ko: {
    summaryTitle: "## AI 리뷰 요약",
    severity: { critical: "치명", high: "높음", medium: "중간", low: "낮음" },
    commitLine: (sha, fileCount) => `커밋 \`${sha}\` 기준입니다. 검토한 파일은 ${fileCount}개입니다.`,
    partial: "일부 분석을 완료하지 못했습니다. 완료된 분석만 반영했습니다.",
    none: "이 커밋에서 지적할 항목을 찾지 못했습니다.",
    counts: (total, parts) => `지적 ${total}건입니다. ${parts}.`,
    suggestion: (text) => `제안: ${text}`,
    omitted: (count) => `길이 제한으로 ${count}건은 이 요약에 적지 않았습니다.`,
    inlineCap: (count) => `인라인 코멘트는 심각도 중간 이상 ${count}건만 남깁니다.`,
    truncated: "\n\n일부 내용은 길이 제한으로 생략했습니다.",
  },
  en: {
    summaryTitle: "## AI review summary",
    severity: { critical: "Critical", high: "High", medium: "Medium", low: "Low" },
    commitLine: (sha, fileCount) => `Based on commit \`${sha}\`. ${fileCount} file${fileCount === 1 ? "" : "s"} reviewed.`,
    partial: "Some analysis did not finish. Only completed analysis is included.",
    none: "No findings in this commit.",
    counts: (total, parts) => `${total} finding${total === 1 ? "" : "s"}. ${parts}.`,
    suggestion: (text) => `Suggestion: ${text}`,
    omitted: (count) => `${count} finding${count === 1 ? "" : "s"} omitted from this summary because of the length limit.`,
    inlineCap: (count) => `Inline comments include only ${count} finding${count === 1 ? "" : "s"} at medium severity or above.`,
    truncated: "\n\nSome text was omitted because of the length limit.",
  },
};

/** 고른 댓글 언어의 문장 묶음이다. 없으면 한국어다. */
function copyFor(language: ReviewLanguage | undefined): ReviewCopy {
  return COPY[reviewLanguageFrom(language)];
}

/** 심각도가 높을수록 앞에 오도록 순서를 숫자로 만든다. */
function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

/** 백틱과 줄바꿈을 빼 모델 문장이 마크다운 구조를 깨지 않게 한다. */
function oneLine(value: string): string {
  return value.replace(/`/g, "'").replace(/\s+/g, " ").trim();
}

/** 요약에 적을 파일과 줄 위치다. */
function lineLabel(finding: AggregatedFinding): string {
  if (finding.lineStart === finding.lineEnd) {
    return `${finding.filePath}:${finding.lineStart}`;
  }
  return `${finding.filePath}:${finding.lineStart}-${finding.lineEnd}`;
}

/** 인라인 위치를 다시 확인할 때 쓸 파일별 diff 인덱스다. */
function indexesFor(files: readonly ReviewFile[]): Map<string, ReturnType<typeof indexPatch>> {
  const indexes = new Map<string, ReturnType<typeof indexPatch>>();
  for (const file of files) {
    if (!indexes.has(file.path)) {
      indexes.set(file.path, indexPatch(file.path, file.patch));
    }
  }
  return indexes;
}

/** 인라인 댓글 본문이다. 제목, 설명, 제안만 서버가 조립한다. */
function inlineBody(finding: AggregatedFinding, copy: ReviewCopy): string {
  const text = [`**${oneLine(finding.title)}** (${copy.severity[finding.severity]})`, "", oneLine(finding.explanation), "", copy.suggestion(oneLine(finding.suggestion))].join("\n");
  if (text.length <= MAX_INLINE_BODY_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_INLINE_BODY_CHARS - 1)}…`;
}

/** 심각도 medium 이상이고 diff에 줄이 있는 발견만 인라인 후보로 둔다. */
function eligibleInlineFindings(input: ReviewBodyInput): AggregatedFinding[] {
  const indexes = indexesFor(input.files);
  return input.findings
    .filter((finding) => INLINE_SEVERITIES.has(finding.severity))
    .filter((finding) => {
      const index = indexes.get(finding.filePath);
      return index !== undefined && lineRangeInDiff(finding.lineStart, finding.lineEnd, index);
    })
    .sort((left, right) => {
      const severityDelta = severityRank(left.severity) - severityRank(right.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      const pathDelta = left.filePath.localeCompare(right.filePath);
      if (pathDelta !== 0) {
        return pathDelta;
      }
      return left.lineStart - right.lineStart;
    });
}

/** 인라인 댓글은 개수 상한까지만 고르고, 위치는 evidence가 있는 줄로 좁힌다. */
export function selectInlineComments(input: ReviewBodyInput): ReviewCommentDraft[] {
  const copy = copyFor(input.language);
  return eligibleInlineFindings(input).slice(0, input.maxInlineComments).map((finding) => {
    const comment: ReviewCommentDraft = {
      path: finding.filePath,
      body: inlineBody(finding, copy),
      line: finding.lineEnd,
      side: "RIGHT",
    };
    if (finding.lineStart < finding.lineEnd) {
      comment.start_line = finding.lineStart;
      comment.start_side = "RIGHT";
    }
    return comment;
  });
}

/** 요약에 한 발견을 제목, 위치, 설명, 제안으로 적는다. */
function findingBlock(finding: AggregatedFinding, copy: ReviewCopy): string {
  return [`- **${oneLine(finding.title)}** (\`${lineLabel(finding)}\`)`, `  ${oneLine(finding.explanation)}`, `  ${copy.suggestion(oneLine(finding.suggestion))}`].join("\n");
}

/** 리뷰 본문이 길이 제한을 넘으면 뒤를 자르고 잘렸다는 문장을 붙인다. */
function fitBody(text: string, copy: ReviewCopy): string {
  if (text.length <= MAX_BODY_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_BODY_CHARS - copy.truncated.length)}${copy.truncated}`;
}

/** 요약 리뷰와 인라인 댓글 초안을 만든다. 모델 JSON 원문은 올리지 않는다. */
export function buildReviewPost(input: ReviewBodyInput): ReviewPostDraft {
  const copy = copyFor(input.language);
  const eligibleCount = eligibleInlineFindings(input).length;
  const comments = selectInlineComments(input);
  const shortSha = input.headSha.slice(0, 7);
  const lines = [copy.summaryTitle, "", copy.commitLine(shortSha, input.files.length)];

  if (input.partialFailure) {
    lines.push("", copy.partial);
  }

  if (input.findings.length === 0) {
    lines.push("", copy.none);
    return { body: fitBody(lines.join("\n"), copy), comments, omittedCount: 0 };
  }

  const counts = SEVERITY_ORDER.map((severity) => {
    const count = input.findings.filter((finding) => finding.severity === severity).length;
    return count === 0 ? "" : `${copy.severity[severity]} ${count}`;
  }).filter((item) => item.length > 0);
  lines.push("", copy.counts(input.findings.length, counts.join(", ")));

  const ordered = [...input.findings].sort((left, right) => {
    const severityDelta = severityRank(left.severity) - severityRank(right.severity);
    if (severityDelta !== 0) {
      return severityDelta;
    }
    const pathDelta = left.filePath.localeCompare(right.filePath);
    return pathDelta !== 0 ? pathDelta : left.lineStart - right.lineStart;
  });
  const detailed = ordered.slice(0, MAX_DETAILED_FINDINGS);
  const omittedCount = input.findings.length - detailed.length;
  for (const severity of SEVERITY_ORDER) {
    const group = detailed.filter((finding) => finding.severity === severity);
    if (group.length === 0) {
      continue;
    }
    lines.push("", `### ${copy.severity[severity]}`);
    for (const finding of group) {
      lines.push("", findingBlock(finding, copy));
    }
  }

  if (omittedCount > 0) {
    lines.push("", copy.omitted(omittedCount));
  }
  if (comments.length < eligibleCount) {
    lines.push("", copy.inlineCap(comments.length));
  }

  return { body: fitBody(lines.join("\n"), copy), comments, omittedCount };
}
