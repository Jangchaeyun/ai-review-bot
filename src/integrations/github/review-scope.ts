/**
 * 리뷰할 파일과 건너뛸 파일을 가른다.
 * 바이너리, 생성물, 락파일, vendor, dist, 이미지는 본문을 결과에 넣지 않고 이유만 남긴다.
 */
export const DEFAULT_REVIEW_LIMITS = {
  maxFiles: 20,
  maxFileBytes: 200 * 1024,
  maxDiffBytes: 20 * 1024,
} as const;

export type ReviewLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxDiffBytes: number;
};

export const SKIP_REASONS = [
  "deleted",
  "binary",
  "excluded-path",
  "file-too-large",
  "diff-too-large",
  "diff-unavailable",
  "file-count-exceeded",
  "unsafe-path",
  "invalid-metadata",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

export type GithubFileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

export type GithubChangedFile = {
  path: string;
  previousPath?: string;
  status: GithubFileStatus;
  patch?: string;
  sizeBytes: number | null;
};

export type ReviewableFile = {
  path: string;
  previousPath?: string;
  status: Exclude<GithubFileStatus, "removed">;
  patch: string;
  sizeBytes: number | null;
};

export type SkippedFile = {
  path: string;
  reason: SkipReason;
  sizeBytes?: number;
  diffBytes?: number;
};

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "gemfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
  "pipfile.lock",
]);

const EXCLUDED_DIRECTORIES = new Set(["node_modules", "vendor", "dist", "coverage", "build"]);

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "bmp",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "jar",
  "wasm",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mp4",
  "mp3",
  "ogg",
  "webm",
  "7z",
  "tar",
  "class",
]);

function fileName(path: string): string {
  const parts = path.split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

function extensionOf(path: string): string {
  const name = fileName(path);
  const index = name.lastIndexOf(".");
  if (index <= 0) {
    return "";
  }
  return name.slice(index + 1);
}

function displayPath(path: string): string {
  const cleaned = path.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 1024);
  return cleaned.length > 0 ? cleaned : "[invalid-file]";
}

function isUnsafePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) {
    return true;
  }
  if (/[\u0000-\u001F\u007F]/.test(path) || path.includes("\\")) {
    return true;
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return true;
  }
  return path.split("/").some((part) => part.length === 0 || part === "." || part === "..");
}

function isExcludedPath(path: string): boolean {
  const name = fileName(path);
  if (LOCKFILES.has(name) || name.endsWith(".min.js") || name.endsWith(".min.css") || name.endsWith(".map")) {
    return true;
  }
  if (name.endsWith(".pb.go") || name.endsWith(".generated.ts") || name.endsWith(".generated.js")) {
    return true;
  }
  return path.split("/").some((part) => EXCLUDED_DIRECTORIES.has(part.toLowerCase()));
}

function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(extensionOf(path));
}

function skipped(path: string, reason: SkipReason, extra?: { sizeBytes?: number; diffBytes?: number }): SkippedFile {
  return {
    path: displayPath(path),
    reason,
    ...(extra?.sizeBytes === undefined ? {} : { sizeBytes: extra.sizeBytes }),
    ...(extra?.diffBytes === undefined ? {} : { diffBytes: extra.diffBytes }),
  };
}

export function selectReviewFiles(files: readonly GithubChangedFile[], limits: ReviewLimits): {
  files: ReviewableFile[];
  skipped: SkippedFile[];
} {
  const reviewable: ReviewableFile[] = [];
  const skippedFiles: SkippedFile[] = [];

  for (const file of files) {
    if (isUnsafePath(file.path) || (file.previousPath !== undefined && isUnsafePath(file.previousPath))) {
      skippedFiles.push(skipped(file.path, "unsafe-path"));
      continue;
    }
    if (file.status === "removed") {
      skippedFiles.push(skipped(file.path, "deleted"));
      continue;
    }
    if (isExcludedPath(file.path)) {
      skippedFiles.push(skipped(file.path, "excluded-path"));
      continue;
    }
    if (isBinaryPath(file.path)) {
      skippedFiles.push(skipped(file.path, "binary"));
      continue;
    }
    if (file.sizeBytes !== null && file.sizeBytes > limits.maxFileBytes) {
      skippedFiles.push(skipped(file.path, "file-too-large", { sizeBytes: file.sizeBytes }));
      continue;
    }
    if (file.patch === undefined) {
      skippedFiles.push(skipped(file.path, "diff-unavailable", file.sizeBytes === null ? {} : { sizeBytes: file.sizeBytes }));
      continue;
    }

    const diffBytes = Buffer.byteLength(file.patch, "utf8");
    if (diffBytes > limits.maxDiffBytes) {
      skippedFiles.push(skipped(file.path, "diff-too-large", { diffBytes }));
      continue;
    }
    if (reviewable.length >= limits.maxFiles) {
      skippedFiles.push(skipped(file.path, "file-count-exceeded", file.sizeBytes === null ? {} : { sizeBytes: file.sizeBytes }));
      continue;
    }

    reviewable.push({
      path: file.path,
      ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
      status: file.status,
      patch: file.patch,
      sizeBytes: file.sizeBytes,
    });
  }

  return { files: reviewable, skipped: skippedFiles };
}
