import { describe, expect, it } from "vitest";
import { AppError } from "../../src/utils/app-error.js";
import { parsePullRequestUrl } from "../../src/services/parse-pull-request-url.js";

describe("parsePullRequestUrl", () => {
  it("reads a GitHub pull request from a full address or a short form", () => {
    expect(parsePullRequestUrl("https://github.com/acme/demo/pull/12")).toEqual({
      owner: "acme",
      repo: "demo",
      pullNumber: 12,
    });
    expect(parsePullRequestUrl("https://github.com/acme/demo/pull/12/files?w=1")).toEqual({
      owner: "acme",
      repo: "demo",
      pullNumber: 12,
    });
    expect(parsePullRequestUrl("http://github.com/acme/demo/pull/12")).toEqual({
      owner: "acme",
      repo: "demo",
      pullNumber: 12,
    });
    expect(parsePullRequestUrl("acme/demo#12")).toEqual({
      owner: "acme",
      repo: "demo",
      pullNumber: 12,
    });
    expect(parsePullRequestUrl("acme/demo/pull/12")).toEqual({
      owner: "acme",
      repo: "demo",
      pullNumber: 12,
    });
  });

  it("rejects other hosts and non-pull paths", () => {
    const samples = [
      "https://github.com.evil.test/acme/demo/pull/12",
      "https://user:pass@github.com/acme/demo/pull/12",
      "https://github.com/acme/demo/issues/12",
      "https://github.com/acme/demo/pull/0",
      "not a url",
    ];
    for (const sample of samples) {
      expect(() => parsePullRequestUrl(sample)).toThrow(AppError);
      try {
        parsePullRequestUrl(sample);
      } catch (error) {
        expect((error as AppError).code).toBe("INVALID_PULL_REQUEST_URL");
        expect((error as AppError).message).not.toContain(sample);
      }
    }
  });
});
