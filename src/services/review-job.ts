/**
 * 큐에 넣는 리뷰 작업. Webhook에서 만들 때는 언어를 비워 한국어로 처리한다.
 * 콘솔 요청만 language와 requestedBy를 채운다. Webhook 작업은 요청자를 비운다.
 */
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
  requestedBy?: string;
};

/** Webhook 페이로드에서 큐에 필요한 필드만 고른다. 제목과 diff는 여기 담지 않는다. */
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
