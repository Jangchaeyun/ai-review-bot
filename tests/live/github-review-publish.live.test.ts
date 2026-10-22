import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createReviewPublisher } from "../../src/integrations/github/review-publisher.js";
import { parseEnv } from "../../src/services/load-env.js";
import { createLogger } from "../../src/utils/logger.js";

const enabled = process.env.GITHUB_LIVE_REVIEW === "1";

describe.skipIf(!enabled)("live github review publish", () => {
  it("posts one summary review to the pull request named by GITHUB_LIVE_* variables", async () => {
    const installationId = Number(process.env.GITHUB_LIVE_INSTALLATION_ID);
    const owner = process.env.GITHUB_LIVE_OWNER ?? "";
    const repo = process.env.GITHUB_LIVE_REPO ?? "";
    const pullNumber = Number(process.env.GITHUB_LIVE_PULL);
    const headSha = process.env.GITHUB_LIVE_HEAD_SHA ?? "";
    if (owner.length === 0 || repo.length === 0 || headSha.length === 0 || !Number.isInteger(installationId) || !Number.isInteger(pullNumber)) {
      throw new Error(
        "GITHUB_LIVE_INSTALLATION_ID, GITHUB_LIVE_OWNER, GITHUB_LIVE_REPO, GITHUB_LIVE_PULL, GITHUB_LIVE_HEAD_SHA가 필요합니다.",
      );
    }

    const env = parseEnv(process.env);
    const logger = createLogger(env, {
      level: "silent",
      destination: new Writable({
        write(chunk, encoding, callback) {
          void chunk;
          void encoding;
          callback();
        },
      }),
    });
    const publisher = createReviewPublisher({
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      baseUrl: env.GITHUB_API_BASE_URL,
      timeoutMs: env.GITHUB_REQUEST_TIMEOUT_MS,
      maxInlineComments: 0,
      logger,
    });
    const result = await publisher.publish({
      installationId,
      owner,
      repo,
      pullNumber,
      headSha,
      draft: false,
      files: [],
      findings: [],
      partialFailure: false,
    });

    expect(result.status === "posted" || result.status === "skipped").toBe(true);
  });
});
