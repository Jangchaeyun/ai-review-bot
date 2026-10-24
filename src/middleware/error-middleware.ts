/**
 * 오류를 { error: { code, message, path } }로 보낸다.
 * 검증 실패의 issues.message에는 사용자가 넣은 원문을 다시 적지 않는다.
 */
import type { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { errorResponseSchema, type ErrorResponse } from "../schemas/error-response.schema.js";
import { AppError } from "../utils/app-error.js";
import { requestPath } from "../utils/request-path.js";

const GENERIC_SERVER_MESSAGE = "요청을 처리하지 못했습니다.";

/** Express JSON 파서가 본문을 읽지 못했을 때의 400이다. */
function isJsonParseError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const status = "status" in error ? error.status : undefined;
  const type = "type" in error ? error.type : undefined;
  return status === 400 || type === "entity.parse.failed";
}

/** 본문이 허용 크기를 넘긴 413이다. */
function isPayloadTooLarge(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const status = "status" in error ? error.status : undefined;
  const statusCode = "statusCode" in error ? error.statusCode : undefined;
  const type = "type" in error ? error.type : undefined;
  return status === 413 || statusCode === 413 || type === "entity.too.large";
}

/** expose가 거짓이거나 예상하지 못한 예외는 고정 문구만 밖으로 보낸다. */
function publicError(error: unknown, path: string): { statusCode: number; body: ErrorResponse } {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: errorResponseSchema.parse({
        error: {
          code: error.code,
          message: error.expose ? error.message : GENERIC_SERVER_MESSAGE,
          path,
        },
      }),
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: errorResponseSchema.parse({
        error: {
          code: "VALIDATION_ERROR",
          message: "요청 값이 올바르지 않습니다.",
          path,
          issues: error.issues.map((issue) => ({
            path: issue.path.join(".") || "body",
            message: "값이 올바르지 않습니다.",
          })),
        },
      }),
    };
  }

  if (isPayloadTooLarge(error)) {
    return {
      statusCode: 413,
      body: errorResponseSchema.parse({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "요청 본문이 너무 큽니다.",
          path,
        },
      }),
    };
  }

  if (isJsonParseError(error)) {
    return {
      statusCode: 400,
      body: errorResponseSchema.parse({
        error: {
          code: "INVALID_JSON",
          message: "JSON 본문을 해석할 수 없습니다.",
          path,
        },
      }),
    };
  }

  return {
    statusCode: 500,
    body: errorResponseSchema.parse({
      error: {
        code: "INTERNAL_ERROR",
        message: GENERIC_SERVER_MESSAGE,
        path,
      },
    }),
  };
}

/** 앱의 마지막 오류 처리다. 로그에는 코드를 남기고 응답에는 공개해도 되는 문장만 보낸다. */
export function errorMiddleware(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const { statusCode, body } = publicError(error, requestPath(req));
    logger.error(
      {
        method: req.method,
        path: req.path,
        statusCode,
        code: body.error.code,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "request failed",
    );
    res.status(statusCode).json(body);
  };
}
