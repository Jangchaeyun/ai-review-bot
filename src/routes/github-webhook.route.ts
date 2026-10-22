/**
 * Webhook 전용 라우트. express.raw로 본문을 Buffer로 남긴다.
 * JSON 파서가 먼저 읽으면 서명에 쓸 원문 바이트가 사라진다.
 */
import express, { Router } from "express";
import { createGithubWebhookController } from "../controllers/github-webhook.controller.js";
import type { GithubWebhookDeps } from "../services/github-webhook.service.js";

export function createGithubWebhookRouter(deps: GithubWebhookDeps): Router {
  const router = Router();
  router.post(
    "/",
    express.raw({
      type: () => true,
      limit: "1mb",
    }),
    createGithubWebhookController(deps),
  );
  return router;
}
