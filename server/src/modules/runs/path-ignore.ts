import fs from "node:fs";
import path from "node:path";

export const DEFAULT_IGNORE_PATTERNS = [
  "node_modules/",
  "dist/",
  "build/",
  ".next/",
  ".cache/",
  ".turbo/",
  "coverage/",
  "*.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

function normalizePattern(value: string): string {
  return value.trim().replace(/\\/g, "/");
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function matchDirectoryPattern(filePath: string, pattern: string): boolean {
  const directory = pattern.slice(0, -1);
  return filePath === directory || filePath.startsWith(`${directory}/`) || filePath.includes(`/${directory}/`);
}

function matchBasenamePattern(filePath: string, pattern: string): boolean {
  const basename = path.posix.basename(filePath);
  if (!pattern.startsWith("*")) {
    return basename === pattern;
  }
  const suffix = pattern.slice(1);
  return basename.endsWith(suffix);
}

function matchExactPattern(filePath: string, pattern: string): boolean {
  const basename = path.posix.basename(filePath);
  return filePath === pattern || basename === pattern;
}

export function loadIgnorePatterns(rootPath: string): string[] {
  const gitignorePath = path.join(rootPath, ".gitignore");
  const fromGitignore =
    fs.existsSync(gitignorePath) && fs.statSync(gitignorePath).isFile()
      ? fs
          .readFileSync(gitignorePath, "utf8")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"))
      : [];

  return Array.from(
    new Set(
      [...DEFAULT_IGNORE_PATTERNS, ...fromGitignore]
        .map(normalizePattern)
        .filter(Boolean),
    ),
  );
}

export function shouldIgnoreRelativePath(filePath: string, patterns: string[]): boolean {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return false;
  }

  return patterns.some((pattern) => {
    if (!pattern) {
      return false;
    }
    if (pattern.endsWith("/")) {
      return matchDirectoryPattern(normalized, pattern);
    }
    if (pattern.includes("*")) {
      return matchBasenamePattern(normalized, pattern);
    }
    return matchExactPattern(normalized, pattern);
  });
}

export function filterRelativePaths(filePaths: string[], patterns: string[]): string[] {
  return filePaths.filter((filePath) => !shouldIgnoreRelativePath(filePath, patterns));
}
