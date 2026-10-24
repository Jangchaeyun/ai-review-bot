/**
 * 프로세스 안의 리뷰 성공·실패 횟수. 로그의 누적 실패율을 계산할 때 쓴다.
 */
export type ReviewMetricSnapshot = {
  handled: number;
  failed: number;
  failureRate: number;
};

/** 이 프로세스에서 끝난 리뷰 건수와 실패율을 센다. */
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
