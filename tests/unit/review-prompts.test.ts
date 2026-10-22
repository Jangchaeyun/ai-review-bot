/** 모델에 넘기는 줄 번호가 새 파일 기준인지 확인한다. 프롬프트 문장 품질은 단정하지 않는다. */
import { describe, expect, it } from "vitest";
import { buildUserMessage } from "../../src/agents/review-prompts.js";

describe("buildUserMessage", () => {
  it("numbers new-file lines without copying the diff prefix into the line text", () => {
    const patch = [
      "@@ -0,0 +1,3 @@",
      "+export function discount(price, percent) {",
      "+  return price - price * percent;",
      "+}",
      "@@ -10,0 +10,1 @@",
      "+const later = 1;",
    ].join("\n");

    const message = buildUserMessage("할인", [{ path: "samples/discount.js", patch }]);

    expect(message).toContain("<<<LINES");
    expect(message).toContain("1|export function discount(price, percent) {");
    expect(message).toContain("2|  return price - price * percent;");
    expect(message).toContain("3|}");
    expect(message).toContain("10|const later = 1;");
    expect(message).not.toContain("2|+");
  });

  it("keeps a deletion in the diff and does not invent a line number for it", () => {
    const patch = ["@@ -1,2 +1,1 @@", " keep", "-removed line", ""].join("\n");
    const message = buildUserMessage(undefined, [{ path: "src/keep.ts", patch }]);

    expect(message).toContain("-removed line");
    expect(message).toContain("1|keep");
    expect(message).not.toContain("|removed line");
  });
});
