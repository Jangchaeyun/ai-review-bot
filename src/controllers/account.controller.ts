/**
 * 회원가입과 로그인. 같은 사용자 이름은 한 번만 만들고, 세션 쿠키로 이후 요청을 확인한다.
 * 실패 메시지에는 입력한 이름이나 비밀번호를 다시 적지 않는다.
 */
import type { Request, Response } from "express";
import { z } from "zod";
import { AppError } from "../utils/app-error.js";
import {
  accountName,
  businessNumberOf,
  companyNameOf,
  departmentOf,
  employeeNumberOf,
  formatBusinessNumber,
  SIGNUP_POSITIONS,
  type AccountStore,
  type AccountUser,
  type PersonProfile,
  type RegisterResult,
} from "../services/account-store.js";
import { hashPassword, verifyPassword } from "../services/password.js";
import {
  clearSessionCookie,
  hashSessionToken,
  newSessionToken,
  readSessionToken,
  SESSION_TTL_MS,
  sessionCookie,
} from "../services/session-cookie.js";

const credentialsSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(1).max(72),
});

const signupSchema = credentialsSchema.extend({
  position: z.enum(SIGNUP_POSITIONS),
  companyName: z.string().min(1).max(40).optional(),
  businessNumber: z.string().min(1).max(20).optional(),
  representative: z.string().min(1).max(40).optional(),
  employeeNumber: z.string().min(1).max(20),
  department: z.string().max(40).optional(),
  inviteCode: z.string().min(1).max(32).optional(),
});

const companyNameSchema = z.object({
  name: z.string().min(1).max(40),
  businessNumber: z.string().min(1).max(20).optional(),
  representative: z.string().min(1).max(40).optional(),
});

const profileSchema = z.object({
  employeeNumber: z.string().min(1).max(20),
  department: z.string().max(40).optional(),
});

export type AccountControllerDeps = {
  accounts: AccountStore;
  now?: () => number;
};

function invalidUsername(): AppError {
  return new AppError({
    message: "사용자 이름은 2자에서 32자 사이여야 합니다. 한글, 영문, 숫자, _, - 만 쓸 수 있습니다.",
    code: "VALIDATION_ERROR",
    statusCode: 400,
    expose: true,
  });
}

function invalidPassword(): AppError {
  return new AppError({
    message: "비밀번호는 8자 이상이어야 합니다.",
    code: "VALIDATION_ERROR",
    statusCode: 400,
    expose: true,
  });
}

function invalidEmployee(): AppError {
  return new AppError({
    message: "사원번호는 1자에서 20자입니다. 한글, 영문, 숫자, 하이픈만 쓸 수 있습니다.",
    code: "VALIDATION_ERROR",
    statusCode: 400,
    expose: true,
  });
}

function invalidDepartment(): AppError {
  return new AppError({
    message: "부서를 목록에서 골라 주세요.",
    code: "VALIDATION_ERROR",
    statusCode: 400,
    expose: true,
  });
}

function invalidCompanyProfile(): AppError {
  return new AppError({
    message: "사업자등록번호 10자리와 대표자 이름을 확인해 주세요.",
    code: "VALIDATION_ERROR",
    statusCode: 400,
    expose: true,
  });
}

function companyForbidden(): AppError {
  return new AppError({
    message: "회사 설정은 관리자만 바꿀 수 있습니다.",
    code: "COMPANY_FORBIDDEN",
    statusCode: 403,
    expose: true,
  });
}

function registerError(result: Exclude<RegisterResult, { status: "created" }>): AppError {
  if (result.status === "duplicate") {
    return new AppError({
      message: "이미 가입한 사용자 이름입니다.",
      code: "USERNAME_TAKEN",
      statusCode: 409,
      expose: true,
    });
  }
  if (result.status === "employee-taken") {
    return new AppError({
      message: "이미 등록된 사원번호입니다.",
      code: "EMPLOYEE_TAKEN",
      statusCode: 409,
      expose: true,
    });
  }
  if (result.status === "company-profile") {
    return invalidCompanyProfile();
  }
  if (result.status === "company-required") {
    return new AppError({
      message: "회사 이름을 입력해 주세요. 2자에서 40자입니다.",
      code: "COMPANY_REQUIRED",
      statusCode: 400,
      expose: true,
    });
  }
  if (result.status === "company-exists") {
    return new AppError({
      message: "이미 회사가 있습니다. 사원으로 가입해 주세요.",
      code: "COMPANY_EXISTS",
      statusCode: 409,
      expose: true,
    });
  }
  if (result.status === "representative-required") {
    return new AppError({
      message: "회사가 아직 없습니다. 회사 대표로 가입해 주세요.",
      code: "REPRESENTATIVE_REQUIRED",
      statusCode: 400,
      expose: true,
    });
  }
  if (result.status === "invite-required") {
    return new AppError({
      message: "초대 코드가 필요합니다.",
      code: "INVITE_REQUIRED",
      statusCode: 400,
      expose: true,
    });
  }
  return new AppError({
    message: "초대 코드가 올바르지 않습니다.",
    code: "INVITE_INVALID",
    statusCode: 401,
    expose: true,
  });
}

