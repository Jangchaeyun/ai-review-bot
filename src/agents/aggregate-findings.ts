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

function normalizeTitle(title: string): string {
  return title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function sameGist(left: ReviewFinding, right: ReviewFinding): boolean {
  const leftTitle = normalizeTitle(left.title);
  const rightTitle = normalizeTitle(right.title);
  return left.filePath === right.filePath && leftTitle.length > 0 && leftTitle === rightTitle;
}

function overlaps(left: ReviewFinding, right: ReviewFinding): boolean {
  return left.lineStart <= right.lineEnd && right.lineStart <= left.lineEnd;
}

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

function sortSources(sources: readonly AgentId[]): AgentId[] {
  return AGENT_IDS.filter((id) => sources.includes(id));
}

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
