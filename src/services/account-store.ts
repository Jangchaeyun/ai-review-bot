/**
 * 콘솔 사용자, 회사, 세션. 프로세스 하나에는 회사가 하나다.
 * 회사 대표는 회사가 없을 때 회사를 등록하고 관리자가 된다.
 * 사원은 등록된 회사의 초대 코드로만 가입하고 구성원이 된다.
 * 부서는 고정 목록에서만 고른다. 비밀번호 원문과 초대 코드는 응답 오류에 남기지 않는다.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const MEMBER_ROLES = ["admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** 가입 때 고르는 구분. representative는 회사 대표, employee는 사원이다. */
export const SIGNUP_POSITIONS = ["representative", "employee"] as const;
export type SignupPosition = (typeof SIGNUP_POSITIONS)[number];

export type AccountUser = {
  id: string;
  username: string;
  role: MemberRole;
  companyName: string;
  position?: SignupPosition;
  employeeNumber?: string;
  department?: string;
};

export type AccountRecord = {
  user: AccountUser;
  passwordHash: string;
};

export const UNREGISTERED_COMPANY_NAME = "기본 조직";

export type CompanySnapshot = {
  name: string;
  inviteCode: string;
  registered: boolean;
  businessNumber: string;
  representative: string;
};

export type CompanyProfile = {
  name: string;
  businessNumber: string;
  representative: string;
};

export type PersonProfile = {
  employeeNumber: string;
  department?: string;
};

export type RegisterInput = {
  username: string;
  usernameKey: string;
  passwordHash: string;
  position: SignupPosition;
  employeeNumber: string;
  department?: string;
  companyName?: string;
  businessNumber?: string;
  representative?: string;
  inviteCode?: string;
};

export type RegisterResult =
  | { status: "created"; user: AccountUser; inviteCode?: string }
  | { status: "duplicate" }
  | { status: "employee-taken" }
  | { status: "company-required" }
  | { status: "company-profile" }
  | { status: "company-exists" }
  | { status: "representative-required" }
  | { status: "invite-required" }
  | { status: "invite-invalid" };

export type ProfileUpdateResult = "updated" | "exists" | "taken" | "missing";

export type AccountMember = {
  username: string;
  role: MemberRole;
  position?: SignupPosition;
  employeeNumber?: string;
  department?: string;
};

export type AccountStore = {
  company(): CompanySnapshot | undefined;
  register(input: RegisterInput): RegisterResult;
  findByUsernameKey(usernameKey: string): AccountRecord | undefined;
  listMembers(): AccountMember[];
  renameCompany(userId: string, name: string): boolean;
  saveCompanyProfile(userId: string, profile: CompanyProfile): boolean;
  updateProfile(userId: string, profile: PersonProfile): ProfileUpdateResult;
  rotateInvite(userId: string): string | undefined;
  createSession(userId: string, tokenHash: string, expiresAt: number): void;
  findSession(tokenHash: string): AccountUser | undefined;
  deleteSession(tokenHash: string): void;
};

const USERNAME_PATTERN = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣_-]{1,31}$/;
const COMPANY_PATTERN = /^[A-Za-z0-9가-힣](?:[A-Za-z0-9가-힣 ._-]*[A-Za-z0-9가-힣])?$/;
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 화면 표시용 이름과 중복 검사에 쓰는 키를 만든다. 키는 대소문자를 구분하지 않는다. */
export function accountName(value: string): { username: string; usernameKey: string } | undefined {
  const username = value.normalize("NFC").trim();
  if (!USERNAME_PATTERN.test(username)) {
    return undefined;
  }
  return { username, usernameKey: username.toLocaleLowerCase("en-US") };
}

/** 회사 이름은 2자에서 40자다. 앞뒤 공백은 버리고 가운데 연속 공백은 하나로 둔다. */
export function companyNameOf(value: string): string | undefined {
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40 || !COMPANY_PATTERN.test(name)) {
    return undefined;
  }
  return name;
}

const BUSINESS_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const;
const EMPLOYEE_PATTERN = /^[A-Za-z0-9가-힣][A-Za-z0-9가-힣-]{0,19}$/;

