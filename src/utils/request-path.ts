import type { Request } from "express";

export function requestPath(req: Request): string {
  const path = req.originalUrl.split("?")[0];
  if (path !== undefined && path.length > 0) {
    return path;
  }

  return req.path;
}
