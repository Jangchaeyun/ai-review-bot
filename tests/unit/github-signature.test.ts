/** 서명 길이가 다를 때는 비교하지 않고, 같을 때만 통과하는지 확인한다. */
import { describe, expect, it } from "vitest";
import { verifyGithubSignature } from "../../src/utils/github-signature.js";
import { signGithubBody } from "../helpers/github-webhook.js";

const secret = "test-webhook-secret";
const body = Buffer.from('{"action":"opened","z":1,"a":2}');

describe("verifyGithubSignature", () => {
  it("accepts the HMAC of the original bytes", () => {
    expect(verifyGithubSignature(body, signGithubBody(body, secret), secret)).toBe(true);
  });

  it("rejects a same-length digest for different bytes", () => {
    const signature = signGithubBody(body, secret);
    const tampered = Buffer.from('{"a":2,"action":"opened","z":1}');

    expect(verifyGithubSignature(tampered, signature, secret)).toBe(false);
  });

  it("rejects a wrong secret, a missing header, and a short header without throwing", () => {
    const signature = signGithubBody(body, secret);

    expect(verifyGithubSignature(body, signGithubBody(body, "other-secret"), secret)).toBe(false);
    expect(verifyGithubSignature(body, undefined, secret)).toBe(false);
    expect(verifyGithubSignature(body, "sha256=abcd", secret)).toBe(false);
    expect(verifyGithubSignature(body, signature.slice(0, -1), secret)).toBe(false);
    expect(verifyGithubSignature(body, `sha1=${signature.slice("sha256=".length)}`, secret)).toBe(false);
  });
});
