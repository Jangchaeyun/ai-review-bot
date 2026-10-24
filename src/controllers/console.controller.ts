/**
 * 콘솔 요청을 검증한다. 주소 형식과 언어를 확인한 뒤 리뷰 등록은 서비스에 맡긴다.
 * 페이지에는 비밀을 넣지 않고, 스크립트는 같은 출처로만 요청하게 한다.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { currentUser } from "./account.controller.js";
import { AppError } from "../utils/app-error.js";
import type { AccountStore } from "../services/account-store.js";
import { CONSOLE_PAGE } from "../services/console-page.js";
import { parsePullRequestUrl } from "../services/parse-pull-request-url.js";
import type { ReviewJobRecord } from "../services/review-activity.js";
import { REVIEW_LANGUAGES, type ReviewLanguage } from "../services/review-language.js";

const requestSchema = z.object({
  pullRequestUrl: z.string().min(1).max(500),
  language: z.enum(REVIEW_LANGUAGES).optional(),
});

export type ConsoleControllerDeps = {
  listJobs: (limit?: number) => ReviewJobRecord[];
  requestReview?: (pullRequestUrl: string, language?: ReviewLanguage, requestedBy?: string) => Promise<ReviewJobRecord>;
  accounts?: AccountStore;
};

/** 계정이 연결된 콘솔은 로그인 세션이 있을 때만 작업 목록과 리뷰 요청을 받는다. */
function requireLogin(req: Request, deps: ConsoleControllerDeps) {
  if (deps.accounts === undefined) {
    return undefined;
  }
  const user = currentUser(req, deps.accounts);
  if (user === undefined) {
    throw new AppError({
      message: "로그인이 필요합니다.",
      code: "AUTH_REQUIRED",
      statusCode: 401,
      expose: true,
    });
  }
  return user;
}

/** 페이지, 작업 목록, 수동 리뷰 요청 핸들러를 만든다. */
export function createConsoleController(deps: ConsoleControllerDeps) {
  return {
    page(_req: Request, res: Response): void {
      res.status(200)
        .set("cache-control", "no-store")
        .set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'")
        .type("html")
        .send(CONSOLE_PAGE);
    },
    jobs(req: Request, res: Response): void {
      requireLogin(req, deps);
      res.status(200).set("cache-control", "no-store").json({ jobs: deps.listJobs() });
    },
    async review(req: Request, res: Response): Promise<void> {
      if (deps.requestReview === undefined) {
        throw new AppError({
          message: "리뷰 요청을 받을 수 없습니다.",
          code: "CONSOLE_UNAVAILABLE",
          statusCode: 503,
          expose: true,
        });
      }
      const user = requireLogin(req, deps);
      const body = requestSchema.parse(req.body);
      parsePullRequestUrl(body.pullRequestUrl);
      const job = user === undefined
        ? await deps.requestReview(body.pullRequestUrl, body.language ?? "ko")
        : await deps.requestReview(body.pullRequestUrl, body.language ?? "ko", user.username);
      res.status(202).json({ job });
    },
  };
}
