/**
 * 토큰 예산을 넘는 diff를 에이전트 호출 단위로 나눈다.
 * 파일 하나만 예산을 넘겨도 그 파일은 그대로 한 청크에 둔다.
 */
import type { ReviewFile } from "./filter-findings.js";

/** 글자 수 예산 안의 파일들을 한 호출로 묶고, 넘치면 다음 청크로 넘긴다. */
export function chunkReviewFiles(files: readonly ReviewFile[], maxChars: number): ReviewFile[][] {
  const chunks: ReviewFile[][] = [];
  let current: ReviewFile[] = [];
  let size = 0;

  for (const file of files) {
    const weight = file.path.length + file.patch.length + 32;
    if (current.length > 0 && size + weight > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += weight;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}
