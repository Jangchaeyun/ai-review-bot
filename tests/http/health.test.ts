import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../helpers/test-app.js";

describe("GET /health", () => {
  it("returns ok without secrets or the server header", async () => {
    const app = createTestApp();
    const response = await request(app).get("/health").expect(200);

    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.body).toEqual({
      status: "ok",
      service: "ai-review-bot",
    });
    expect(JSON.stringify(response.body)).not.toContain("super-secret");
  });

  it("returns 404 for an unknown path", async () => {
    const app = createTestApp();
    const response = await request(app).get("/ready").expect(404);

    expect(response.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "요청한 경로를 찾을 수 없습니다.",
        path: "/ready",
      },
    });
  });
});
