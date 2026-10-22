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