/** 사업자등록번호는 숫자 10자리다. 하이픈과 공백은 빼고, 끝자리 검증을 통과해야 한다. */
export function businessNumberOf(value: string): string | undefined {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{10}$/.test(digits)) {
    return undefined;
  }
  let sum = 0;
  for (let index = 0; index < BUSINESS_WEIGHTS.length; index += 1) {
    const digit = digits[index];
    const weight = BUSINESS_WEIGHTS[index];
    if (digit === undefined || weight === undefined) {
      return undefined;
    }
    sum += Number(digit) * weight;
  }
  const eighth = digits[8];
  const checkDigit = digits[9];
  if (eighth === undefined || checkDigit === undefined) {
    return undefined;
  }
  sum += Math.floor((Number(eighth) * 5) / 10);
  const expected = (10 - (sum % 10)) % 10;
  if (expected !== Number(checkDigit)) {
    return undefined;
  }
  return digits;
}

/** 저장된 10자리를 화면용 000-00-00000으로 만든다. */
export function formatBusinessNumber(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** 사원번호는 1자에서 20자다. 한글, 영문, 숫자, 하이픈만 허용한다. */
export function employeeNumberOf(value: string): string | undefined {
  const number = value.normalize("NFC").trim();
  if (!EMPLOYEE_PATTERN.test(number)) {
    return undefined;
  }
  return number;
}

export function employeeKey(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

export const DEPARTMENTS = ["개발", "기획", "디자인", "QA", "영업", "마케팅", "인사", "재무", "경영지원", "고객지원", "기타"] as const;

/** 부서는 목록에 있는 이름만 받는다. 비어 있으면 없다. */
export function departmentOf(value: string): string | undefined {
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!DEPARTMENTS.some((department) => department === name)) {
    return undefined;
  }
  return name;
}

function signupPositionOf(value: unknown): SignupPosition | undefined {
  return value === "representative" || value === "employee" ? value : undefined;
}

function personOf(input: PersonProfile): Pick<AccountUser, "employeeNumber" | "department"> {
  return {
    employeeNumber: input.employeeNumber,
    ...(input.department === undefined ? {} : { department: input.department }),
  };
}

function companyProfileOf(input: RegisterInput): CompanyProfile | undefined {
  if (input.companyName === undefined || input.businessNumber === undefined || input.representative === undefined) {
    return undefined;
  }
  return { name: input.companyName, businessNumber: input.businessNumber, representative: input.representative };
}

export function newInviteCode(): string {
  const bytes = randomBytes(10);
  let code = "";
  for (const byte of bytes) {
    code += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
  }
  return code;
}

export function normalizeInviteCode(value: string): string | undefined {
  const code = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-9]{10}$/.test(code)) {
    return undefined;
  }
  return code;
}

