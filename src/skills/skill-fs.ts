import {
  createHash,
} from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { getRuntimeTempDir } from "../core/config";

export interface RemoteSkillFetchInput {
  url: string;
  branch: string;
  subdir: string;
}

export interface RemoteSkillFetchResult {
  directory: string;
  commit: string;
  contentHash?: string;
  cleanup: () => void;
}

export type RemoteSkillFetcher = (input: RemoteSkillFetchInput) => RemoteSkillFetchResult | Promise<RemoteSkillFetchResult>;

function githubRepoFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;
    const parts = parsed.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

export function assertGithubUrl(url: string): string {
  const repo = githubRepoFromUrl(url);
  if (!repo) throw new Error("v1 只支持 https://github.com/<owner>/<repo> 格式的 GitHub 仓库地址。");
  return repo;
}

export function defaultRemoteSkillFetcher(input: RemoteSkillFetchInput): RemoteSkillFetchResult {
  const repo = assertGithubUrl(input.url);
  const runtimeTempDir = getRuntimeTempDir();
  mkdirSync(runtimeTempDir, { recursive: true });
  const tempRoot = mkdtempSync(join(runtimeTempDir, "skill-remote-"));
  const repoDir = join(tempRoot, "repo");
  try {
    execFileSync("git", ["clone", "--depth", "1", "--branch", input.branch, input.url, repoDir], {
      stdio: "pipe",
    });
    const commit = execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    const sourceDir = resolve(repoDir, input.subdir || ".");
    const relativeSource = relative(repoDir, sourceDir);
    if (relativeSource.startsWith("..") || isAbsolute(relativeSource)) {
      throw new Error("远程 skill subdir 不能指向仓库外部。");
    }
    if (!existsSync(sourceDir)) {
      throw new Error(`远程 skill 目录不存在: ${input.subdir || repo}`);
    }
    const contentHash = computeDirectoryHash(sourceDir);
    return {
      directory: sourceDir,
      commit,
      contentHash,
      cleanup: () => rmSync(tempRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export function copyDirectoryExcludingGit(sourceDir: string, targetDir: string): void {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryExcludingGit(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      copyFileSync(sourcePath, targetPath);
      continue;
    }
  }
}

export function replaceDirectoryAtomically(sourceDir: string, targetDir: string): void {
  const parentDir = dirname(targetDir);
  mkdirSync(parentDir, { recursive: true });
  const tempTarget = `${targetDir}.next-${Date.now()}`;
  const backupTarget = `${targetDir}.bak-${Date.now()}`;
  copyDirectoryExcludingGit(sourceDir, tempTarget);
  try {
    if (existsSync(targetDir)) renameSync(targetDir, backupTarget);
    renameSync(tempTarget, targetDir);
    if (existsSync(backupTarget)) rmSync(backupTarget, { recursive: true, force: true });
  } catch (error) {
    rmSync(tempTarget, { recursive: true, force: true });
    if (!existsSync(targetDir) && existsSync(backupTarget)) renameSync(backupTarget, targetDir);
    throw error;
  }
}

export function computeDirectoryHash(directory: string): string {
  const hash = createHash("sha256");
  const files = collectFiles(directory);
  for (const file of files) {
    const relativePath = relative(directory, file).replaceAll("\\", "/");
    hash.update(relativePath);
    hash.update("\n");
    hash.update(readFileSync(file));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function collectFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(target));
      continue;
    }
    if (entry.isFile()) files.push(target);
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}
