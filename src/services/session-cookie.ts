/**
 * 로그인 세션 쿠키. 값은 추측하기 어려운 토큰이고, 저장소에는 그 해시만 둔다.
 */
import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "review_session";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 쿠키에 넣을 추측하기 어려운 세션 토큰을 만든다. 저장소에는 이 값 자체를 넣지 않는다. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 세션 토큰의 SHA-256이다. 저장소와 조회는 이 해시만 사용한다. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** review_session 쿠키만 읽고, 형식에 맞지 않거나 너무 긴 헤더는 세션이 없는 것으로 본다. */
export function readSessionToken(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined || cookieHeader.length > 4096) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === SESSION_COOKIE && TOKEN_PATTERN.test(value)) {
      return value;
    }
  }
  return undefined;
}

/** HttpOnly, SameSite=Lax 세션 쿠키 헤더를 만든다. 스크립트에서 토큰을 읽지 못한다. */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

/** 같은 이름의 쿠키를 바로 만료시켜 로그아웃한다. */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
