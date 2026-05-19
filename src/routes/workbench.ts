import { resolve } from "path";
import { Hono } from "hono";

const PROJECT_ROOT = resolve(import.meta.dir, "..", "..");
const MAIN_BRANCH = "main";
const DEFAULT_MAX_DIFF_LINES = 500;
const MAX_DIFF_LINES = 5_000;

interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface WorkbenchBranch {
  name: string;
  subject: string;
  baseCommit: string;
  headCommit: string;
  createdAt: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  dependencies: string[];
}

export function createWorkbenchRoutes(): Hono {
  const app = new Hono();

  app.get("/branches", async (c) => {
    try {
      return c.json({ branches: await listWorkbenchBranches() });
    } catch (error) {
      return c.json({ error: errorMessage(error, "读取本地分支失败") }, 500);
    }
  });

  app.get("/branches/:name/diff", async (c) => {
    const branchName = c.req.param("name");
    const maxLines = normalizeMaxLines(c.req.query("maxLines"));

    try {
      await assertLocalBranch(branchName);
      const diff = await git(["diff", `${MAIN_BRANCH}...${branchName}`], { expectSuccess: true });
      const lines = diff.stdout.split("\n");
      const truncated = lines.length > maxLines;
      return c.json({
        branch: branchName,
        diff: truncated ? lines.slice(0, maxLines).join("\n") : diff.stdout,
        truncated,
        maxLines,
        totalLines: lines.length,
      });
    } catch (error) {
      return c.json({ error: errorMessage(error, "读取 diff 失败") }, 400);
    }
  });

  app.post("/branches/:name/merge", async (c) => {
    try {
      const result = await mergeBranch(c.req.param("name"));
      return c.json({ merged: [result.branch], outputs: [result] });
    } catch (error) {
      return c.json({ error: errorMessage(error, "合并分支失败") }, conflictStatus(error));
    }
  });

  app.post("/branches/:name/discard", async (c) => {
    const branchName = c.req.param("name");
    const body = await c.req.json().catch(() => ({})) as { confirmed?: boolean };
    if (body.confirmed !== true) {
      return c.json({ error: "丢弃分支必须传 confirmed: true。" }, 400);
    }

    try {
      await assertLocalBranch(branchName);
      if (branchName === MAIN_BRANCH) throw new Error("不能丢弃 main 分支。");
      await switchToMain();
      const result = await git(["branch", "-D", branchName], { expectSuccess: true });
      return c.json({ discarded: branchName, output: result.stdout.trim() || result.stderr.trim() });
    } catch (error) {
      return c.json({ error: errorMessage(error, "丢弃分支失败") }, 400);
    }
  });

  app.post("/branches/:name/merge-with-deps", async (c) => {
    const branchName = c.req.param("name");

    try {
      const branches = await listWorkbenchBranches();
      const mergeOrder = resolveDependencyOrder(branchName, branches);
      const outputs = [];
      for (const name of mergeOrder) {
        outputs.push(await mergeBranch(name));
      }
      return c.json({ merged: mergeOrder, outputs });
    } catch (error) {
      return c.json({ error: errorMessage(error, "合并分支依赖失败") }, conflictStatus(error));
    }
  });

  return app;
}

async function listWorkbenchBranches(): Promise<WorkbenchBranch[]> {
  await assertMainExists();
  const mainHead = await gitStdout(["rev-parse", MAIN_BRANCH]);
  const rawBranches = await gitStdout([
    "branch",
    "--format=%(refname:short)%00%(objectname)%00%(committerdate:iso8601)",
    "--no-merged",
    MAIN_BRANCH,
  ]);
  const branchRows = rawBranches
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", headCommit = "", createdAt = ""] = line.split("\0");
      return { name, headCommit, createdAt };
    })
    .filter((branch) => branch.name && branch.name !== MAIN_BRANCH);

  const allHeads = await listLocalBranchHeads();
  const branches = await Promise.all(branchRows.map(async (branch) => {
    const [baseCommit, subject, stats] = await Promise.all([
      gitStdout(["merge-base", MAIN_BRANCH, branch.name]),
      gitStdout(["log", "--format=%B", `${MAIN_BRANCH}..${branch.name}`]).then((s) => s.trim()),
      getDiffStats(branch.name),
    ]);
    return {
      name: branch.name,
      subject,
      baseCommit,
      headCommit: branch.headCommit,
      createdAt: branch.createdAt,
      changedFiles: stats.changedFiles,
      additions: stats.additions,
      deletions: stats.deletions,
      dependencies: detectDependencies(baseCommit, mainHead, branch.name, allHeads),
    };
  }));

  return branches.map((branch) => ({
    ...branch,
    baseCommit: shortHash(branch.baseCommit),
    headCommit: shortHash(branch.headCommit),
  }));
}

