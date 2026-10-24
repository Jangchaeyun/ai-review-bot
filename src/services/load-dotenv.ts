/**
 * .env 파일을 직접 읽는다. 이미 프로세스에 있는 키는 덮어쓰지 않고, dotenv 패키지는 쓰지 않는다.
 */
import { readFileSync } from "node:fs";

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** .env가 없으면 넘어가고, 이미 설정된 환경변수는 파일 값으로 바꾸지 않는다. */
export function loadDotEnv(path = ".env"): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (!ENV_KEY.test(key) || process.env[key] !== undefined) {
      continue;
    }
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2)
      || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
