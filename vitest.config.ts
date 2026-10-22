/** 기본 테스트는 실제 GitHub 호출을 제외한다. GITHUB_LIVE_REVIEW=1일 때만 live 테스트를 포함한다. */
import { defineConfig } from "vitest/config";

const liveReview = process.env.GITHUB_LIVE_REVIEW === "1";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: liveReview ? [] : ["tests/**/*.live.test.ts"],
  },
});
