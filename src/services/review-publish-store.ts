const MAX_KEYS = 5_000;

export interface ReviewPublishStore {
  claim(key: string): "new" | "duplicate";
  release(key: string): void;
}

export function reviewPublishKey(owner: string, repo: string, pullNumber: number, headSha: string): string {
  return `${owner}/${repo}#${pullNumber}@${headSha.toLowerCase()}`;
}

export class InMemoryReviewPublishStore implements ReviewPublishStore {
  private readonly seen = new Map<string, true>();

  claim(key: string): "new" | "duplicate" {
    if (this.seen.has(key)) {
      return "duplicate";
    }
    this.seen.set(key, true);
    if (this.seen.size > MAX_KEYS) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined && oldest !== key) {
        this.seen.delete(oldest);
      }
    }
    return "new";
  }

  release(key: string): void {
    this.seen.delete(key);
  }
}
