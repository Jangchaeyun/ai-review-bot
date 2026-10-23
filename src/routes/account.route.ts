/** 회원가입, 로그인, 로그아웃, 회사와 초대 코드, 현재 사용자 확인. */
import { Router } from "express";
import { createAccountController, type AccountControllerDeps } from "../controllers/account.controller.js";
import { asyncHandler } from "../utils/async-handler.js";

export function createAccountRouter(deps: AccountControllerDeps): Router {
  const controller = createAccountController(deps);
  const router = Router();
  router.get("/account/setup", controller.setup);
  router.post("/account/signup", asyncHandler(controller.signup));
  router.post("/account/login", asyncHandler(controller.login));
  router.post("/account/logout", controller.logout);
  router.get("/account/me", controller.me);
  router.get("/account/company", controller.company);
  router.post("/account/company", controller.rename);
  router.post("/account/profile", controller.profile);
  router.post("/account/company/invite", controller.rotateInvite);
  return router;
}
