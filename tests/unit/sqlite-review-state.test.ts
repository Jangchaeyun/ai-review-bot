/** 재시작 뒤 대기 작업이 이어지고, 끝난 작업과 게시 기록이 유지되는지 확인한다. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewJob } from "../../src/services/review-job.js";
import { openReviewState, type ReviewState } from "../../src/services/sqlite-review-state.js";

const logger = pino({ level: "silent" });

function job(deliveryId: string, headSha: string, pullNumber = 7): ReviewJob {
  return {
    deliveryId,
    action: "opened",
    installationId: 1,
    repositoryFullName: "acme/demo",
    owner: "acme",
    repo: "demo",
    pullNumber,
    headSha,
  };
}

describe("sqlite review state", () => {
  const directories: string[] = [];
  const states: ReviewState[] = [];

  afterEach(() => {
    for (const state of states.splice(0)) {
      state.close();
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function stateFile(): string {
    const directory = mkdtempSync(join(tmpdir(), "review-state-"));
    directories.push(directory);
    return join(directory, "review-bot.sqlite");
  }

  it("keeps a delivery claim and a publish key after the file is reopened", () => {
    const path = stateFile();
    const first = openReviewState(path);
    states.push(first);
    expect(first.deliveries.claim("11111111-1111-4111-8111-111111111111")).toBe("new");
    expect(first.publications.claim("acme/demo#7@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe("new");
    states.pop()?.close();

    const second = openReviewState(path);
    states.push(second);
    expect(second.deliveries.claim("11111111-1111-4111-8111-111111111111")).toBe("duplicate");
    expect(second.publications.claim("acme/demo#7@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe("duplicate");
  });

  it("allows the same delivery id after the ttl", () => {
    let current = 1_000;
    const state = openReviewState(stateFile(), { now: () => current, deliveryTtlMs: 500 });
    states.push(state);
    expect(state.deliveries.claim("22222222-2222-4222-8222-222222222222")).toBe("new");
    current = 1_600;
    expect(state.deliveries.claim("22222222-2222-4222-8222-222222222222")).toBe("new");
  });

  it("runs a pending job once and does not replay a finished job", async () => {
    const path = stateFile();
    const sha = "abc123abc123abc123abc123abc123abc123abcd";
    const first = openReviewState(path);
    states.push(first);
    const seen: string[] = [];
    const queue = first.createQueue(async (item) => {
      seen.push(item.headSha);
    }, logger);
    queue.enqueue(job("33333333-3333-4333-8333-333333333333", sha));
    await queue.whenIdle();
    expect(seen).toEqual([sha]);
    await queue.close();
    states.pop()?.close();

    const second = openReviewState(path);
    states.push(second);
    const replayed: string[] = [];
    const resumed = second.createQueue(async (item) => {
      replayed.push(item.headSha);
    }, logger);
    await resumed.whenIdle();
    expect(replayed).toEqual([]);
    expect(second.listJobs()).toEqual([
      {
        deliveryId: "33333333-3333-4333-8333-333333333333",
        owner: "acme",
        repo: "demo",
        pullNumber: 7,
        headSha: sha,
        status: "done",
        updatedAt: expect.any(Number),
      },
    ]);
  });

  it("resumes a job that was running when the process stopped", async () => {
    const path = stateFile();
    const sha = "def456def456def456def456def456def456def4";
    const first = openReviewState(path);
    states.push(first);
    const queue = first.createQueue(async () => {}, logger);
    queue.enqueue(job("44444444-4444-4444-8444-444444444444", sha));
    await queue.whenIdle();
    await queue.close();
    states.pop()?.close();

    const db = new DatabaseSync(path);
    try {
      db.prepare("UPDATE jobs SET status = 'running' WHERE delivery_id = ?").run("44444444-4444-4444-8444-444444444444");
    } finally {
      db.close();
    }

    const second = openReviewState(path);
    states.push(second);
    const seen: string[] = [];
    const resumed = second.createQueue(async (item) => {
      seen.push(item.headSha);
    }, logger);
    await resumed.whenIdle();
    expect(seen).toEqual([sha]);
  });

  it("keeps the running job and drops older pending jobs for the same pull request", async () => {
    const state = openReviewState(stateFile());
    states.push(state);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    const queue = state.createQueue(async (item) => {
      seen.push(item.headSha);
      if (seen.length === 1) {
        await gate;
      }
    }, logger);

    const older = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const middle = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const newer = "cccccccccccccccccccccccccccccccccccccccc";
    queue.enqueue(job("55555555-5555-4555-8555-555555555555", older));
    while (seen.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    queue.enqueue(job("66666666-6666-4666-8666-666666666666", middle));
    queue.enqueue(job("77777777-7777-4777-8777-777777777777", newer));
    release();
    await queue.whenIdle();
    expect(seen).toEqual([older, newer]);
  });

  it("keeps a review summary with the job", async () => {
    const state = openReviewState(stateFile());
    states.push(state);
    const queue = state.createQueue(async () => {}, logger);
    queue.enqueue(job("88888888-8888-4888-8888-888888888888", "abc123abc123abc123abc123abc123abc123abcd"));
    await queue.whenIdle();
    state.recordSummary("88888888-8888-4888-8888-888888888888", {
      outcome: "posted",
      reviewId: 42,
      counts: { critical: 0, high: 1, medium: 0, low: 0 },
      highlights: [{ severity: "high", title: "할인 계산이 잘못되었습니다", filePath: "src/discount.js" }],
    });
    expect(state.listJobs()[0]?.summary).toEqual({
      outcome: "posted",
      reviewId: 42,
      counts: { critical: 0, high: 1, medium: 0, low: 0 },
      highlights: [{ severity: "high", title: "할인 계산이 잘못되었습니다", filePath: "src/discount.js" }],
    });
  });

  it("keeps the selected comment language on the job", async () => {
    const state = openReviewState(stateFile());
    states.push(state);
    const seen: string[] = [];
    const queue = state.createQueue(async (item) => {
      seen.push(item.language ?? "missing");
    }, logger);
    queue.enqueue({
      ...job("99999999-9999-4999-8999-999999999999", "def456def456def456def456def456def456def4"),
      language: "en",
    });
    await queue.whenIdle();
    expect(seen).toEqual(["en"]);
    expect(state.listJobs()[0]?.language).toBe("en");
  });

  it("keeps one user when the same name is registered again", () => {
    const path = stateFile();
    const first = openReviewState(path);
    states.push(first);
    const founder = first.accounts.register({
      username: "Mina",
      usernameKey: "mina",
      passwordHash: "hash-one",
      position: "representative",
      companyName: "에이커",
      businessNumber: "1234567891",
      representative: "홍길동",
      employeeNumber: "A-1001",
      department: "개발",
    });
    expect(founder.status).toBe("created");
    if (founder.status !== "created" || founder.inviteCode === undefined) {
      return;
    }
    expect(first.accounts.register({
      username: "mina",
      usernameKey: "mina",
      passwordHash: "hash-two",
      position: "employee",
      inviteCode: founder.inviteCode,
      employeeNumber: "B-2002",
    }).status).toBe("duplicate");
    states.pop()?.close();

    const second = openReviewState(path);
    states.push(second);
    expect(second.accounts.findByUsernameKey("mina")?.user).toMatchObject({
      username: "Mina",
      role: "admin",
      position: "representative",
      companyName: "에이커",
    });
    const persistedInvite = second.accounts.company()?.inviteCode;
    if (persistedInvite === undefined) {
      return;
    }
    expect(second.accounts.company()).toMatchObject({ businessNumber: "1234567891", representative: "홍길동" });
    expect(second.accounts.register({
      username: "MINA",
      usernameKey: "mina",
      passwordHash: "hash-three",
      position: "employee",
      inviteCode: persistedInvite,
      employeeNumber: "B-2002",
    }).status).toBe("duplicate");
    const joined = second.accounts.register({
      username: "jun",
      usernameKey: "jun",
      passwordHash: "hash-four",
      position: "employee",
      inviteCode: persistedInvite,
      employeeNumber: "B-2002",
    });
    expect(joined).toMatchObject({ status: "created", user: { role: "member", position: "employee", companyName: "에이커" } });
  });

  it("registers a placeholder company name when a later signup sends one", () => {
    const path = stateFile();
    const first = openReviewState(path);
    states.push(first);
    states.pop()?.close();
    const db = new DatabaseSync(path);
    db.prepare(
      "INSERT INTO users (id, username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("user-1", "reviewer", "reviewer", "hash", 1);
    db.close();

    const second = openReviewState(path);
    states.push(second);
    expect(second.accounts.company()).toMatchObject({ name: "기본 조직", registered: false });
    const joined = second.accounts.register({
      username: "mina",
      usernameKey: "mina",
      passwordHash: "hash",
      position: "representative",
      companyName: "에이커",
      businessNumber: "1234567891",
      representative: "홍길동",
      employeeNumber: "A-1001",
    });
    expect(joined).toMatchObject({
      status: "created",
      user: { role: "member", position: "representative", companyName: "에이커", employeeNumber: "A-1001" },
    });
    expect(second.accounts.company()).toMatchObject({
      name: "에이커",
      registered: true,
      businessNumber: "1234567891",
      representative: "홍길동",
    });
    const reviewer = second.accounts.findByUsernameKey("reviewer")?.user;
    expect(reviewer).toMatchObject({ role: "admin", companyName: "에이커" });
    expect(reviewer?.employeeNumber).toBeUndefined();
    if (reviewer === undefined) {
      return;
    }
    expect(second.accounts.updateProfile(reviewer.id, { employeeNumber: "E-9", department: "개발" })).toBe("updated");
    expect(second.accounts.findByUsernameKey("reviewer")?.user).toMatchObject({ employeeNumber: "E-9", department: "개발" });
    expect(second.accounts.updateProfile(reviewer.id, { employeeNumber: "E-10" })).toBe("exists");
  });
});
