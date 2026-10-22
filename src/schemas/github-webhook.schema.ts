/**
 * pull_request Webhook 중 opened, synchronize, reopened만 받는다.
 * 그 외 이벤트는 스키마를 통과해도 큐에 넣지 않는다.
 */
import { z } from "zod";

export const SUPPORTED_PULL_REQUEST_ACTIONS = ["opened", "synchronize", "reopened"] as const;

export const pullRequestActionSchema = z.enum(SUPPORTED_PULL_REQUEST_ACTIONS);

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/i);

export const pullRequestEnvelopeSchema = z.object({
  action: z.string().min(1).max(64),
});

export const pullRequestWebhookSchema = z.object({
  action: pullRequestActionSchema,
  installation: z.object({
    id: z.number().int().positive(),
  }),
  repository: z.object({
    name: z.string().min(1).max(100),
    full_name: z.string().min(1).max(200),
    owner: z.object({
      login: z.string().min(1).max(100),
    }),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    draft: z.boolean(),
    head: z.object({
      sha: shaSchema,
    }),
  }),
});

export const deliveryIdSchema = z.string().uuid();

export const webhookAcceptedSchema = z
  .object({
    status: z.literal("accepted"),
    deliveryId: deliveryIdSchema,
  })
  .strict();

export const webhookIgnoredSchema = z
  .object({
    status: z.literal("ignored"),
    reason: z.enum(["ping", "unsupported-event", "unsupported-action", "draft"]),
  })
  .strict();

export const webhookDuplicateSchema = z
  .object({
    status: z.literal("duplicate"),
    reason: z.literal("duplicate-delivery"),
  })
  .strict();

export type PullRequestWebhook = z.infer<typeof pullRequestWebhookSchema>;
export type WebhookAccepted = z.infer<typeof webhookAcceptedSchema>;
export type WebhookIgnored = z.infer<typeof webhookIgnoredSchema>;
export type WebhookDuplicate = z.infer<typeof webhookDuplicateSchema>;
export type WebhookAck = WebhookAccepted | WebhookIgnored | WebhookDuplicate;
