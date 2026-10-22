import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/test-app.js";
import { TEST_WEBHOOK_SECRET } from "../helpers/test-app.js";
import type { ReviewJobRecord } from "../../src/services/review-activity.js";

const job: ReviewJobRecord = {
  deliveryId: "33333333-3333-4333-8333-333333333333",
  owner: "acme",
  repo: "demo",
  pullNumber: 12,
  headSha: "abc123abc123abc123abc123abc123abc123abcd",
  status: "done",
  updatedAt: 1_700_000_000_000,
};

describe("web console", () => {
  it("serves a review page at the root", async () => {
    const app = createTestApp();
    const response = await request(app).get("/").expect(200);

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.text).toContain("리뷰 요청");
    expect(response.text).toContain("다시 리뷰");
    expect(response.text).toContain("요청 중");
    expect(response.text).toContain("주소를 넣었습니다");
    expect(response.text).toContain("pull-request-url");
    expect(response.text).toContain("지적 없음");
    expect(response.text).toContain("댓글 언어");
    expect(response.text).toContain("English");
    expect(response.text).not.toContain(TEST_WEBHOOK_SECRET);
  });

  it("lists saved review jobs", async () => {
    const app = createTestApp(undefined, { listJobs: () => [job] });
    const response = await request(app).get("/console/jobs").expect(200);

    expect(response.body).toEqual({ jobs: [job] });
  });

  it("rejects a pull request url that is not a GitHub pull request", async () => {
    let called = false;
    const app = createTestApp(undefined, {
      requestReview: async () => {
        called = true;
        return job;
      },
    });
    const response = await request(app)
      .post("/console/reviews")
      .send({ pullRequestUrl: "https://example.com/acme/demo/pull/12" })
      .expect(400);

    expect(called).toBe(false);
    expect(response.body.error.code).toBe("INVALID_PULL_REQUEST_URL");
    expect(response.body.error.message).not.toContain("example.com");
  });

  it("accepts a short pull request name", async () => {
    const app = createTestApp(undefined, {
      requestReview: async () => job,
    });
    const response = await request(app)
      .post("/console/reviews")
      .send({ pullRequestUrl: "acme/demo#12" })
      .expect(202);

    expect(response.body).toEqual({ job });
  });

  it("accepts a review request and returns the queued job", async () => {
    const app = createTestApp(undefined, {
      requestReview: async () => job,
    });
    const response = await request(app)
      .post("/console/reviews")
      .send({ pullRequestUrl: "https://github.com/acme/demo/pull/12" })
      .expect(202);

    expect(response.body).toEqual({ job });
  });

  it("passes the selected comment language", async () => {
    let language: string | undefined;
    const app = createTestApp(undefined, {
      requestReview: async (_pullRequestUrl, selected) => {
        language = selected;
        return job;
      },
    });

    await request(app)
      .post("/console/reviews")
      .send({ pullRequestUrl: "acme/demo#12", language: "en" })
      .expect(202);

    expect(language).toBe("en");
  });

  it("rejects an unknown comment language before starting a review", async () => {
    let called = false;
    const app = createTestApp(undefined, {
      requestReview: async () => {
        called = true;
        return job;
      },
    });

    const response = await request(app)
      .post("/console/reviews")
      .send({ pullRequestUrl: "acme/demo#12", language: "fr" })
      .expect(400);

    expect(called).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("fr");
  });
});
