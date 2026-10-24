/**
 * 오류 응답의 path에 쿼리스트링을 넣지 않는다. 주소에 담긴 값이 로그와 응답으로 새는 것을 막는다.
 */
import type { Request } from "express";

/** 오류 응답에 넣을 경로다. 쿼리스트링은 빼서 입력값이 응답에 다시 나가지 않게 한다. */
export function requestPath(req: Request): string {
  const path = req.originalUrl.split("?")[0];
  if (path !== undefined && path.length > 0) {
    return path;
  }

  return req.path;
}
