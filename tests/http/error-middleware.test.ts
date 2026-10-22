import { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { asyncHandler } from "../../src/utils/async-handler.js";
import { AppError } from "../../src/utils/app-error.js";
import { createTestApp } from "../helpers/test-app.js";

describe("error middleware", () => {
  it("returns the AppError message for an exposed client error", async () => {
    const router = Router();
    router.get(
      "/boom",
      asyncHandler(async () => {
        throw new AppError({
          message: "잘못된 입력입니다.",
          code: "BAD_INPUT",
          statusCode: 400,
        });
      }),
    );

    const response = await request(createTestApp([router])).get("/boom").expect(400);

    expect(response.body).toEqual({
      error: {
        code: "BAD_INPUT",
        message: "잘못된 입력입니다.",
        path: "/boom",
      },
    });
  });

  it("hides unexpected error details", async () => {
    const router = Router();
    router.get("/secret-failure", () => {
      throw new Error("GITHUB_WEBHOOK_SECRET=super-secret");
    });

    const response = await request(createTestApp([router])).get("/secret-failure").expect(500);

    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "요청을 처리하지 못했습니다.",
        path: "/secret-failure",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("super-secret");
  });

  it("returns a fixed validation message without the raw input", async () => {
    const router = Router();
    router.post(
      "/validate",
      asyncHandler(async (req) => {
        z.object({ count: z.number() }).parse(req.body);
      }),
    );

    const response = await request(createTestApp([router]))
      .post("/validate")
      .send({ count: "nope", name: "super-secret-name" })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.issues).toEqual([
      { path: "count", message: "값이 올바르지 않습니다." },
    ]);
    expect(JSON.stringify(response.body)).not.toContain("super-secret-name");
    expect(JSON.stringify(response.body)).not.toContain("nope");
  });

  it("rejects malformed JSON", async () => {
    const response = await request(createTestApp())
      .post("/health")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: "INVALID_JSON",
        message: "JSON 본문을 해석할 수 없습니다.",
        path: "/health",
      },
    });
  });
});
