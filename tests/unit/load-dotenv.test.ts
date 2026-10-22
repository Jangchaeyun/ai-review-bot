import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDotEnv } from "../../src/services/load-dotenv.js";

const KEY = "AI_REVIEW_DOTENV_TEST";

afterEach(() => {
  delete process.env[KEY];
});

describe("loadDotEnv", () => {
  it("loads a missing file as a no-op and does not override existing variables", () => {
    loadDotEnv(join(tmpdir(), "ai-review-missing.env"));
    process.env[KEY] = "already-set";
    const directory = mkdtempSync(join(tmpdir(), "ai-review-env-"));
    const path = join(directory, ".env");
    writeFileSync(path, `# comment\n${KEY}="from-file"\nINVALID LINE\n`, "utf8");

    loadDotEnv(path);

    expect(process.env[KEY]).toBe("already-set");
  });

  it("fills an absent key from the file", () => {
    delete process.env[KEY];
    const directory = mkdtempSync(join(tmpdir(), "ai-review-env-"));
    const path = join(directory, ".env");
    writeFileSync(path, `${KEY}=from-file\n`, "utf8");

    loadDotEnv(path);

    expect(process.env[KEY]).toBe("from-file");
  });
});