import type { Env } from "../schemas/env.schema.js";
import { healthResponseSchema, type HealthResponse } from "../schemas/health.schema.js";

export function getHealth(env: Env): HealthResponse {
  return healthResponseSchema.parse({
    status: "ok",
    service: env.SERVICE_NAME,
  });
}
