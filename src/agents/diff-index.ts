/**
 * unified diff에서 새 파일 기준 줄 번호를 계산한다.
 * 모델이 준 줄 번호와 근거가 이 인덱스에 없으면 발견을 버린다.
 */
export type FileDiffIndex = {
  path: string;
  lines: ReadonlyMap<number, string>;
  hunkText: readonly string[];
};

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function indexPatch(path: string, patch: string): FileDiffIndex {
  const lines = new Map<number, string>();
  const hunkText: string[] = [];
  let newLine = 0;
  let inHunk = false;
  let hunkLines: string[] = [];

  const flushHunk = (): void => {
    if (hunkLines.length > 0) {
      hunkText.push(hunkLines.join("\n"));
      hunkLines = [];
    }
  };

  for (const rawLine of patch.split(/\r?\n/)) {
    if (rawLine.startsWith("@@")) {
      flushHunk();
      const match = HUNK_HEADER.exec(rawLine);
      inHunk = match !== null;
      newLine = match === null ? 0 : Number(match[1]);
      continue;
    }
    if (!inHunk || rawLine.startsWith("---") || rawLine.startsWith("+++") || rawLine.startsWith("\\")) {
      continue;
    }

    const prefix = rawLine[0];
    const text = rawLine.slice(1);
    if (prefix === "+") {
      lines.set(newLine, text);
      hunkLines.push(text);
      newLine += 1;
      continue;
    }
    if (prefix === " ") {
      lines.set(newLine, text);
      hunkLines.push(text);
      newLine += 1;
      continue;
    }
    if (prefix === "-") {
      continue;
    }
  }
  flushHunk();

  return { path, lines, hunkText };
}

/** 에이전트에 보여줄 때 새 파일 줄 번호를 `번호|내용`으로 붙인다. 근거 문자열에는 번호를 넣지 않는다. */
export function numberedNewFileLines(patch: string): string {
  const index = indexPatch("", patch);
  return [...index.lines.keys()]
    .sort((left, right) => left - right)
    .map((line) => `${line}|${index.lines.get(line) ?? ""}`)
    .join("\n");
}

export function evidenceInDiff(evidence: string, index: FileDiffIndex): boolean {
  const needle = evidence.replace(/\r\n/g, "\n").trim();
  if (needle.length < 6) {
    return false;
  }
  return index.hunkText.some((hunk) => hunk.includes(needle));
}

export function lineRangeInDiff(lineStart: number, lineEnd: number, index: FileDiffIndex): boolean {
  if (lineStart > lineEnd || lineEnd - lineStart > 50) {
    return false;
  }
  for (let line = lineStart; line <= lineEnd; line += 1) {
    if (!index.lines.has(line)) {
      return false;
    }
  }
  return true;
}

function isDecorationLine(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed === "{" || trimmed === "}" || trimmed === "};") {
    return true;
  }
  if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("#")) {
    return true;
  }
  return /^(export\s+)?(default\s+)?(async\s+)?function\b/.test(trimmed)
    || /^(export\s+)?(default\s+)?class\b/.test(trimmed);
}

/**
 * 인라인 댓글은 모델이 잡은 범위 전체가 아니라 evidence가 들어 있는 줄에 붙인다.
 * 함수 선언과 주석만 범위에 남아 본문 줄이 있으면 그 줄만 남긴다.
 */
export function anchorLineRange(
  evidence: string,
  index: FileDiffIndex,
  lineStart: number,
  lineEnd: number,
): { lineStart: number; lineEnd: number } {
  const needle = evidence.replace(/\r\n/g, "\n").trim();
  if (needle.length < 6 || !lineRangeInDiff(lineStart, lineEnd, index)) {
    return { lineStart, lineEnd };
  }

  const lines: { line: number; text: string }[] = [];
  for (let line = lineStart; line <= lineEnd; line += 1) {
    const text = index.lines.get(line);
    if (text === undefined) {
      return { lineStart, lineEnd };
    }
    lines.push({ line, text });
  }

  let window: { line: number; text: string }[] | undefined;
  for (let size = 1; size <= lines.length; size += 1) {
    for (let start = 0; start + size <= lines.length; start += 1) {
      const candidate = lines.slice(start, start + size);
      if (candidate.map((item) => item.text).join("\n").includes(needle)) {
        window = candidate;
        break;
      }
    }
    if (window !== undefined) {
      break;
    }
  }
  if (window === undefined) {
    return { lineStart, lineEnd };
  }

  const substantive = window.filter((item) => !isDecorationLine(item.text));
  const chosen = substantive.length > 0 ? substantive : window;
  const first = chosen[0];
  const last = chosen[chosen.length - 1];
  if (first === undefined || last === undefined) {
    return { lineStart, lineEnd };
  }
  return { lineStart: first.line, lineEnd: last.line };
}
