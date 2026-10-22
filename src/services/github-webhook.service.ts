/**
 * Webhook을 서명과 스키마로 검증하고, 받을 이벤트만 큐에 넣은 뒤 202를 반환한다.
 * 서명이 틀리면 본문 스키마를 보지 않는다.
 */
import type { Logger } from "pino";
import { errorResponseSchema, type ErrorResponse } from "../schemas/error-response.schema.js";
import {
  deliveryIdSchema,
  pullRequestEnvelopeSchema,
  pullRequestWebhookSchema,
  webhookAcceptedSchema,
  webhookDuplicateSchema,
  webhookIgnoredSchema,
  type WebhookAck,
} from "../schemas/github-webhook.schema.js";
import { verifyGithubSignature } from "../utils/github-signature.js";
import type { DeliveryStore } from "./delivery-store.js";
import type { ReviewJobQueue } from "./review-job-queue.js";
import { toReviewJob } from "./review-job.js";

export type GithubWebhookDeps = {
  secret: string;
  logger: Logger;
  deliveryStore: DeliveryStore;
  reviewJobQueue: ReviewJobQueue;
};

export type GithubWebhookInput = {
  rawBody: Buffer;
  path: string;
  contentType: string | undefined;
  signatureHeader: string | undefined;
  eventName: string | undefined;
  deliveryId: string | undefined;
};

export type GithubWebhookResult = {
  statusCode: number;
  body: WebhookAck | ErrorResponse;
};

const SAFE_TOKEN = /^[a-z0-9_]{1,64}$/;

