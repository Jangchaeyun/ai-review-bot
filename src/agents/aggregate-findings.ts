/**
 * 같은 파일에서 줄이 겹치고 요지가 같은 발견을 하나로 합친다. 더 높은 심각도를 남긴다.
 * 요지는 정규화한 제목이 같거나, 제목은 달라도 정규화한 제안이 같으면 같다.
 * 이 통합은 모델이 아니라 결정적 코드다.
 */
import { AGENT_IDS, type AgentId, type ReviewFinding, type Severity } from "../schemas/review-finding.schema.js";

export type SourcedFinding = ReviewFinding & {
  source: AgentId;
};

export type AggregatedFinding = ReviewFinding & {
  sources: AgentId[];
};

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const CATEGORY_RANK: Record<AgentId, number> = {
  performance: 1,
  quality: 2,
  security: 3,
};

/** 제목과 제안에서 구두점과 대소문자를 빼 같은 요지인지 비교할 문자열을 만든다. */
function normalizeText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** 같은 파일에서 제목이 같거나, 제목은 달라도 제안이 같으면 같은 요지로 본다. */
function sameGist(left: ReviewFinding, right: ReviewFinding): boolean {
  if (left.filePath !== right.filePath) {
    return false;
  }
  const leftTitle = normalizeText(left.title);
  const rightTitle = normalizeText(right.title);
  if (leftTitle.length > 0 && leftTitle === rightTitle) {
    return true;
  }
  const leftSuggestion = normalizeText(left.suggestion);
  const rightSuggestion = normalizeText(right.suggestion);
  return leftSuggestion.length > 0 && leftSuggestion === rightSuggestion;
}

/** 두 발견의 줄 범위가 한 줄이라도 겹치면 참이다. */
function overlaps(left: ReviewFinding, right: ReviewFinding): boolean {
  return left.lineStart <= right.lineEnd && right.lineStart <= left.lineEnd;
}

/** 합칠 때 더 높은 심각도를 남긴다. 같으면 확신, 그다음 보안 쪽 항목을 남긴다. */
function prefer(left: SourcedFinding, right: SourcedFinding): SourcedFinding {
  const severityDelta = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
  if (severityDelta !== 0) {
    return severityDelta > 0 ? left : right;
  }
  if (left.confidence !== right.confidence) {
    return left.confidence > right.confidence ? left : right;
  }
  return CATEGORY_RANK[left.category] >= CATEGORY_RANK[right.category] ? left : right;
}

/** 출처 에이전트를 품질, 보안, 성능 순서로 정렬한다. */
function sortSources(sources: readonly AgentId[]): AgentId[] {
  return AGENT_IDS.filter((id) => sources.includes(id));
}

/** 겹치는 같은 요지를 하나로 합치고, 심각도가 높은 순으로 돌려준다. */
export function aggregateFindings(findings: readonly SourcedFinding[]): AggregatedFinding[] {
  const parent = findings.map((_, index) => index);

  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      const next = parent[current];
      if (next === undefined) {
        return current;
      }
      current = next;
    }
    return current;
  };

  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[leftRoot] = rightRoot;
    }
  };

  for (let left = 0; left < findings.length; left += 1) {
    for (let right = left + 1; right < findings.length; right += 1) {
      const leftFinding = findings[left];
      const rightFinding = findings[right];
      if (leftFinding !== undefined && rightFinding !== undefined && sameGist(leftFinding, rightFinding) && overlaps(leftFinding, rightFinding)) {
        union(left, right);
      }
    }
  }

  const groups = new Map<number, SourcedFinding[]>();
  for (let index = 0; index < findings.length; index += 1) {
    const finding = findings[index];
    if (finding === undefined) {
      continue;
    }
    const root = find(index);
    const group = groups.get(root);
    if (group === undefined) {
      groups.set(root, [finding]);
    } else {
      group.push(finding);
    }
  }

  const aggregated: AggregatedFinding[] = [];
  for (const group of groups.values()) {
    const winner = group.reduce((best, item) => prefer(best, item));
    aggregated.push({
      category: winner.category,
      severity: winner.severity,
      title: winner.title,
      filePath: winner.filePath,
      lineStart: winner.lineStart,
      lineEnd: winner.lineEnd,
      evidence: winner.evidence,
      explanation: winner.explanation,
      suggestion: winner.suggestion,
      confidence: winner.confidence,
      sources: sortSources(group.map((item) => item.source)),
    });
  }

  aggregated.sort((left, right) => {
    const severityDelta = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    const pathDelta = left.filePath.localeCompare(right.filePath);
    if (pathDelta !== 0) {
      return pathDelta;
    }
    return left.lineStart - right.lineStart;
  });

  return aggregated;
}
