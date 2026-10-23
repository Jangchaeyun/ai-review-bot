/**
 * 딜리버리 키, 게시 키, 작업 큐를 한 SQLite 파일에 남긴다.
 * 이 파일은 프로세스 하나에서만 연다. 인스턴스가 둘 이상이면 공유 저장소가 따로 필요하다.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "pino";
import { z } from "zod";
import { SUPPORTED_PULL_REQUEST_ACTIONS } from "../schemas/github-webhook.schema.js";
import { AppError } from "../utils/app-error.js";
import type { DeliveryStore } from "./delivery-store.js";
import type { ReviewJobRecord, ReviewJobStatus } from "./review-activity.js";
import type { ReviewJob } from "./review-job.js";
import type { ReviewJobHandler, ReviewJobQueue } from "./review-job-queue.js";
import type { ReviewPublishStore } from "./review-publish-store.js";
import { REVIEW_LANGUAGES } from "./review-language.js";
import { createSqliteAccountStore, type AccountStore } from "./account-store.js";
import { reviewSummarySchema, type ReviewSummary } from "./review-summary.js";

const DELIVERY_TTL_MS = 24 * 60 * 60 * 1000;

const reviewJobSchema = z.object({
  deliveryId: z.string().uuid(),
  action: z.enum(SUPPORTED_PULL_REQUEST_ACTIONS),
  installationId: z.number().int().positive(),
  repositoryFullName: z.string().min(1).max(300),
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  pullNumber: z.number().int().positive(),
  headSha: z.string().regex(/^[0-9a-f]{40}$/i),
  language: z.enum(REVIEW_LANGUAGES).optional(),
  requestedBy: z.string().min(2).max(32).optional(),
});

const idRowSchema = z.object({
  delivery_id: z.string(),
});

const payloadRowSchema = z.object({
  payload: z.string(),
});

const jobListSchema = z.object({
  delivery_id: z.string().uuid(),
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  pull_number: z.coerce.number().int().positive(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/i),
  status: z.enum(["pending", "running", "done", "failed", "superseded"]),
  updated_at: z.coerce.number().int().nonnegative(),
  summary: z.string().nullable(),
  payload: z.string(),
});

export type ReviewState = {
  deliveries: DeliveryStore;
  publications: ReviewPublishStore;
  createQueue(handler: ReviewJobHandler, logger: Logger): ReviewJobQueue & {
    whenIdle(): Promise<void>;
    close(): Promise<void>;
  };
  listJobs(limit?: number): ReviewJobRecord[];
  recordSummary(deliveryId: string, summary: ReviewSummary): void;
  accounts: AccountStore;
  close(): void;
};

export function openReviewState(path: string, options?: { now?: () => number; deliveryTtlMs?: number }): ReviewState {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  const now = options?.now ?? Date.now;
  const accounts = createSqliteAccountStore(db, now);
  const deliveryTtlMs = options?.deliveryTtlMs ?? DELIVERY_TTL_MS;
  let stopped = false;
  db.prepare("PRAGMA journal_mode = WAL").get();
  db.prepare("PRAGMA busy_timeout = 5000").run();
  db.exec(`
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY,
      claimed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publications (
      key TEXT PRIMARY KEY,
      claimed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      delivery_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      pull_number INTEGER NOT NULL,
      head_sha TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      summary TEXT
    );
  `);
  try {
    db.exec("ALTER TABLE jobs ADD COLUMN summary TEXT");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("duplicate column name")) {
      throw error;
    }
  }

  const deleteDelivery = db.prepare("DELETE FROM deliveries WHERE id = ?");
  const insertDelivery = db.prepare("INSERT INTO deliveries (id, claimed_at) VALUES (?, ?)");
  const selectDelivery = db.prepare("SELECT claimed_at FROM deliveries WHERE id = ?");
  const deleteExpiredDeliveries = db.prepare("DELETE FROM deliveries WHERE claimed_at <= ?");
  const insertPublication = db.prepare("INSERT INTO publications (key, claimed_at) VALUES (?, ?)");
  const selectPublication = db.prepare("SELECT key FROM publications WHERE key = ?");
  const deletePublication = db.prepare("DELETE FROM publications WHERE key = ?");
  const supersedePending = db.prepare(
    "UPDATE jobs SET status = 'superseded', updated_at = ? WHERE owner = ? AND repo = ? AND pull_number = ? AND status = 'pending'",
  );
  const insertJob = db.prepare(
    "INSERT INTO jobs (delivery_id, owner, repo, pull_number, head_sha, payload, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
  );
  const selectPending = db.prepare(
    "SELECT delivery_id FROM jobs WHERE status = 'pending' ORDER BY updated_at ASC, delivery_id ASC LIMIT 1",
  );
  const markRunning = db.prepare("UPDATE jobs SET status = 'running', updated_at = ? WHERE delivery_id = ? AND status = 'pending'");
  const selectPayload = db.prepare("SELECT payload FROM jobs WHERE delivery_id = ?");
  const markStatus = db.prepare("UPDATE jobs SET status = ?, updated_at = ? WHERE delivery_id = ?");
  const resetRunning = db.prepare("UPDATE jobs SET status = 'pending', updated_at = ? WHERE status = 'running'");
  const selectRecent = db.prepare(
    "SELECT delivery_id, owner, repo, pull_number, head_sha, status, updated_at, summary, payload FROM jobs ORDER BY updated_at DESC, delivery_id DESC LIMIT ?",
  );
  const saveSummary = db.prepare("UPDATE jobs SET summary = ? WHERE delivery_id = ?");

  const deliveries: DeliveryStore = {
    claim(deliveryId) {
      const current = now();
      deleteExpiredDeliveries.run(current - deliveryTtlMs);
      const existing = selectDelivery.get(deliveryId);
      if (existing !== undefined) {
        return "duplicate";
      }
      insertDelivery.run(deliveryId, current);
      return "new";
    },
    release(deliveryId) {
      deleteDelivery.run(deliveryId);
    },
  };

  const publications: ReviewPublishStore = {
    claim(key) {
      if (selectPublication.get(key) !== undefined) {
        return "duplicate";
      }
      insertPublication.run(key, now());
      return "new";
    },
    release(key) {
      deletePublication.run(key);
    },
  };

  function createQueue(handler: ReviewJobHandler, logger: Logger): ReviewJobQueue & {
    whenIdle(): Promise<void>;
    close(): Promise<void>;
  } {
    let active: Promise<void> | null = null;
    let closed = false;

    const finish = (deliveryId: string, status: "done" | "failed" | "superseded"): void => {
      markStatus.run(status, now(), deliveryId);
    };

    const pump = (): void => {
      if (stopped || closed || active !== null) {
        return;
      }
      const next = idRowSchema.safeParse(selectPending.get());
      if (!next.success) {
        return;
      }
      const deliveryId = next.data.delivery_id;
      if (Number(markRunning.run(now(), deliveryId).changes) === 0) {
        pump();
        return;
      }
      const payload = payloadRowSchema.safeParse(selectPayload.get(deliveryId));
      let job: ReviewJob | undefined;
      if (payload.success) {
        try {
          const parsed = reviewJobSchema.safeParse(JSON.parse(payload.data.payload));
          if (parsed.success) {
            const data = parsed.data;
            const nextJob: ReviewJob = {
              deliveryId: data.deliveryId,
              action: data.action,
              installationId: data.installationId,
              repositoryFullName: data.repositoryFullName,
              owner: data.owner,
              repo: data.repo,
              pullNumber: data.pullNumber,
              headSha: data.headSha,
            };
            if (data.language !== undefined) {
              nextJob.language = data.language;
            }
            job = nextJob;
          }
        } catch {
          job = undefined;
        }
      }
      if (job === undefined) {
        finish(deliveryId, "failed");
        logger.error({ outcome: "queue-failed", deliveryId }, "review job payload invalid");
        pump();
        return;
      }
      const currentJob = job;

      active = Promise.resolve()
        .then(() => handler(currentJob))
        .then(() => {
          finish(deliveryId, "done");
        })
        .catch((error: unknown) => {
          finish(deliveryId, "failed");
          logger.error(
            {
              outcome: "queue-failed",
              deliveryId,
              errorName: error instanceof Error ? error.name : "UnknownError",
            },
            "review job failed",
          );
        })
        .finally(() => {
          active = null;
          pump();
        });
    };

    resetRunning.run(now());
    pump();

    return {
      enqueue(job) {
        if (stopped || closed) {
          throw new AppError({
            message: "리뷰 작업 저장소가 이미 닫혔습니다.",
            code: "STATE_CLOSED",
            statusCode: 500,
            expose: false,
          });
        }
        db.exec("BEGIN IMMEDIATE");
        try {
          supersedePending.run(now(), job.owner, job.repo, job.pullNumber);
          insertJob.run(job.deliveryId, job.owner, job.repo, job.pullNumber, job.headSha, JSON.stringify(job), now());
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        setImmediate(pump);
      },
      async whenIdle() {
        while (active !== null || idRowSchema.safeParse(selectPending.get()).success) {
          if (active !== null) {
            await active;
            continue;
          }
          pump();
          if (active === null) {
            return;
          }
        }
      },
      async close() {
        closed = true;
        if (active !== null) {
          await active;
        }
      },
    };
  }

  return {
    deliveries,
    publications,
    createQueue,
    listJobs(limit = 30) {
      const bounded = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 30;
      const rows = selectRecent.all(bounded);
      const jobs: ReviewJobRecord[] = [];
      for (const row of rows) {
        const parsed = jobListSchema.safeParse(row);
        if (!parsed.success) {
          continue;
        }
        const status: ReviewJobStatus = parsed.data.status;
        const record: ReviewJobRecord = {
          deliveryId: parsed.data.delivery_id,
          owner: parsed.data.owner,
          repo: parsed.data.repo,
          pullNumber: parsed.data.pull_number,
          headSha: parsed.data.head_sha.toLowerCase(),
          status,
          updatedAt: parsed.data.updated_at,
        };
        try {
          const payload = reviewJobSchema.safeParse(JSON.parse(parsed.data.payload));
          if (payload.success && payload.data.language !== undefined) {
            record.language = payload.data.language;
          }
          if (payload.success && payload.data.requestedBy !== undefined) {
            record.requestedBy = payload.data.requestedBy;
          }
        } catch {
          // 손상된 작업 본문은 언어 표시만 생략한다.
        }
        if (parsed.data.summary !== null) {
          try {
            const summary = reviewSummarySchema.safeParse(JSON.parse(parsed.data.summary));
            if (summary.success) {
              record.summary = summary.data;
            }
          } catch {
            // 손상된 요약은 목록에서 빠진다.
          }
        }
        jobs.push(record);
      }
      return jobs;
    },
    accounts,
    recordSummary(deliveryId, summary) {
      const text = JSON.stringify(summary);
      if (text.length > 8_000) {
        return;
      }
      saveSummary.run(text, deliveryId);
    },
    close() {
      stopped = true;
      db.close();
    },
  };
}
