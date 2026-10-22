/**
 * 등록되지 않은 경로에 고정 404를 보낸다. 헤더를 이미 보낸 뒤에는 응답을 다시 쓰지 않는다.
 */
import type { NextFunction, Request, Response } from "express";
import { errorResponseSchema } from "../schemas/error-response.schema.js";
import { requestPath } from "../utils/request-path.js";

export function notFoundMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next();
    return;
  }

  const body = errorResponseSchema.parse({
    error: {
      code: "NOT_FOUND",
      message: "요청한 경로를 찾을 수 없습니다.",
      path: requestPath(req),
    },
  });
  res.status(404).json(body);
}