function publicUser(user: AccountUser, accounts: AccountStore): {
  username: string;
  role: AccountUser["role"];
  companyName: string;
  position?: AccountUser["position"];
  employeeNumber?: string;
  department?: string;
} {
  const registered = accounts.company()?.registered === true;
  return {
    username: user.username,
    role: user.role,
    companyName: registered ? user.companyName : "",
    ...(user.position === undefined ? {} : { position: user.position }),
    ...(user.employeeNumber === undefined ? {} : { employeeNumber: user.employeeNumber }),
    ...(user.department === undefined ? {} : { department: user.department }),
  };
}

function optionalDepartment(value: string | undefined): { department: string } | { department?: undefined } | undefined {
  if (value === undefined || value.trim() === "") {
    return {};
  }
  const department = departmentOf(value);
  if (department === undefined) {
    return undefined;
  }
  return { department };
}

function personProfile(employeeNumber: string, department: string | undefined): PersonProfile {
  return department === undefined ? { employeeNumber } : { employeeNumber, department };
}

function authFailed(): AppError {
  return new AppError({
    message: "사용자 이름 또는 비밀번호가 올바르지 않습니다.",
    code: "AUTH_FAILED",
    statusCode: 401,
    expose: true,
  });
}

export function currentUser(req: Request, accounts: AccountStore): AccountUser | undefined {
  const token = readSessionToken(req.header("cookie"));
  if (token === undefined) {
    return undefined;
  }
  return accounts.findSession(hashSessionToken(token));
}

function startSession(res: Response, accounts: AccountStore, user: AccountUser, now: number): void {
  const token = newSessionToken();
  accounts.createSession(user.id, hashSessionToken(token), now + SESSION_TTL_MS);
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  res.set("set-cookie", sessionCookie(token, maxAgeSeconds));
  res.set("cache-control", "no-store");
}

