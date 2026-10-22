export type AppErrorOptions = {
  message: string;
  code: string;
  statusCode: number;
  retryable?: boolean;
  expose?: boolean;
  cause?: unknown;
};

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
