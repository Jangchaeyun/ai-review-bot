import type { PullRequestWebhook } from "../schemas/github-webhook.schema.js";
import type { ReviewLanguage } from "./review-language.js";

export type ReviewJob = {
  deliveryId: string;
  action: PullRequestWebhook["action"];
  installationId: number;
  repositoryFullName: string;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  language?: ReviewLanguage;
};

export function toReviewJob(deliveryId: string, event: PullRequestWebhook): ReviewJob {
  return {
    deliveryId,
    action: event.action,
    installationId: event.installation.id,
    repositoryFullName: event.repository.full_name,
    owner: event.repository.owner.login,
    repo: event.repository.name,
    pullNumber: event.pull_request.number,
    headSha: event.pull_request.head.sha,
  };
}
