/**
 * 비밀번호는 scrypt 해시로만 저장한다. 원문은 로그나 응답에 남기지 않는다.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 32;
const SALT_BYTES = 16;

/** scrypt 콜백을 Promise로 감싼다. 파라미터는 이 파일의 고정값만 쓴다. */
function scryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    }, (error, key) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

/** 비밀번호 원문 대신 저장할 scrypt 문자열을 만든다. 소금은 호출마다 새로 뽑는다. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptKey(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** 저장된 scrypt 형식과 파라미터가 맞을 때만 같은 길이의 키를 비교한다. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltText = parts[4];
  const expectedText = parts[5];
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || saltText === undefined || expectedText === undefined) {
    return false;
  }
  if (n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltText, "base64url");
    expected = Buffer.from(expectedText, "base64url");
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== SCRYPT_KEY_LENGTH) {
    return false;
  }
  const key = await scryptKey(password, salt);
  if (!Buffer.isBuffer(key) || key.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(key, expected);
}
