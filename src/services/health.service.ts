/** 서비스 이름만 담은 헬스 본문을 만든다. 비밀이 있는 환경변수는 포함하지 않는다. */
import type { Env } from "../schemas/env.schema.js";
import { healthResponseSchema, type HealthResponse } from "../schemas/health.schema.js";

export function getHealth(env: Env): HealthResponse {
  return healthResponseSchema.parse({
    status: "ok",
    service: env.SERVICE_NAME,
  });
}
