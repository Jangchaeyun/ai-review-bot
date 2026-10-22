/**
 * 비동기 라우트에서 던진 오류를 Express 오류 미들웨어로 넘긴다.
 * async 함수의 rejection은 그대로 두면 응답 없이 남기 때문이다.
 */
import type { NextFunction, Request, Response } from "express";

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

export function asyncHandler(handler: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