function isJsonContentType(contentType: string | undefined): boolean {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

function parseJson(rawBody: Buffer): unknown | undefined {
  try {
    const value: unknown = JSON.parse(rawBody.toString("utf8"));
    return value;
  } catch {
    return undefined;
  }
}

function errorBody(path: string, code: string, message: string): ErrorResponse {
  return errorResponseSchema.parse({
    error: {
      code,
      message,
      path,
    },
  });
}

function logWebhook(
  logger: Logger,
  fields: {
    outcome: "accepted" | "ignored" | "duplicate" | "rejected";
    statusCode: number;
    reason?: string;
    deliveryId?: string;
    event?: string;
    action?: string;
    repository?: string;
    pullRequestNumber?: number;
    headSha?: string;
  },
): void {
  const event = fields.event !== undefined && SAFE_TOKEN.test(fields.event) ? fields.event : undefined;
  const action = fields.action !== undefined && SAFE_TOKEN.test(fields.action) ? fields.action : undefined;
  logger.info(
    {
      outcome: fields.outcome,
      statusCode: fields.statusCode,
      ...(fields.reason === undefined ? {} : { reason: fields.reason }),
      ...(fields.deliveryId === undefined ? {} : { deliveryId: fields.deliveryId }),
      ...(event === undefined ? {} : { event }),
      ...(action === undefined ? {} : { action }),
      ...(fields.repository === undefined ? {} : { repository: fields.repository }),
      ...(fields.pullRequestNumber === undefined ? {} : { pullRequestNumber: fields.pullRequestNumber }),
      ...(fields.headSha === undefined ? {} : { headSha: fields.headSha }),
    },
    "github webhook received",
  );
}

function safeDeliveryId(deliveryId: string | undefined): string | undefined {
  const parsed = deliveryIdSchema.safeParse(deliveryId);
  return parsed.success ? parsed.data : undefined;
}

export function receiveGithubWebhook(deps: GithubWebhookDeps, input: GithubWebhookInput): GithubWebhookResult {
  const loggedDeliveryId = safeDeliveryId(input.deliveryId);

  if (!verifyGithubSignature(input.rawBody, input.signatureHeader, deps.secret)) {
    logWebhook(deps.logger, {
      outcome: "rejected",
      statusCode: 401,
      reason: "invalid-signature",
      ...(loggedDeliveryId === undefined ? {} : { deliveryId: loggedDeliveryId }),
      ...(input.eventName === undefined ? {} : { event: input.eventName }),
    });
    return {
      statusCode: 401,
      body: errorBody(input.path, "INVALID_SIGNATURE", "서명이 올바르지 않습니다."),
    };
  }

  if (!isJsonContentType(input.contentType)) {
    logWebhook(deps.logger, {
      outcome: "rejected",
      statusCode: 400,
      reason: "invalid-content-type",
      ...(loggedDeliveryId === undefined ? {} : { deliveryId: loggedDeliveryId }),
    });
    return {
      statusCode: 400,
      body: errorBody(input.path, "INVALID_CONTENT_TYPE", "Content-Type은 application/json이어야 합니다."),
    };
  }

  if (input.eventName === undefined || !SAFE_TOKEN.test(input.eventName)) {
    logWebhook(deps.logger, {
      outcome: "rejected",
      statusCode: 400,
      reason: "invalid-event",
      ...(loggedDeliveryId === undefined ? {} : { deliveryId: loggedDeliveryId }),
    });
    return {
      statusCode: 400,
      body: errorBody(input.path, "INVALID_EVENT", "X-GitHub-Event 헤더가 올바르지 않습니다."),
    };
  }

  if (loggedDeliveryId === undefined) {
    logWebhook(deps.logger, {
      outcome: "rejected",
      statusCode: 400,
      reason: "invalid-delivery",
      event: input.eventName,
    });
    return {
      statusCode: 400,
      body: errorBody(input.path, "INVALID_DELIVERY", "X-GitHub-Delivery 헤더가 올바르지 않습니다."),
    };
  }

  const payload = parseJson(input.rawBody);
  if (payload === undefined) {
    logWebhook(deps.logger, {
      outcome: "rejected",
      statusCode: 400,
      reason: "invalid-json",
      deliveryId: loggedDeliveryId,
      event: input.eventName,
    });
    return {
      statusCode: 400,
      body: errorBody(input.path, "INVALID_JSON", "JSON 본문을 해석할 수 없습니다."),
    };
  }

  if (input.eventName === "ping") {
    logWebhook(deps.logger, {
      outcome: "ignored",
      statusCode: 200,
      reason: "ping",
      deliveryId: loggedDeliveryId,
      event: input.eventName,
    });
    return {
      statusCode: 200,
      body: webhookIgnoredSchema.parse({ status: "ignored", reason: "ping" }),
    };
  }

  if (input.eventName !== "pull_request") {
    logWebhook(deps.logger, {
      outcome: "ignored",
      statusCode: 200,
      reason: "unsupported-event",
      deliveryId: loggedDeliveryId,
      event: input.eventName,
    });
    return {
      statusCode: 200,
      body: webhookIgnoredSchema.parse({ status: "ignored", reason: "unsupported-event" }),
    };
  }

  const envelope = pullRequestEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    logWebhook(deps.logger, {
      outcome: "rejected",
      statusCode: 400,
      reason: "invalid-payload",
      deliveryId: loggedDeliveryId,
      event: input.eventName,
    });
    return {
      statusCode: 400,
      body: errorBody(input.path, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다."),
    };
  }

  const actionParsed = pullRequestWebhookSchema.shape.action.safeParse(envelope.data.action);
  if (!actionParsed.success) {
    logWebhook(deps.logger, {
      outcome: "ignored",
      statusCode: 200,
      reason: "unsupported-action",
      deliveryId: loggedDeliveryId,
      event: input.eventName,
      action: envelope.data.action,
    });
    return {
      statusCode: 200,
      body: webhookIgnoredSchema.parse({ status: "ignored", reason: "unsupported-action" }),
    };
  }

  const event = pullRequestWebhookSchema.safeParse(payload);
  if (!event.success) {
    logWebhook(deps.logger, {
      outcome: "rejected",
      statusCode: 400,
      reason: "invalid-payload",
      deliveryId: loggedDeliveryId,
      event: input.eventName,
      action: actionParsed.data,
    });
    return {
      statusCode: 400,
      body: errorBody(input.path, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다."),
    };
  }

  if (event.data.pull_request.draft) {
    logWebhook(deps.logger, {
      outcome: "ignored",
      statusCode: 200,
      reason: "draft",
      deliveryId: loggedDeliveryId,
      event: input.eventName,
      action: event.data.action,
      repository: event.data.repository.full_name,
      pullRequestNumber: event.data.pull_request.number,
      headSha: event.data.pull_request.head.sha,
    });
    return {
      statusCode: 200,
      body: webhookIgnoredSchema.parse({ status: "ignored", reason: "draft" }),
    };
  }

  if (deps.deliveryStore.claim(loggedDeliveryId) === "duplicate") {
    logWebhook(deps.logger, {
      outcome: "duplicate",
      statusCode: 200,
      reason: "duplicate-delivery",
      deliveryId: loggedDeliveryId,
      event: input.eventName,
      action: event.data.action,
      repository: event.data.repository.full_name,
      pullRequestNumber: event.data.pull_request.number,
      headSha: event.data.pull_request.head.sha,
    });
    return {
      statusCode: 200,
      body: webhookDuplicateSchema.parse({ status: "duplicate", reason: "duplicate-delivery" }),
    };
  }

  const job = toReviewJob(loggedDeliveryId, event.data);
  try {
    deps.reviewJobQueue.enqueue(job);
  } catch (error) {
    deps.deliveryStore.release(loggedDeliveryId);
    logWebhook(deps.logger, {
      outcome: "rejected",
      statusCode: 500,
      reason: "queue-failed",
      deliveryId: loggedDeliveryId,
      event: input.eventName,
      action: event.data.action,
      repository: event.data.repository.full_name,
      pullRequestNumber: event.data.pull_request.number,
      headSha: event.data.pull_request.head.sha,
    });
    deps.logger.error(
      {
        outcome: "queue-failed",
        deliveryId: loggedDeliveryId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "review job enqueue failed",
    );
    return {
      statusCode: 500,
      body: errorBody(input.path, "QUEUE_FAILED", "요청을 처리하지 못했습니다."),
    };
  }

  logWebhook(deps.logger, {
    outcome: "accepted",
    statusCode: 202,
    deliveryId: loggedDeliveryId,
    event: input.eventName,
    action: event.data.action,
    repository: event.data.repository.full_name,
    pullRequestNumber: event.data.pull_request.number,
    headSha: event.data.pull_request.head.sha,
  });

  return {
    statusCode: 202,
    body: webhookAcceptedSchema.parse({ status: "accepted", deliveryId: loggedDeliveryId }),
  };
}
