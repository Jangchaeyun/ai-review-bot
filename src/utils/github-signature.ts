/**
 * GitHub Webhook 서명을 수신 바이트 기준으로 확인한다.
 * 길이가 다를 때는 비교하지 않고, 같을 때만 timingSafeEqual을 쓴다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SHA256_PREFIX = "sha256=";
const SHA256_HEX_LENGTH = 64;

/** sha256= 뒤의 64자리 hex만 서명으로 인정한다. */
function decodeSignature(signatureHeader: string): Buffer | undefined {
  if (!signatureHeader.startsWith(SHA256_PREFIX)) {
    return undefined;
  }

  const hex = signatureHeader.slice(SHA256_PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    return undefined;
  }

  const decoded = Buffer.from(hex, "hex");
  if (decoded.length !== SHA256_HEX_LENGTH / 2) {
    return undefined;
  }

  return decoded;
}

/** raw body의 HMAC-SHA256과 헤더 서명이 같은 길이일 때만 비교한다. */
export function verifyGithubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (signatureHeader === undefined) {
    return false;
  }

  const received = decodeSignature(signatureHeader);
  if (received === undefined) {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
}
