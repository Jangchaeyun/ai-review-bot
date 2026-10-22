/** 테스트가 수신 바이트 기준으로 GitHub 서명을 만든다. */
import { createHmac } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { TEST_WEBHOOK_SECRET } from "./test-app.js";

export function signGithubBody(body: string | Buffer, secret = TEST_WEBHOOK_SECRET): string {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

export function pullRequestPayload(options?: {
  action?: string;
  draft?: boolean;
  sha?: string;
}): string {
  return JSON.stringify({
    action: options?.action ?? "opened",
    installation: { id: 42 },
    repository: {
      name: "ai-review-bot",
      full_name: "octo/ai-review-bot",
      owner: { login: "octo" },
    },
    pull_request: {
      number: 7,
      draft: options?.draft ?? false,
      head: { sha: options?.sha ?? "a".repeat(40) },
    },
  });
}

type WebhookHeaders = {
  event: string;
  delivery: string;
  signature?: string;
  contentType?: string | false;
};

export function postWebhook(app: Express, body: string | Buffer, headers: WebhookHeaders) {
  const req = request(app).post("/webhooks/github");

  if (headers.contentType !== false) {
    req.set("Content-Type", headers.contentType ?? "application/json");
  }
  req.set("X-GitHub-Event", headers.event);
  req.set("X-GitHub-Delivery", headers.delivery);
  if (headers.signature !== undefined) {
    req.set("X-Hub-Signature-256", headers.signature);
  }

  return req.send(body);
}
