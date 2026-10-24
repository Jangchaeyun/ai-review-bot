/**
 * 도메인 오류다. code와 retryable로 재시도 여부를 나누고, expose가 거짓이면 클라이언트에 고정 문구만 보낸다.
 */
export type AppErrorOptions = {
  message: string;
  code: string;
  statusCode: number;
  retryable?: boolean;
  expose?: boolean;
  cause?: unknown;
};

/** code, HTTP 상태, 재시도 가능 여부, 응답 공개 여부를 한 오류로 담는다. */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly expose: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.expose = options.expose ?? options.statusCode < 500;
  }
}
