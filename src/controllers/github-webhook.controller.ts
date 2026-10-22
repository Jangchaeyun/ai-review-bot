import type { Request, Response } from "express";
import { receiveGithubWebhook, type GithubWebhookDeps } from "../services/github-webhook.service.js";
import { requestPath } from "../utils/request-path.js";

export function createGithubWebhookController(deps: GithubWebhookDeps) {
  return function githubWebhookController(req: Request, res: Response): void {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const result = receiveGithubWebhook(deps, {
      rawBody,
      path: requestPath(req),
      contentType: req.get("content-type"),
      signatureHeader: req.get("x-hub-signature-256"),
      eventName: req.get("x-github-event"),
      deliveryId: req.get("x-github-delivery"),
    });
    res.status(result.statusCode).json(result.body);
  };
}