function invitesMatch(stored: string, given: string): boolean {
  const normalized = normalizeInviteCode(given);
  if (normalized === undefined) {
    return false;
  }
  const left = Buffer.from(stored);
  const right = Buffer.from(normalized);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

type MemoryUser = AccountRecord & { usernameKey: string };
type MemorySession = { userId: string; expiresAt: number };
type MemoryCompany = CompanySnapshot & { id: string };

export function createMemoryAccountStore(now: () => number = Date.now): AccountStore {
  const users = new Map<string, MemoryUser>();
  const sessions = new Map<string, MemorySession>();
  let company: MemoryCompany | undefined;

  const userById = (userId: string): MemoryUser | undefined => {
    for (const user of users.values()) {
      if (user.user.id === userId) {
        return user;
      }
    }
    return undefined;
  };

  const withCompanyName = (user: AccountUser): AccountUser => {
    if (company === undefined) {
      return user;
    }
    return { ...user, companyName: company.name };
  };

  const employeeTaken = (number: string): boolean => {
    const key = employeeKey(number);
    for (const entry of users.values()) {
      if (entry.user.employeeNumber !== undefined && employeeKey(entry.user.employeeNumber) === key) {
        return true;
      }
    }
    return false;
  };

  const rememberUser = (usernameKey: string, user: AccountUser, passwordHash: string): void => {
    users.set(usernameKey, { user, passwordHash, usernameKey });
  };

  return {
    company() {
      if (company === undefined) {
        return undefined;
      }
      return {
        name: company.name,
        inviteCode: company.inviteCode,
        registered: company.registered,
        businessNumber: company.businessNumber,
        representative: company.representative,
      };
    },
    register(input) {
      const createUser = (role: MemberRole, companyName: string): AccountUser => ({
        id: randomUUID(),
        username: input.username,
        role,
        companyName,
        position: input.position,
        ...personOf(input),
      });
      // 사원은 등록된 회사와 맞는 초대 코드가 있을 때만 구성원으로 만든다.
      if (input.position === "employee") {
        if (company === undefined || !company.registered) {
          return { status: "representative-required" };
        }
        if (input.inviteCode === undefined) {
          return { status: "invite-required" };
        }
        if (!invitesMatch(company.inviteCode, input.inviteCode)) {
          return { status: "invite-invalid" };
        }
        if (users.has(input.usernameKey)) {
          return { status: "duplicate" };
        }
        if (employeeTaken(input.employeeNumber)) {
          return { status: "employee-taken" };
        }
        const user = createUser("member", company.name);
        rememberUser(input.usernameKey, user, input.passwordHash);
        return { status: "created", user };
      }
      // 회사가 이미 등록됐으면 회사 대표 가입은 거절한다. 없는 회사만 관리자로 만든다.
      if (company !== undefined && company.registered) {
        return { status: "company-exists" };
      }
      if (input.companyName === undefined) {
        return { status: "company-required" };
      }
      const profile = companyProfileOf(input);
      if (profile === undefined) {
        return { status: "company-profile" };
      }
      if (company === undefined) {
        if (employeeTaken(input.employeeNumber)) {
          return { status: "employee-taken" };
        }
        company = { id: randomUUID(), inviteCode: newInviteCode(), registered: true, ...profile };
        const user = createUser("admin", company.name);
        rememberUser(input.usernameKey, user, input.passwordHash);
        return { status: "created", user, inviteCode: company.inviteCode };
      }
      if (users.has(input.usernameKey)) {
        return { status: "duplicate" };
      }
      if (employeeTaken(input.employeeNumber)) {
        return { status: "employee-taken" };
      }
      company = { ...company, ...profile, registered: true };
      const user = createUser("member", company.name);
      rememberUser(input.usernameKey, user, input.passwordHash);
      return { status: "created", user };
    },
    findByUsernameKey(usernameKey) {
      const found = users.get(usernameKey);
      if (found === undefined || company === undefined) {
        return undefined;
      }
      return { user: withCompanyName(found.user), passwordHash: found.passwordHash };
    },
    listMembers() {
      return [...users.values()]
        .map((entry) => ({
          username: entry.user.username,
          role: entry.user.role,
          ...(entry.user.position === undefined ? {} : { position: entry.user.position }),
          ...(entry.user.employeeNumber === undefined ? {} : { employeeNumber: entry.user.employeeNumber }),
          ...(entry.user.department === undefined ? {} : { department: entry.user.department }),
        }))
        .sort((left, right) => {
          if (left.role !== right.role) {
            return left.role === "admin" ? -1 : 1;
          }
          return left.username.localeCompare(right.username);
        });
    },
    renameCompany(userId, name) {
      const user = userById(userId);
      if (user === undefined || user.user.role !== "admin" || company === undefined) {
        return false;
      }
      company = { ...company, name, registered: true };
      return true;
    },
    saveCompanyProfile(userId, profile) {
      const user = userById(userId);
      if (user === undefined || user.user.role !== "admin" || company === undefined) {
        return false;
      }
      company = { ...company, ...profile, registered: true };
      return true;
    },
    updateProfile(userId, profile) {
      const user = userById(userId);
      if (user === undefined) {
        return "missing";
      }
      if (user.user.employeeNumber !== undefined) {
        return "exists";
      }
      if (employeeTaken(profile.employeeNumber)) {
        return "taken";
      }
      user.user = { ...user.user, ...personOf(profile) };
      return "updated";
    },
    rotateInvite(userId) {
      const user = userById(userId);
      if (user === undefined || user.user.role !== "admin" || company === undefined) {
        return undefined;
      }
      const inviteCode = newInviteCode();
      company = { ...company, inviteCode };
      return inviteCode;
    },
    createSession(userId, tokenHash, expiresAt) {
      sessions.set(tokenHash, { userId, expiresAt });
    },
    findSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (session === undefined) {
        return undefined;
      }
      if (session.expiresAt <= now()) {
        sessions.delete(tokenHash);
        return undefined;
      }
      const user = userById(session.userId);
      return user === undefined ? undefined : withCompanyName(user.user);
    },
    deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
  };
}

function registerFailure(error: unknown): "duplicate" | "employee-taken" | "company-exists" | undefined {
  if (!isUniqueViolation(error)) {
    return undefined;
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("employee_key")) {
    return "employee-taken";
  }
  if (message.includes("username_key")) {
    return "duplicate";
  }
  return "company-exists";
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const code = "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code.includes("SQLITE_CONSTRAINT") || message.includes("UNIQUE constraint failed");
}

