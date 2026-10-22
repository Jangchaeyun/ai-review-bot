import { createHmac, timingSafeEqual } from "node:crypto";

const SHA256_PREFIX = "sha256=";
const SHA256_HEX_LENGTH = 64;

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
