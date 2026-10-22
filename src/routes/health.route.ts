import { Router } from "express";
import { createHealthController } from "../controllers/health.controller.js";
import type { Env } from "../schemas/env.schema.js";
import { asyncHandler } from "../utils/async-handler.js";

export function createHealthRouter(env: Env): Router {
  const router = Router();
  router.get("/", asyncHandler(createHealthController(env)));
  return router;
}
