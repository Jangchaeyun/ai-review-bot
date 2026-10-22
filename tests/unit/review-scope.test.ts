/** 분석에서 빼는 파일과 크기 제한을 확인한다. */
import { describe, expect, it } from "vitest";
import { selectReviewFiles, type GithubChangedFile, type ReviewLimits } from "../../src/integrations/github/review-scope.js";

const limits: ReviewLimits = {
  maxFiles: 2,
  maxFileBytes: 100,
  maxDiffBytes: 20,
};

function file(overrides: Partial<GithubChangedFile> & Pick<GithubChangedFile, "path">): GithubChangedFile {
  return {
    status: "modified",
    patch: "ok",
    sizeBytes: 10,
    ...overrides,
  };
}

describe("selectReviewFiles", () => {
  it("keeps a small text diff and records every skip reason without the oversized diff", () => {
    const secret = "LEAKED_DIFF_SECRET";
    const selected = selectReviewFiles(
      [
        file({ path: "src/app.ts" }),
        file({ path: "src/next.ts" }),
        file({ path: "src/later.ts" }),
        file({ path: "src/gone.ts", status: "removed", patch: "-secret" }),
        { path: "assets/logo.png", status: "added", sizeBytes: 8 },
        file({ path: "package-lock.json" }),
        file({ path: "vendor/lib.js" }),
        file({ path: "src/huge.ts", sizeBytes: 500, patch: "tiny" }),
        file({ path: "src/wide.ts", patch: secret + "x".repeat(30) }),
        { path: "src/missing.ts", status: "modified", sizeBytes: 10 },
        file({ path: "../secrets.ts" }),
      ],
      limits,
    );

    expect(selected.files.map((item) => item.path)).toEqual(["src/app.ts", "src/next.ts"]);
    expect(selected.skipped.map((item) => [item.path, item.reason])).toEqual([
      ["src/later.ts", "file-count-exceeded"],
      ["src/gone.ts", "deleted"],
      ["assets/logo.png", "binary"],
      ["package-lock.json", "excluded-path"],
      ["vendor/lib.js", "excluded-path"],
      ["src/huge.ts", "file-too-large"],
      ["src/wide.ts", "diff-too-large"],
      ["src/missing.ts", "diff-unavailable"],
      ["../secrets.ts", "unsafe-path"],
    ]);
    expect(JSON.stringify(selected)).not.toContain(secret);
    expect(selected.skipped.find((item) => item.reason === "file-too-large")?.sizeBytes).toBe(500);
    expect(selected.skipped.find((item) => item.reason === "diff-too-large")?.diffBytes).toBeGreaterThan(20);
  });
});