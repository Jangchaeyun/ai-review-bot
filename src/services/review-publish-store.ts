/**
 * 같은 owner/repo, PR 번호, head SHA에 리뷰를 한 번만 게시하기 위한 키 저장소.
 * 키를 잡은 뒤 게시 전에 죽으면 그 SHA는 자동으로 다시 올리지 않는다.
 */
const MAX_KEYS = 5_000;

export interface ReviewPublishStore {
  claim(key: string): "new" | "duplicate";
  release(key: string): void;
}

/** 같은 커밋에 리뷰를 다시 올리지 않기 위한 업무 키다. */
export function reviewPublishKey(owner: string, repo: string, pullNumber: number, headSha: string): string {
  return `${owner}/${repo}#${pullNumber}@${headSha.toLowerCase()}`;
}

/** 테스트용 게시 키 저장소다. 키에는 만료가 없다. */
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
