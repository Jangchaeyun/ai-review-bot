/** 브라우저 콘솔 라우트. 페이지, 최근 작업, 수동 리뷰 요청을 같은 앱에 둔다. */
import { Router } from "express";
import { createConsoleController, type ConsoleControllerDeps } from "../controllers/console.controller.js";
import { asyncHandler } from "../utils/async-handler.js";

/** 루트 페이지, 작업 목록, 수동 리뷰 요청을 연결한다. */
export function createConsoleRouter(deps: ConsoleControllerDeps): Router {
  const controller = createConsoleController(deps);
  const router = Router();
  router.get("/", controller.page);
  router.get("/console/jobs", controller.jobs);
  router.post("/console/reviews", asyncHandler(controller.review));
  return router;
}
