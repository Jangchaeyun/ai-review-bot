/** 사용자 이름 중복과 비밀번호 해시를 확인한다. */
import { describe, expect, it } from "vitest";
import { accountName, businessNumberOf, createMemoryAccountStore, departmentOf, employeeNumberOf } from "../../src/services/account-store.js";
import { hashPassword, verifyPassword } from "../../src/services/password.js";

describe("account name", () => {
  it("treats letter case as the same user", () => {
    expect(accountName("Mina")?.usernameKey).toBe(accountName("mina")?.usernameKey);
    expect(accountName("리뷰봇")?.username).toBe("리뷰봇");
  });

  it("rejects a one-character name", () => {
    expect(accountName("a")).toBeUndefined();
  });
});

describe("memory account store", () => {
  it("registers a user once and expires a session", () => {
    let current = 1_000;
    const accounts = createMemoryAccountStore(() => current);
    const created = accounts.register({
      username: "mina",
      usernameKey: "mina",
      passwordHash: "hash",
      position: "representative",
      companyName: "에이커",
      businessNumber: "1234567891",
      representative: "홍길동",
      employeeNumber: "A-1001",
    });
    expect(created.status).toBe("created");
    if (created.status !== "created" || created.inviteCode === undefined) {
      return;
    }
    expect(accounts.register({
      username: "Mina",
      usernameKey: "mina",
      passwordHash: "other",
      position: "employee",
      inviteCode: created.inviteCode,
      employeeNumber: "B-2002",
    }).status).toBe("duplicate");
    accounts.createSession(created.user.id, "token-hash", 1_500);
    expect(accounts.findSession("token-hash")?.username).toBe("mina");
    current = 1_500;
    expect(accounts.findSession("token-hash")).toBeUndefined();
  });
});

describe("company membership", () => {
  it("lets the first user found a company and the next user join with the invite", () => {
    const accounts = createMemoryAccountStore();
    expect(accounts.register({
      username: "jun",
      usernameKey: "jun",
      passwordHash: "hash",
      position: "employee",
      employeeNumber: "B-2002",
    }).status).toBe("representative-required");
    const founder = accounts.register({
      username: "Mina",
      usernameKey: "mina",
      passwordHash: "hash",
      position: "representative",
      companyName: "에이커",
      businessNumber: "1234567891",
      representative: "홍길동",
      employeeNumber: "A-1001",
      department: "개발",
    });
    expect(founder.status).toBe("created");
    if (founder.status !== "created") {
      return;
    }
    if (founder.status !== "created" || founder.inviteCode === undefined) {
      return;
    }
    expect(founder.user.role).toBe("admin");
    expect(founder.user.position).toBe("representative");
    expect(founder.inviteCode).toMatch(/^[A-Z2-9]{10}$/);
    expect(accounts.company()).toMatchObject({
      name: "에이커",
      businessNumber: "1234567891",
      representative: "홍길동",
      registered: true,
    });
    expect(accounts.register({
      username: "jun",
      usernameKey: "jun",
      passwordHash: "hash",
      position: "representative",
      companyName: "다른 회사",
      businessNumber: "1234567891",
      representative: "김대표",
      employeeNumber: "B-2002",
    }).status).toBe("company-exists");
    expect(accounts.register({
      username: "jun",
      usernameKey: "jun",
      passwordHash: "hash",
      position: "employee",
      inviteCode: "WRONGCODE1",
      employeeNumber: "B-2002",
    }).status).toBe("invite-invalid");
    const member = accounts.register({
      username: "jun",
      usernameKey: "jun",
      passwordHash: "hash",
      position: "employee",
      companyName: "다른 회사",
      inviteCode: founder.inviteCode,
      employeeNumber: "B-2002",
    });
    expect(member).toMatchObject({
      status: "created",
      user: { username: "jun", role: "member", position: "employee", companyName: "에이커", employeeNumber: "B-2002" },
    });
    expect(accounts.company()?.name).toBe("에이커");
    expect(accounts.register({
      username: "ara",
      usernameKey: "ara",
      passwordHash: "hash",
      position: "employee",
      inviteCode: founder.inviteCode,
      employeeNumber: "a-1001",
    }).status).toBe("employee-taken");
    expect(accounts.listMembers()).toEqual([
      { username: "Mina", role: "admin", position: "representative", employeeNumber: "A-1001", department: "개발" },
      { username: "jun", role: "member", position: "employee", employeeNumber: "B-2002" },
    ]);
    expect(accounts.updateProfile(founder.user.id, { employeeNumber: "C-3003" })).toBe("exists");
    expect(accounts.rotateInvite(founder.user.id)).not.toBe(founder.inviteCode);
    expect(accounts.renameCompany(founder.user.id, "에이커 랩")).toBe(true);
    expect(accounts.company()?.name).toBe("에이커 랩");
    expect(accounts.company()?.businessNumber).toBe("1234567891");
  });
});

describe("company and employee numbers", () => {
  it("accepts a checksum-valid business number and a short employee number", () => {
    expect(businessNumberOf("123-45-67891")).toBe("1234567891");
    expect(businessNumberOf("1234567890")).toBeUndefined();
    expect(employeeNumberOf("A-1001")).toBe("A-1001");
    expect(employeeNumberOf("사원 1")).toBeUndefined();
    expect(departmentOf("개발")).toBe("개발");
    expect(departmentOf("없는부서")).toBeUndefined();
  });
});

describe("password hash", () => {
  it("accepts the original password and rejects a different one", async () => {
    const stored = await hashPassword("correct-horse");
    expect(stored).not.toContain("correct-horse");
    expect(await verifyPassword("correct-horse", stored)).toBe(true);
    expect(await verifyPassword("wrong-horse", stored)).toBe(false);
    expect(await hashPassword("correct-horse")).not.toBe(stored);
  });
});
