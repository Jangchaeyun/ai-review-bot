export const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

export interface DeliveryStore {
  claim(deliveryId: string): "new" | "duplicate";
  release(deliveryId: string): void;
}

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