async function listLocalBranchHeads(): Promise<Map<string, string>> {
  const output = await gitStdout(["for-each-ref", "--format=%(refname:short)%00%(objectname)", "refs/heads"]);
  const heads = new Map<string, string>();
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [name, head] = line.split("\0");
    if (name && head) heads.set(name, head);
  }
  return heads;
}

async function getDiffStats(branchName: string): Promise<{ changedFiles: number; additions: number; deletions: number }> {
  const output = await gitStdout(["diff", "--numstat", `${MAIN_BRANCH}...${branchName}`]);
  let changedFiles = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [added, removed] = line.split("\t");
    changedFiles += 1;
    additions += parseNumstat(added);
    deletions += parseNumstat(removed);
  }
  return { changedFiles, additions, deletions };
}

function detectDependencies(
  baseCommit: string,
  mainHead: string,
  branchName: string,
  allHeads: Map<string, string>,
): string[] {
  if (baseCommit === mainHead) return [];
  const dependencies: string[] = [];
  for (const [name, headCommit] of allHeads) {
    if (name !== branchName && name !== MAIN_BRANCH && headCommit === baseCommit) {
      dependencies.push(name);
    }
  }
  return dependencies.sort();
}

function resolveDependencyOrder(targetBranch: string, branches: WorkbenchBranch[]): string[] {
  const byName = new Map(branches.map((branch) => [branch.name, branch]));
  if (!byName.has(targetBranch)) throw new Error(`分支不存在或已合并: ${targetBranch}`);
  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(branchName: string) {
    if (visited.has(branchName)) return;
    if (visiting.has(branchName)) throw new Error(`检测到循环依赖: ${branchName}`);
    const branch = byName.get(branchName);
    if (!branch) throw new Error(`依赖分支不存在或已合并: ${branchName}`);
    visiting.add(branchName);
    for (const dependency of branch.dependencies) visit(dependency);
    visiting.delete(branchName);
    visited.add(branchName);
    order.push(branchName);
  }

  visit(targetBranch);
  return order;
}

async function mergeBranch(branchName: string): Promise<{ branch: string; mode: "fast-forward" | "merge"; output: string }> {
  await assertLocalBranch(branchName);
  if (branchName === MAIN_BRANCH) throw new Error("不能合并 main 到自己。");
  await switchToMain();

  const fastForward = await git(["merge", "--ff-only", branchName]);
  if (fastForward.exitCode === 0) {
    return { branch: branchName, mode: "fast-forward", output: mergeOutput(fastForward) };
  }

  const merged = await git(["merge", "--no-edit", branchName]);
  if (merged.exitCode === 0) {
    return { branch: branchName, mode: "merge", output: mergeOutput(merged) };
  }

  await abortMergeIfNeeded();
  throw new WorkbenchConflictError(mergeOutput(merged) || "合并冲突，已中止本次 merge。");
}

async function switchToMain(): Promise<void> {
  await git(["switch", MAIN_BRANCH], { expectSuccess: true });
}

async function abortMergeIfNeeded(): Promise<void> {
  const mergeHead = await git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  if (mergeHead.exitCode === 0) {
    await git(["merge", "--abort"]);
  }
}

async function assertMainExists(): Promise<void> {
  await git(["rev-parse", "--verify", MAIN_BRANCH], { expectSuccess: true });
}

async function assertLocalBranch(branchName: string): Promise<void> {
  if (!branchName || branchName.includes("\0")) throw new Error("分支名无效。");
  await git(["rev-parse", "--verify", `refs/heads/${branchName}`], { expectSuccess: true });
}

async function gitStdout(args: string[]): Promise<string> {
  const result = await git(args, { expectSuccess: true });
  return result.stdout.trim();
}

async function git(args: string[], options: { expectSuccess?: boolean } = {}): Promise<GitResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const result = { exitCode, stdout, stderr };
  if (options.expectSuccess && exitCode !== 0) {
    throw new Error(mergeOutput(result) || `git ${args.join(" ")} 执行失败`);
  }
  return result;
}

function normalizeMaxLines(raw: string | undefined): number {
  if (!raw) return DEFAULT_MAX_DIFF_LINES;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_DIFF_LINES;
  return Math.min(parsed, MAX_DIFF_LINES);
}

function parseNumstat(value: string | undefined): number {
  if (!value || value === "-") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortHash(hash: string): string {
  return hash.trim().slice(0, 7);
}

function mergeOutput(result: GitResult): string {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function conflictStatus(error: unknown): 400 | 409 {
  return error instanceof WorkbenchConflictError ? 409 : 400;
}

class WorkbenchConflictError extends Error {}
