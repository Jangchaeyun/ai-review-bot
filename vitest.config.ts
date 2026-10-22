import { defineConfig } from "vitest/config";

const liveReview = process.env.GITHUB_LIVE_REVIEW === "1";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: liveReview ? [] : ["tests/**/*.live.test.ts"],
  },
});
