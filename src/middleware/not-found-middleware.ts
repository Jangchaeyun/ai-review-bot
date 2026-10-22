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
