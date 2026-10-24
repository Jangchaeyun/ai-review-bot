/** 헬스 응답은 캐시하지 않는다. 직전 상태를 브라우저가 재사용하지 않게 한다. */
import type { Request, Response } from "express";
import type { Env } from "../schemas/env.schema.js";
import { getHealth } from "../services/health.service.js";

/** GET /health 본문을 만들고 캐시하지 않는다. */
export function createHealthController(env: Env) {
  return function healthController(_request: Request, res: Response): void {
    res.set("Cache-Control", "no-store");
    res.status(200).json(getHealth(env));
  };
}
