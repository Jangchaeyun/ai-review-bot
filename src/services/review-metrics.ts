export type ReviewMetricSnapshot = {
  handled: number;
  failed: number;
  failureRate: number;
};

export class InMemoryReviewMetrics {
  private handled = 0;
  private failed = 0;

  record(outcome: "handled" | "failed"): ReviewMetricSnapshot {
    if (outcome === "handled") {
      this.handled += 1;
    } else {
      this.failed += 1;
    }
    return this.snapshot();
  }

  snapshot(): ReviewMetricSnapshot {
    const total = this.handled + this.failed;
    return {
      handled: this.handled,
      failed: this.failed,
      failureRate: total === 0 ? 0 : this.failed / total,
    };
  }
}
