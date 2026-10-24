/**
 * X-GitHub-Delivery 중복을 가린다. 기본 TTL은 24시간이다.
 * 응답 전에 프로세스가 죽으면 키를 지워 GitHub 재시도가 같은 작업을 다시 넣게 한다.
 */
export const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

export interface DeliveryStore {
  claim(deliveryId: string): "new" | "duplicate";
  release(deliveryId: string): void;
}

/** 테스트용 딜리버리 저장소다. 만료된 키는 다시 새 이벤트로 받는다. */
export class InMemoryDeliveryStore implements DeliveryStore {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  claim(deliveryId: string): "new" | "duplicate" {
    const now = this.now();
    this.prune(now);

    const expiresAt = this.seen.get(deliveryId);
    if (expiresAt !== undefined && expiresAt > now) {
      return "duplicate";
    }

    this.seen.set(deliveryId, now + this.ttlMs);
    return "new";
  }

  release(deliveryId: string): void {
    this.seen.delete(deliveryId);
  }

  private prune(now: number): void {
    for (const [deliveryId, expiresAt] of this.seen) {
      if (expiresAt <= now) {
        this.seen.delete(deliveryId);
      }
    }
  }
}
