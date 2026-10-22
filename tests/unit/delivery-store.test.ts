import { describe, expect, it } from "vitest";
import { InMemoryDeliveryStore } from "../../src/services/delivery-store.js";

describe("InMemoryDeliveryStore", () => {
  it("claims a delivery once until it is released", () => {
    const store = new InMemoryDeliveryStore(1_000, () => 100);

    expect(store.claim("delivery-1")).toBe("new");
    expect(store.claim("delivery-1")).toBe("duplicate");
    store.release("delivery-1");
    expect(store.claim("delivery-1")).toBe("new");
  });

  it("accepts the same delivery again after the TTL", () => {
    let now = 1_000;
    const store = new InMemoryDeliveryStore(500, () => now);

    expect(store.claim("delivery-1")).toBe("new");
    now = 1_499;
    expect(store.claim("delivery-1")).toBe("duplicate");
    now = 1_500;
    expect(store.claim("delivery-1")).toBe("new");
  });
});
