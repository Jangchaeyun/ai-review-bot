import { describe, expect, it } from "vitest";
import { InMemoryReviewMetrics } from "../../src/services/review-metrics.js";

describe("InMemoryReviewMetrics", () => {
  it("computes the failure rate from handled and failed reviews", () => {
    const metrics = new InMemoryReviewMetrics();
    expect(metrics.snapshot()).toEqual({ handled: 0, failed: 0, failureRate: 0 });
    expect(metrics.record("handled")).toEqual({ handled: 1, failed: 0, failureRate: 0 });
    expect(metrics.record("failed")).toEqual({ handled: 1, failed: 1, failureRate: 0.5 });
  });
});
