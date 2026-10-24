/** GET /health 라우트. 의존성 상태는 확인하지 않고 프로세스만 살아 있는지 본다. */
import { Router } from "express";
import { createHealthController } from "../controllers/health.controller.js";
import type { Env } from "../schemas/env.schema.js";
import { asyncHandler } from "../utils/async-handler.js";

/** GET /health를 앱에 붙인다. */
export function createHealthRouter(env: Env): Router {
  const router = Router();
  router.get("/", asyncHandler(createHealthController(env)));
  return router;
}
