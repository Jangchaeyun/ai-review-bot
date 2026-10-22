import { describe, expect, it } from "vitest";
import { AppError } from "../../src/utils/app-error.js";

describe("AppError", () => {
  it("hides 5xx messages by default and keeps the cause", () => {
    const cause = new Error("upstream timeout");
    const error = new AppError({
      message: "GitHub 요청이 시간 초과되었습니다.",
      code: "GITHUB_TIMEOUT",
      statusCode: 504,
      retryable: true,
      cause,
    });

    expect(error.expose).toBe(false);
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });

  it("exposes 4xx messages by default", () => {
    const error = new AppError({
      message: "요청 값이 올바르지 않습니다.",
      code: "BAD_REQUEST",
      statusCode: 400,
    });

    expect(error.expose).toBe(true);
    expect(error.retryable).toBe(false);
  });
});
