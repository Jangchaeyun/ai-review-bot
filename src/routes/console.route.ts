import { Router } from "express";
import { createConsoleController, type ConsoleControllerDeps } from "../controllers/console.controller.js";
import { asyncHandler } from "../utils/async-handler.js";

export function createConsoleRouter(deps: ConsoleControllerDeps): Router {
  const controller = createConsoleController(deps);
  const router = Router();
  router.get("/", controller.page);
  router.get("/console/jobs", controller.jobs);
  router.post("/console/reviews", asyncHandler(controller.review));
  return router;
}
