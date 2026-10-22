import type { ReviewFile } from "./filter-findings.js";

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
