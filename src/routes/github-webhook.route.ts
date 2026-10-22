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