function addColumn(db: DatabaseSync, statement: string): void {
  try {
    db.exec(statement);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("duplicate column name")) {
      throw error;
    }
  }
}

function readAccountUser(row: unknown): AccountUser | undefined {
  if (typeof row !== "object" || row === null) {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  const id = record.id;
  const username = record.username;
  const role = record.role;
  const companyName = record.company_name;
  if (typeof id !== "string" || typeof username !== "string" || typeof companyName !== "string") {
    return undefined;
  }
  if (role !== "admin" && role !== "member") {
    return undefined;
  }
  if (id.length === 0 || username.length === 0 || username.length > 32 || companyName.length < 2 || companyName.length > 40) {
    return undefined;
  }
  const employeeNumber = typeof record.employee_number === "string" ? employeeNumberOf(record.employee_number) : undefined;
  const department = typeof record.department === "string" ? departmentOf(record.department) : undefined;
  const position = signupPositionOf(record.position);
  return {
    id,
    username,
    role,
    companyName,
    ...(position === undefined ? {} : { position }),
    ...(employeeNumber === undefined ? {} : { employeeNumber }),
    ...(department === undefined ? {} : { department }),
  };
}

function readUserRow(row: unknown): AccountRecord | undefined {
  const user = readAccountUser(row);
  if (user === undefined || typeof row !== "object" || row === null) {
    return undefined;
  }
  const passwordHash = (row as Record<string, unknown>).password_hash;
  if (typeof passwordHash !== "string" || passwordHash.length === 0 || passwordHash.length > 256) {
    return undefined;
  }
  return { user, passwordHash };
}

function readCompany(row: unknown): CompanySnapshot & { id: string } | undefined {
  if (typeof row !== "object" || row === null) {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  const id = record.id;
  const name = record.name;
  const inviteCode = record.invite_code;
  const registered = record.registered === 1 || record.registered === true;
  if (typeof id !== "string" || typeof name !== "string" || typeof inviteCode !== "string") {
    return undefined;
  }
  if (name.length < 2 || name.length > 40 || inviteCode.length !== 10) {
    return undefined;
  }
  const businessNumber = typeof record.business_number === "string" && businessNumberOf(record.business_number) !== undefined
    ? record.business_number
    : "";
  const representative = typeof record.representative === "string" ? record.representative : "";
  return { id, name, inviteCode, registered, businessNumber, representative };
}

function countOf(row: unknown): number {
  if (typeof row !== "object" || row === null || !("count" in row)) {
    return 0;
  }
  const count = row.count;
  return typeof count === "number" || typeof count === "bigint" ? Number(count) : 0;
}

/** 같은 SQLite 연결에 회사, 사용자, 세션 표를 만든다. 파일은 리뷰 상태와 함께 연다. */
export function createSqliteAccountStore(db: DatabaseSync, now: () => number = Date.now): AccountStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      username_key TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      invite_code TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      singleton INTEGER NOT NULL UNIQUE DEFAULT 1
    );
  `);
  addColumn(db, "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  addColumn(db, "ALTER TABLE users ADD COLUMN company_id TEXT");

  addColumn(db, "ALTER TABLE companies ADD COLUMN registered INTEGER NOT NULL DEFAULT 0");
  addColumn(db, "ALTER TABLE companies ADD COLUMN business_number TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE companies ADD COLUMN representative TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE users ADD COLUMN employee_number TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE users ADD COLUMN employee_key TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE users ADD COLUMN department TEXT NOT NULL DEFAULT ''");
  addColumn(db, "ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_employee_key ON users(employee_key) WHERE employee_key <> ''");
  const selectCompany = db.prepare(
    "SELECT id, name, invite_code, registered, business_number, representative FROM companies LIMIT 1",
  );
  const insertCompany = db.prepare(
    "INSERT INTO companies (id, name, invite_code, created_at, singleton, registered, business_number, representative) VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
  );
  const countUsers = db.prepare("SELECT COUNT(*) AS count FROM users");
  const selectFirstUser = db.prepare("SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1");
  const attachAdmin = db.prepare("UPDATE users SET company_id = ?, role = 'admin' WHERE id = ?");
  const attachMembers = db.prepare("UPDATE users SET company_id = ? WHERE company_id IS NULL");
  const insertUser = db.prepare(
    `INSERT INTO users (
      id, username, username_key, password_hash, created_at, role, company_id,
      employee_number, employee_key, department, position
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const userColumns = `
    users.id AS id, users.username AS username, users.role AS role, users.position AS position,
    users.employee_number AS employee_number, users.department AS department, companies.name AS company_name
  `;
  const selectUser = db.prepare(`
    SELECT ${userColumns}, users.password_hash AS password_hash
    FROM users JOIN companies ON companies.id = users.company_id
    WHERE users.username_key = ?
  `);
  const selectUserById = db.prepare(`
    SELECT ${userColumns}
    FROM users JOIN companies ON companies.id = users.company_id
    WHERE users.id = ?
  `);
  const selectEmployee = db.prepare("SELECT id FROM users WHERE employee_key = ? AND employee_key <> ''");
  const selectMembers = db.prepare(`
    SELECT username, role, position, employee_number, department FROM users WHERE company_id = ? ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, username COLLATE NOCASE
  `);
  const updateCompanyName = db.prepare("UPDATE companies SET name = ?, registered = 1 WHERE id = ?");
  const updateCompanyProfile = db.prepare(
    "UPDATE companies SET name = ?, business_number = ?, representative = ?, registered = 1 WHERE id = ?",
  );
  const updatePerson = db.prepare(
    "UPDATE users SET employee_number = ?, employee_key = ?, department = ? WHERE id = ? AND employee_number = ''",
  );
  const updateInvite = db.prepare("UPDATE companies SET invite_code = ? WHERE id = ?");
  const insertSession = db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)");
  const selectSession = db.prepare(`
    SELECT users.id AS id, users.username AS username, users.role AS role, users.position AS position,
      users.employee_number AS employee_number, users.department AS department, companies.name AS company_name
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    JOIN companies ON companies.id = users.company_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `);
  const deleteSessionStmt = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
  const deleteExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

  if (readCompany(selectCompany.get()) === undefined && countOf(countUsers.get()) > 0) {
    const first = selectFirstUser.get();
    const firstId = typeof first === "object" && first !== null && "id" in first && typeof first.id === "string" ? first.id : undefined;
    if (firstId !== undefined) {
      const companyId = randomUUID();
      insertCompany.run(companyId, UNREGISTERED_COMPANY_NAME, newInviteCode(), now(), 0, "", "");
      attachAdmin.run(companyId, firstId);
      attachMembers.run(companyId);
    }
  }

  const currentCompany = (): (CompanySnapshot & { id: string }) | undefined => readCompany(selectCompany.get());

  return {
    company() {
      const found = currentCompany();
      if (found === undefined) {
        return undefined;
      }
      return {
        name: found.name,
        inviteCode: found.inviteCode,
        registered: found.registered,
        businessNumber: found.businessNumber,
        representative: found.representative,
      };
    },
    register(input) {
      const employeeExists = (): boolean => selectEmployee.get(employeeKey(input.employeeNumber)) !== undefined;
      const writeUser = (role: MemberRole, companyId: string): void => {
        insertUser.run(
          randomUUID(),
          input.username,
          input.usernameKey,
          input.passwordHash,
          now(),
          role,
          companyId,
          input.employeeNumber,
          employeeKey(input.employeeNumber),
          input.department ?? "",
          input.position,
        );
      };
      const readCreated = (): AccountUser => {
        const created = readUserRow(selectUser.get(input.usernameKey));
        if (created === undefined) {
          throw new Error("user insert was not readable");
        }
        return created.user;
      };
      const existing = currentCompany();
      // 사원은 등록된 회사와 맞는 초대 코드가 있을 때만 구성원으로 만든다.
      if (input.position === "employee") {
        if (existing === undefined || !existing.registered) {
          return { status: "representative-required" };
        }
        if (input.inviteCode === undefined) {
          return { status: "invite-required" };
        }
        if (!invitesMatch(existing.inviteCode, input.inviteCode)) {
          return { status: "invite-invalid" };
        }
        if (selectUser.get(input.usernameKey) !== undefined) {
          return { status: "duplicate" };
        }
        if (employeeExists()) {
          return { status: "employee-taken" };
        }
        try {
          writeUser("member", existing.id);
        } catch (error) {
          const failure = registerFailure(error);
          if (failure !== undefined) {
            return { status: failure === "company-exists" ? "duplicate" : failure };
          }
          throw error;
        }
        return { status: "created", user: readCreated() };
      }
      // 회사가 이미 등록됐으면 회사 대표 가입은 거절한다. 없는 회사만 관리자로 만든다.
      if (existing !== undefined && existing.registered) {
        return { status: "company-exists" };
      }
      if (input.companyName === undefined) {
        return { status: "company-required" };
      }
      const profile = companyProfileOf(input);
      if (profile === undefined) {
        return { status: "company-profile" };
      }
      if (existing === undefined) {
        const companyId = randomUUID();
        const inviteCode = newInviteCode();
        db.exec("BEGIN IMMEDIATE");
        try {
          if (currentCompany() !== undefined) {
            db.exec("ROLLBACK");
            return { status: "company-exists" };
          }
          if (employeeExists()) {
            db.exec("ROLLBACK");
            return { status: "employee-taken" };
          }
          insertCompany.run(companyId, profile.name, inviteCode, now(), 1, profile.businessNumber, profile.representative);
          writeUser("admin", companyId);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          const failure = registerFailure(error);
          if (failure !== undefined) {
            return { status: failure === "company-exists" && currentCompany() === undefined ? "duplicate" : failure };
          }
          throw error;
        }
        return { status: "created", user: readCreated(), inviteCode };
      }
      if (selectUser.get(input.usernameKey) !== undefined) {
        return { status: "duplicate" };
      }
      if (employeeExists()) {
        return { status: "employee-taken" };
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = currentCompany();
        if (current === undefined || current.registered) {
          db.exec("ROLLBACK");
          return { status: "company-exists" };
        }
        updateCompanyProfile.run(profile.name, profile.businessNumber, profile.representative, current.id);
        writeUser("member", current.id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        const failure = registerFailure(error);
        if (failure !== undefined) {
          return { status: failure };
        }
        throw error;
      }
      return { status: "created", user: readCreated() };
    },
    findByUsernameKey(usernameKey) {
      return readUserRow(selectUser.get(usernameKey));
    },
    listMembers() {
      const found = currentCompany();
      if (found === undefined) {
        return [];
      }
      const rows = selectMembers.all(found.id);
      const members: AccountMember[] = [];
      for (const row of rows) {
        if (typeof row !== "object" || row === null) {
          continue;
        }
        const record = row as Record<string, unknown>;
        if ((record.role === "admin" || record.role === "member") && typeof record.username === "string") {
          const employeeNumber = typeof record.employee_number === "string" ? employeeNumberOf(record.employee_number) : undefined;
          const department = typeof record.department === "string" ? departmentOf(record.department) : undefined;
          const position = signupPositionOf(record.position);
          members.push({
            username: record.username,
            role: record.role,
            ...(position === undefined ? {} : { position }),
            ...(employeeNumber === undefined ? {} : { employeeNumber }),
            ...(department === undefined ? {} : { department }),
          });
        }
      }
      return members;
    },
    renameCompany(userId, name) {
      const user = readAccountUser(selectUserById.get(userId));
      const found = currentCompany();
      if (user === undefined || user.role !== "admin" || found === undefined) {
        return false;
      }
      updateCompanyName.run(name, found.id);
      return true;
    },
    saveCompanyProfile(userId, profile) {
      const user = readAccountUser(selectUserById.get(userId));
      const found = currentCompany();
      if (user === undefined || user.role !== "admin" || found === undefined) {
        return false;
      }
      updateCompanyProfile.run(profile.name, profile.businessNumber, profile.representative, found.id);
      return true;
    },
    updateProfile(userId, profile) {
      const user = readAccountUser(selectUserById.get(userId));
      if (user === undefined) {
        return "missing";
      }
      if (user.employeeNumber !== undefined) {
        return "exists";
      }
      if (selectEmployee.get(employeeKey(profile.employeeNumber)) !== undefined) {
        return "taken";
      }
      try {
        const result = updatePerson.run(profile.employeeNumber, employeeKey(profile.employeeNumber), profile.department ?? "", userId);
        return result.changes === 0 ? "exists" : "updated";
      } catch (error) {
        if (registerFailure(error) === "employee-taken") {
          return "taken";
        }
        throw error;
      }
    },
    rotateInvite(userId) {
      const user = readAccountUser(selectUserById.get(userId));
      const found = currentCompany();
      if (user === undefined || user.role !== "admin" || found === undefined) {
        return undefined;
      }
      const inviteCode = newInviteCode();
      updateInvite.run(inviteCode, found.id);
      return inviteCode;
    },
    createSession(userId, tokenHash, expiresAt) {
      deleteExpired.run(now());
      insertSession.run(tokenHash, userId, expiresAt);
    },
    findSession(tokenHash) {
      return readAccountUser(selectSession.get(tokenHash, now()));
    },
    deleteSession(tokenHash) {
      deleteSessionStmt.run(tokenHash);
    },
  };
}
