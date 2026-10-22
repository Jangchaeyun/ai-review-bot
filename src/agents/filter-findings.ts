import { indexPatch, evidenceInDiff, lineRangeInDiff, type FileDiffIndex } from "./diff-index.js";
import type { ReviewFinding } from "../schemas/review-finding.schema.js";
import { reviewLanguageFrom, type ReviewLanguage } from "../services/review-language.js";

const UNCERTAIN_NOTE: Record<ReviewLanguage, string> = {
  ko: "확신할 수 없습니다.",
  en: "This is not certain.",
};
export const SECURITY_UNCERTAIN_NOTE = UNCERTAIN_NOTE.ko;
const SECURITY_CONFIDENCE_FLOOR = 0.5;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

export type ReviewFile = {
  path: string;
  patch: string;
};

export type FilterResult = {
  accepted: ReviewFinding[];
  droppedCount: number;
};

function stripUnknownUrls(text: string, allowed: string): string {
  return text
    .replace(URL_PATTERN, (url) => (allowed.includes(url) ? url : ""))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function withSecurityUncertainty(finding: ReviewFinding, language: ReviewLanguage): ReviewFinding {
  if (finding.category !== "security" || finding.confidence >= SECURITY_CONFIDENCE_FLOOR) {
    return finding;
  }
  const note = UNCERTAIN_NOTE[language];
  if (finding.explanation.includes(note)) {
    return { ...finding, severity: "low" };
  }
  const room = 1000 - note.length - 1;
  const explanation = `${finding.explanation.slice(0, Math.max(0, room))} ${note}`;
  return {
    ...finding,
    severity: "low",
    explanation,
  };
}

export function filterFindings(
  findings: readonly ReviewFinding[],
  files: readonly ReviewFile[],
  language?: ReviewLanguage,
): FilterResult {
  const indexes = new Map<string, FileDiffIndex>();
  for (const file of files) {
    if (!indexes.has(file.path)) {
      indexes.set(file.path, indexPatch(file.path, file.patch));
    }
  }

  const accepted: ReviewFinding[] = [];
  let droppedCount = 0;

  for (const finding of findings) {
    const index = indexes.get(finding.filePath);
    if (index === undefined || !lineRangeInDiff(finding.lineStart, finding.lineEnd, index) || !evidenceInDiff(finding.evidence, index)) {
      droppedCount += 1;
      continue;
    }

    const allowed = index.hunkText.join("\n");
    const explanation = stripUnknownUrls(finding.explanation, allowed);
    const suggestion = stripUnknownUrls(finding.suggestion, allowed);
    if (explanation.length === 0 || suggestion.length === 0) {
      droppedCount += 1;
      continue;
    }

    accepted.push(withSecurityUncertainty({ ...finding, explanation, suggestion }, reviewLanguageFrom(language)));
  }

  return { accepted, droppedCount };
}
