/** 회원가입, 로그인, 중복 사용자, 콘솔 접근을 확인한다. */
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createMemoryAccountStore } from "../../src/services/account-store.js";
import type { ReviewJobRecord } from "../../src/services/review-activity.js";
import { createTestApp } from "../helpers/test-app.js";

const job: ReviewJobRecord = {
  deliveryId: "33333333-3333-4333-8333-333333333333",
  owner: "acme",
  repo: "demo",
  pullNumber: 12,
  headSha: "abc123abc123abc123abc123abc123abc123abcd",
  status: "done",
  updatedAt: 1_700_000_000_000,
};

const password = "correct-horse";
const founderProfile = {
  position: "representative",
  companyName: "에이커",
  businessNumber: "123-45-67891",
  representative: "홍길동",
  employeeNumber: "A-1001",
  department: "개발",
};

function app() {
  return createTestApp(undefined, {
    accounts: createMemoryAccountStore(),
    listJobs: () => [job],
    requestReview: async () => job,
  });
}

describe("account login", () => {
  it("registers a user once and then requires that session for a review", async () => {
    const server = app();
    const agent = request.agent(server);
    expect((await request(server).get("/account/setup").expect(200)).body).toEqual({ companyRegistered: false });
    const early = await request(server).post("/account/signup").send({
      username: "jun",
      password,
      position: "employee",
      employeeNumber: "B-2002",
    }).expect(400);
    expect(early.body.error.code).toBe("REPRESENTATIVE_REQUIRED");
    const created = await agent.post("/account/signup").send({ username: "Mina", password, ...founderProfile }).expect(201);
    expect(created.body.user).toEqual({
      username: "Mina",
      role: "admin",
      position: "representative",
      companyName: "에이커",
      employeeNumber: "A-1001",
      department: "개발",
    });
    expect(created.body.inviteCode).toMatch(/^[A-Z2-9]{10}$/);
    expect((await request(server).get("/account/setup").expect(200)).body).toEqual({ companyRegistered: true });
    expect(JSON.stringify(created.body)).not.toContain(password);
    expect(created.headers["set-cookie"]?.[0]).toContain("HttpOnly");

    const duplicate = await agent.post("/account/signup").send({
      username: "mina",
      password: "another-horse",
      position: "employee",
      inviteCode: created.body.inviteCode,
      employeeNumber: "B-2002",
    }).expect(409);
    expect(duplicate.body.error.code).toBe("USERNAME_TAKEN");
    expect(JSON.stringify(duplicate.body)).not.toContain("mina");

    await agent.get("/account/me").expect(200);
    const jobs = await agent.get("/console/jobs").expect(200);
    expect(jobs.body.jobs).toEqual([job]);
    await agent.post("/console/reviews").send({ pullRequestUrl: "acme/demo#12" }).expect(202);
  });

  it("hides review jobs until the password matches", async () => {
    const server = app();
    let called = false;
    const guarded = createTestApp(undefined, {
      accounts: createMemoryAccountStore(),
      requestReview: async () => {
        called = true;
        return job;
      },
    });
    await request(guarded).post("/account/signup").send({ username: "mina", password, ...founderProfile }).expect(201);
    const denied = await request(guarded).get("/console/jobs").expect(401);
    expect(denied.body.error.code).toBe("AUTH_REQUIRED");
    await request(guarded).post("/console/reviews").send({ pullRequestUrl: "acme/demo#12" }).expect(401);
    expect(called).toBe(false);

    const failed = await request(server).post("/account/login").send({ username: "nobody", password }).expect(401);
    expect(failed.body.error.code).toBe("AUTH_FAILED");
    expect(JSON.stringify(failed.body)).not.toContain(password);

    const agent = request.agent(server);
    await agent.post("/account/signup").send({ username: "mina", password, ...founderProfile }).expect(201);
    await agent.post("/account/logout").expect(204);
    await agent.get("/account/me").expect(401);
    await agent.post("/account/login").send({ username: "MINA", password }).expect(200);
    await agent.get("/account/me").expect(200);
  });

  it("joins a company with an invite and records who requested a review", async () => {
    let requestedBy = "";
    const server = createTestApp(undefined, {
      accounts: createMemoryAccountStore(),
      requestReview: async (_pullRequestUrl, _language, requester) => {
        requestedBy = requester ?? "";
        return job;
      },
    });
    const admin = request.agent(server);
    const founded = await admin.post("/account/signup").send({ username: "mina", password, ...founderProfile }).expect(201);
    const company = await admin.get("/account/company").expect(200);
    expect(company.body.inviteCode).toBe(founded.body.inviteCode);
    expect(company.body.businessNumber).toBe("123-45-67891");
    expect(company.body.representative).toBe("홍길동");
    expect(company.body.position).toBe("representative");
    expect(company.body.members).toEqual([{
      username: "mina",
      role: "admin",
      position: "representative",
      employeeNumber: "A-1001",
      department: "개발",
    }]);

    const member = request.agent(server);
    const secondCompany = await member.post("/account/signup").send({
      username: "ara",
      password,
      position: "representative",
      companyName: "다른 회사",
      businessNumber: "123-45-67891",
      representative: "김대표",
      employeeNumber: "C-3003",
    }).expect(409);
    expect(secondCompany.body.error.code).toBe("COMPANY_EXISTS");
    const rejected = await member.post("/account/signup").send({
      username: "jun",
      password,
      position: "employee",
      inviteCode: "not-the-code",
      employeeNumber: "B-2002",
    }).expect(401);
    expect(rejected.body.error.code).toBe("INVITE_INVALID");
    expect(JSON.stringify(rejected.body)).not.toContain("not-the-code");

    const reused = await member.post("/account/signup").send({
      username: "jun",
      password,
      position: "employee",
      inviteCode: founded.body.inviteCode,
      employeeNumber: "a-1001",
    }).expect(409);
    expect(reused.body.error.code).toBe("EMPLOYEE_TAKEN");
    expect(JSON.stringify(reused.body)).not.toContain("a-1001");
    await member.post("/account/signup").send({
      username: "jun",
      password,
      position: "employee",
      inviteCode: founded.body.inviteCode,
      employeeNumber: "B-2002",
    }).expect(201);
    const visible = await member.get("/account/company").expect(200);
    expect(visible.body.inviteCode).toBeUndefined();
    expect(visible.body.position).toBe("employee");
    expect(visible.body.businessNumber).toBe("123-45-67891");
    expect(visible.body.members).toEqual([
      { username: "mina", role: "admin", position: "representative", employeeNumber: "A-1001", department: "개발" },
      { username: "jun", role: "member", position: "employee", employeeNumber: "B-2002" },
    ]);
    await member.post("/account/company/invite").expect(403);
    await member.post("/account/company").send({ name: "다른 이름" }).expect(403);
    const renamed = await admin.post("/account/company").send({ name: "에이커 랩" }).expect(200);
    expect(renamed.body).toEqual({ name: "에이커 랩" });
    const rotated = await admin.post("/account/company/invite").expect(200);
    expect(rotated.body.inviteCode).toMatch(/^[A-Z2-9]{10}$/);
    expect(rotated.body.inviteCode).not.toBe(founded.body.inviteCode);

    await member.post("/console/reviews").send({ pullRequestUrl: "acme/demo#12" }).expect(202);
    expect(requestedBy).toBe("jun");
  });

  it("rejects a short password without echoing it", async () => {
    const response = await request(app()).post("/account/signup").send({ username: "mina", password: "short", ...founderProfile }).expect(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("short");
  });

  it("rejects an invalid business number without echoing it", async () => {
    const response = await request(app()).post("/account/signup").send({
      username: "mina",
      password,
      position: "representative",
      companyName: "에이커",
      businessNumber: "123-45-67890",
      representative: "홍길동",
      employeeNumber: "A-1001",
    }).expect(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("123-45-67890");
  });
});
