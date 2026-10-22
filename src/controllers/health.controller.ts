import type { Request, Response } from "express";
import type { Env } from "../schemas/env.schema.js";
import { getHealth } from "../services/health.service.js";

export function createHealthController(env: Env) {
  return function healthController(_request: Request, res: Response): void {
    res.set("Cache-Control", "no-store");
    res.status(200).json(getHealth(env));
  };
}
