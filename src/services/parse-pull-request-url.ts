/**
 * 콘솔에 넣은 문자열에서 owner, repo, PR 번호를 읽는다.
 * 실패 메시지에는 사용자가 입력한 주소를 다시 적지 않는다.
 */
import { AppError } from "../utils/app-error.js";

const OWNER_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const PULL_NUMBER = /^[1-9]\d{0,9}$/;
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const EXTRA_PATHS = new Set(["files", "commits", "checks"]);

export type PullRequestUrl = {
  owner: string;
  repo: string;
  pullNumber: number;
};

/** 주소 형식 오류다. 사용자가 넣은 주소 원문은 문장에 넣지 않는다. */
function invalidPullRequestUrl(): AppError {
  return new AppError({
    message: "Pull Request 주소를 확인해 주세요. github.com/owner/repo/pull/1 또는 owner/repo#1 형식으로 넣을 수 있습니다.",
    code: "INVALID_PULL_REQUEST_URL",
    statusCode: 400,
    expose: true,
  });
}

/** owner, repo, PR 번호가 각각 허용 형식일 때만 대상 저장소로 만든다. */
function fromParts(owner: string, repo: string, numberText: string): PullRequestUrl {
  if (!OWNER_NAME.test(owner) || !REPO_NAME.test(repo) || repo === "." || repo === ".." || !PULL_NUMBER.test(numberText)) {
    throw invalidPullRequestUrl();
  }
  return {
    owner,
    repo,
    pullNumber: Number(numberText),
  };
}

/** github.com/owner/repo/pull/번호 경로만 읽는다. files, commits, checks 꼬리는 허용한다. */
function fromPath(pathname: string): PullRequestUrl {
  const parts = pathname.split("/").filter((part) => part.length > 0);
  const owner = parts[0];
  const repo = parts[1];
  const marker = parts[2];
  const numberText = parts[3];
  const extra = parts[4];
  if (
    owner === undefined
    || repo === undefined
    || numberText === undefined
    || marker !== "pull"
    || parts.length > 5
    || (extra !== undefined && !EXTRA_PATHS.has(extra))
  ) {
    throw invalidPullRequestUrl();
  }
  return fromParts(owner, repo, numberText);
}

/** 전체 URL, owner/repo/pull/번호, owner/repo#번호 형식을 같은 대상으로 읽는다. */
export function parsePullRequestUrl(value: string): PullRequestUrl {
  const trimmed = value.trim();
  const shorthand = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})#([1-9]\d{0,9})$/.exec(trimmed);
  if (shorthand?.[1] !== undefined && shorthand[2] !== undefined && shorthand[3] !== undefined) {
    return fromParts(shorthand[1], shorthand[2], shorthand[3]);
  }
  const barePath = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})\/pull\/([1-9]\d{0,9})\/?(?:files|commits|checks)?\/?$/.exec(trimmed);
  if (barePath?.[1] !== undefined && barePath[2] !== undefined && barePath[3] !== undefined) {
    return fromParts(barePath[1], barePath[2], barePath[3]);
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw invalidPullRequestUrl();
  }

  const github = (url.protocol === "https:" || url.protocol === "http:")
    && GITHUB_HOSTS.has(url.hostname.toLowerCase())
    && url.username === ""
    && url.password === "";
  if (!github) {
    throw invalidPullRequestUrl();
  }
  return fromPath(url.pathname);
}