export function createAccountController(deps: AccountControllerDeps) {
  const now = (): number => deps.now?.() ?? Date.now();

  return {
    setup(_req: Request, res: Response): void {
      res.status(200).set("cache-control", "no-store").json({
        companyRegistered: deps.accounts.company()?.registered === true,
      });
    },
    async signup(req: Request, res: Response): Promise<void> {
      const body = signupSchema.parse(req.body);
      const name = accountName(body.username);
      if (name === undefined) {
        throw invalidUsername();
      }
      if (body.password.length < 8) {
        throw invalidPassword();
      }
      const employeeNumber = employeeNumberOf(body.employeeNumber);
      if (employeeNumber === undefined) {
        throw invalidEmployee();
      }
      const department = optionalDepartment(body.department);
      if (department === undefined) {
        throw invalidDepartment();
      }
      const companyName = body.companyName === undefined ? undefined : companyNameOf(body.companyName);
      const businessNumber = body.businessNumber === undefined ? undefined : businessNumberOf(body.businessNumber);
      const representative = body.representative === undefined ? undefined : companyNameOf(body.representative);
      if (body.position === "representative") {
        if (companyName === undefined) {
          throw registerError({ status: "company-required" });
        }
        if (businessNumber === undefined || representative === undefined) {
          throw invalidCompanyProfile();
        }
      }
      const passwordHash = await hashPassword(body.password);
      const created = deps.accounts.register({
        username: name.username,
        usernameKey: name.usernameKey,
        passwordHash,
        position: body.position,
        ...personProfile(employeeNumber, department.department),
        ...(body.position === "representative" && companyName !== undefined ? { companyName } : {}),
        ...(body.position === "representative" && businessNumber !== undefined ? { businessNumber } : {}),
        ...(body.position === "representative" && representative !== undefined ? { representative } : {}),
        ...(body.position === "employee" && body.inviteCode !== undefined ? { inviteCode: body.inviteCode } : {}),
      });
      if (created.status !== "created") {
        throw registerError(created);
      }
      startSession(res, deps.accounts, created.user, now());
      res.status(201).json({
        user: publicUser(created.user, deps.accounts),
        ...(created.inviteCode === undefined ? {} : { inviteCode: created.inviteCode }),
      });
    },
    async login(req: Request, res: Response): Promise<void> {
      const body = credentialsSchema.parse(req.body);
      const name = accountName(body.username);
      if (name === undefined || body.password.length < 8) {
        throw authFailed();
      }
      const found = deps.accounts.findByUsernameKey(name.usernameKey);
      if (found === undefined) {
        await hashPassword(body.password);
        throw authFailed();
      }
      const matches = await verifyPassword(body.password, found.passwordHash);
      if (!matches) {
        throw authFailed();
      }
      startSession(res, deps.accounts, found.user, now());
      res.status(200).json({ user: publicUser(found.user, deps.accounts) });
    },
    logout(req: Request, res: Response): void {
      const token = readSessionToken(req.header("cookie"));
      if (token !== undefined) {
        deps.accounts.deleteSession(hashSessionToken(token));
      }
      res.set("set-cookie", clearSessionCookie());
      res.status(204).end();
    },
    me(req: Request, res: Response): void {
      const user = currentUser(req, deps.accounts);
      if (user === undefined) {
        throw new AppError({
          message: "로그인이 필요합니다.",
          code: "AUTH_REQUIRED",
          statusCode: 401,
          expose: true,
        });
      }
      res.status(200).set("cache-control", "no-store").json({ user: publicUser(user, deps.accounts) });
    },
    company(req: Request, res: Response): void {
      const user = currentUser(req, deps.accounts);
      if (user === undefined) {
        throw new AppError({
          message: "로그인이 필요합니다.",
          code: "AUTH_REQUIRED",
          statusCode: 401,
          expose: true,
        });
      }
      const company = deps.accounts.company();
      if (company === undefined) {
        throw new AppError({
          message: "회사 정보를 찾지 못했습니다.",
          code: "COMPANY_MISSING",
          statusCode: 404,
          expose: true,
        });
      }
      const businessNumber = company.registered && company.businessNumber.length === 10
        ? formatBusinessNumber(company.businessNumber)
        : undefined;
      res.status(200).set("cache-control", "no-store").json({
        name: company.registered ? company.name : "",
        registered: company.registered,
        role: user.role,
        ...(user.position === undefined ? {} : { position: user.position }),
        members: deps.accounts.listMembers(),
        ...(businessNumber === undefined ? {} : { businessNumber }),
        ...(company.registered && company.representative.length > 0 ? { representative: company.representative } : {}),
        ...(user.role === "admin" ? { inviteCode: company.inviteCode } : {}),
      });
    },
    rename(req: Request, res: Response): void {
      const user = currentUser(req, deps.accounts);
      if (user === undefined) {
        throw new AppError({
          message: "로그인이 필요합니다.",
          code: "AUTH_REQUIRED",
          statusCode: 401,
          expose: true,
        });
      }
      const body = companyNameSchema.parse(req.body);
      const name = companyNameOf(body.name);
      if (name === undefined) {
        throw registerError({ status: "company-required" });
      }
      if (body.businessNumber !== undefined || body.representative !== undefined) {
        const businessNumber = body.businessNumber === undefined ? undefined : businessNumberOf(body.businessNumber);
        const representative = body.representative === undefined ? undefined : companyNameOf(body.representative);
        if (businessNumber === undefined || representative === undefined) {
          throw invalidCompanyProfile();
        }
        if (!deps.accounts.saveCompanyProfile(user.id, { name, businessNumber, representative })) {
          throw companyForbidden();
        }
        res.status(200).set("cache-control", "no-store").json({
          name,
          businessNumber: formatBusinessNumber(businessNumber),
          representative,
        });
        return;
      }
      if (!deps.accounts.renameCompany(user.id, name)) {
        throw companyForbidden();
      }
      res.status(200).set("cache-control", "no-store").json({ name });
    },
    profile(req: Request, res: Response): void {
      const user = currentUser(req, deps.accounts);
      if (user === undefined) {
        throw new AppError({
          message: "로그인이 필요합니다.",
          code: "AUTH_REQUIRED",
          statusCode: 401,
          expose: true,
        });
      }
      const body = profileSchema.parse(req.body);
      const employeeNumber = employeeNumberOf(body.employeeNumber);
      if (employeeNumber === undefined) {
        throw invalidEmployee();
      }
      const department = optionalDepartment(body.department);
      if (department === undefined) {
        throw invalidDepartment();
      }
      const result = deps.accounts.updateProfile(user.id, personProfile(employeeNumber, department.department));
      if (result === "taken") {
        throw registerError({ status: "employee-taken" });
      }
      if (result === "exists") {
        throw new AppError({
          message: "사원번호는 이미 등록되어 있습니다.",
          code: "PROFILE_EXISTS",
          statusCode: 409,
          expose: true,
        });
      }
      if (result !== "updated") {
        throw new AppError({
          message: "사용자 정보를 찾지 못했습니다.",
          code: "ACCOUNT_MISSING",
          statusCode: 404,
          expose: true,
        });
      }
      const refreshed = currentUser(req, deps.accounts);
      if (refreshed === undefined) {
        throw new AppError({
          message: "사용자 정보를 찾지 못했습니다.",
          code: "ACCOUNT_MISSING",
          statusCode: 404,
          expose: true,
        });
      }
      res.status(200).set("cache-control", "no-store").json({ user: publicUser(refreshed, deps.accounts) });
    },
    rotateInvite(req: Request, res: Response): void {
      const user = currentUser(req, deps.accounts);
      if (user === undefined) {
        throw new AppError({
          message: "로그인이 필요합니다.",
          code: "AUTH_REQUIRED",
          statusCode: 401,
          expose: true,
        });
      }
      const inviteCode = deps.accounts.rotateInvite(user.id);
      if (inviteCode === undefined) {
        throw companyForbidden();
      }
      res.status(200).set("cache-control", "no-store").json({ inviteCode });
    },
  };
}
