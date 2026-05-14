import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type GatewayCommand = "start" | "stop" | "restart" | "status" | "logs" | "help";
type GatewayState = "running" | "stopped" | "unhealthy";

export interface GatewayCliOptions {
  command: GatewayCommand;
  port: number;
  lines: number;
  follow: boolean;
  help: boolean;
}

export interface GatewayPaths {
  projectRoot: string;
  runtimeDir: string;
  pidPath: string;
  statePath: string;
  logPath: string;
  dataDir: string;
}

export interface HealthResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface GatewayStatus {
  state: GatewayState;
  pid: number | null;
  pidAlive: boolean;
  health: HealthResult;
  port: number;
  healthUrl: string;
  managed: boolean;
}

interface GatewayRuntime {
  isProcessAlive(pid: number): boolean;
  killProcess(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<void>;
  healthCheck(url: string): Promise<HealthResult>;
}

interface GatewayStartOptions {
  paths: GatewayPaths;
  port: number;
  runtime?: GatewayRuntime;
  out?: Pick<Console, "log" | "error">;
}

interface GatewayStopOptions {
  paths: GatewayPaths;
  port: number;
  runtime?: GatewayRuntime;
  out?: Pick<Console, "log" | "error">;
}

const DEFAULT_PORT = 3100;
const DEFAULT_LOG_LINES = 100;
const STOP_TIMEOUT_MS = 5000;
const START_TIMEOUT_MS = 10000;

export function getProjectRoot(): string {
  const meta = import.meta as unknown as { dir?: string };
  return resolve(meta.dir ?? process.cwd(), "../..");
}

export function resolveGatewayPaths(projectRoot = getProjectRoot()): GatewayPaths {
  const runtimeDir = resolve(projectRoot, ".runtime");
  return {
    projectRoot,
    runtimeDir,
    pidPath: resolve(runtimeDir, "my-agent.pid"),
    statePath: resolve(runtimeDir, "my-agent.gateway.json"),
    logPath: resolve(runtimeDir, "my-agent.log"),
    dataDir: resolve(process.env.MY_AGENT_DATA_DIR ?? resolve(projectRoot, "data")),
  };
}

export function parsePort(raw: string | undefined, fallback = DEFAULT_PORT): number {
  const value = raw?.trim() ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`端口非法: ${raw ?? fallback}`);
  }
  return value;
}

export function parseGatewayArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): GatewayCliOptions {
  let command: GatewayCommand | null = null;
  let portRaw: string | undefined;
  let lines = DEFAULT_LOG_LINES;
  let follow = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      command = command ?? "help";
      continue;
    }
    if (arg === "--follow" || arg === "-f") {
      follow = true;
      continue;
    }
    if (arg === "--port") {
      portRaw = argv[index + 1];
      if (!portRaw) throw new Error("--port 缺少端口值");
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      portRaw = arg.slice("--port=".length);
      continue;
    }
    if (arg === "--lines") {
      if (!argv[index + 1]) throw new Error("--lines 缺少行数");
      lines = parsePositiveInteger(argv[index + 1], "--lines");
      index += 1;
      continue;
    }
    if (arg.startsWith("--lines=")) {
      lines = parsePositiveInteger(arg.slice("--lines=".length), "--lines");
      continue;
    }
    if (!command) {
      if (isGatewayCommand(arg)) {
        command = arg;
        continue;
      }
      throw new Error(`未知 gateway 命令: ${arg}`);
    }
    throw new Error(`未知 gateway 参数: ${arg}`);
  }

  return {
    command: command ?? "help",
    port: parsePort(portRaw ?? env.PORT, DEFAULT_PORT),
    lines,
    follow,
    help,
  };
}

function parsePositiveInteger(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} 必须是正整数`);
  }
  return value;
}

function isGatewayCommand(value: string): value is GatewayCommand {
  return ["start", "stop", "restart", "status", "logs", "help"].includes(value);
}

export function readPidFile(pidPath: string): number | null {
  if (!existsSync(pidPath)) return null;
  const raw = readFileSync(pidPath, "utf-8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

export async function checkHealth(url: string, timeoutMs = 1000): Promise<HealthResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch {
    return {
      ok: false,
      error: "无法连接服务，请确认服务是否已启动、端口是否正确。",
    };
  } finally {
    clearTimeout(timeout);
  }
}

const defaultRuntime: GatewayRuntime = {
  isProcessAlive,
  killProcess(pid, signal) {
    process.kill(pid, signal);
  },
  sleep(ms) {
    return Bun.sleep(ms);
  },
  healthCheck: checkHealth,
};

export async function readGatewayStatus(
  paths: GatewayPaths,
  port: number,
  runtime: GatewayRuntime = defaultRuntime,
): Promise<GatewayStatus> {
  const pid = readPidFile(paths.pidPath);
  const pidAlive = pid ? runtime.isProcessAlive(pid) : false;
  if (pid && !pidAlive) {
    removeIfExists(paths.pidPath);
    removeIfExists(paths.statePath);
  }

  const healthUrl = `http://localhost:${port}/api/health`;
  const health = await runtime.healthCheck(healthUrl);
  const managed = Boolean(pid && pidAlive);
  const state: GatewayState = health.ok
    ? "running"
    : managed
      ? "unhealthy"
      : "stopped";

  return {
    state,
    pid: pidAlive ? pid : null,
    pidAlive,
    health,
    port,
    healthUrl,
    managed,
  };
}

export async function startGateway(options: GatewayStartOptions): Promise<number | null> {
  const runtime = options.runtime ?? defaultRuntime;
  const out = options.out ?? console;
  const status = await readGatewayStatus(options.paths, options.port, runtime);

  if (status.state === "running") {
    out.log(status.managed
      ? `网关已在运行，进程号(PID) ${status.pid}，端口 ${status.port}`
      : `端口 ${status.port} 已有健康服务响应，但不是当前进程号文件管理的进程`);
    return status.pid;
  }

  if (status.state === "unhealthy" && status.pid) {
    out.error(`网关进程存在但健康检查失败，进程号(PID) ${status.pid}，日志: ${options.paths.logPath}`);
    return null;
  }

  mkdirSync(options.paths.runtimeDir, { recursive: true });
  const logFd = openSync(options.paths.logPath, "a");
  let pid: number;
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "run", "src/main.ts"],
      cwd: options.paths.projectRoot,
      env: { ...process.env, PORT: String(options.port) },
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    pid = child.pid;
  } finally {
    closeSync(logFd);
  }

  writeFileSync(options.paths.pidPath, `${pid}\n`, "utf-8");
  writeFileSync(
    options.paths.statePath,
    JSON.stringify(
      {
        pid,
        port: options.port,
        startedAt: new Date().toISOString(),
        command: "bun run src/main.ts",
      },
      null,
      2,
    ),
    "utf-8",
  );

  const ready = await waitForHealthy(options.paths, options.port, runtime, START_TIMEOUT_MS);
  if (!ready) {
    out.error(`网关已启动但健康检查未通过，进程号(PID) ${pid}，日志: ${options.paths.logPath}`);
    return null;
  }

  out.log(`网关已启动，进程号(PID) ${pid}，地址 http://localhost:${options.port}`);
  out.log(`日志: ${options.paths.logPath}`);
  return pid;
}

export async function stopGateway(options: GatewayStopOptions): Promise<boolean> {
  const runtime = options.runtime ?? defaultRuntime;
  const out = options.out ?? console;
  const pid = readPidFile(options.paths.pidPath);

  if (!pid) {
    out.log("网关未运行。");
    removeIfExists(options.paths.statePath);
    return true;
  }

  if (!runtime.isProcessAlive(pid)) {
    removeIfExists(options.paths.pidPath);
    removeIfExists(options.paths.statePath);
    out.log("网关进程号(PID)文件已过期，已清理。");
    return true;
  }

  runtime.killProcess(pid, "SIGTERM");
  const stopped = await waitForExit(pid, runtime, STOP_TIMEOUT_MS);
  if (!stopped) {
    out.error(`网关未在 ${STOP_TIMEOUT_MS / 1000} 秒内退出，进程号(PID) ${pid}`);
    return false;
  }

  removeIfExists(options.paths.pidPath);
  removeIfExists(options.paths.statePath);
  out.log(`网关已停止，进程号(PID) ${pid}`);
  return true;
}

export function formatStatus(status: GatewayStatus, paths: GatewayPaths): string {
  const healthText = status.health.ok
    ? `正常 (${status.health.status ?? "未知状态码"})`
    : `失败${status.health.error ? `：${status.health.error}` : ""}`;
  const pidText = status.pid ? String(status.pid) : "-";
  const managedText = status.managed ? "是" : "否";

  return [
    `网关状态: ${formatGatewayState(status.state)}`,
    `进程号(PID): ${pidText}`,
    `是否由当前网关命令管理: ${managedText}`,
    `端口: ${status.port}`,
    `健康检查: ${healthText}`,
    `健康检查地址: ${status.healthUrl}`,
    `数据目录: ${paths.dataDir}`,
    `运行时目录: ${paths.runtimeDir}`,
    `日志文件: ${paths.logPath}`,
  ].join("\n");
}

function formatGatewayState(state: GatewayState): string {
  switch (state) {
    case "running":
      return "运行中";
    case "stopped":
      return "已停止";
    case "unhealthy":
      return "异常";
  }
}

export function tailLines(text: string, lines: number): string {
  const parts = text.replace(/\n$/, "").split("\n");
  return parts.slice(-lines).join("\n");
}

function waitForHealthy(
  paths: GatewayPaths,
  port: number,
  runtime: GatewayRuntime,
  timeoutMs: number,
): Promise<boolean> {
  return waitUntil(timeoutMs, 250, async () => {
    const pid = readPidFile(paths.pidPath);
    if (pid && !runtime.isProcessAlive(pid)) return false;
    return (await runtime.healthCheck(`http://localhost:${port}/api/health`)).ok;
  }, runtime.sleep);
}

function waitForExit(pid: number, runtime: GatewayRuntime, timeoutMs: number): Promise<boolean> {
  return waitUntil(timeoutMs, 200, async () => !runtime.isProcessAlive(pid), runtime.sleep);
}

async function waitUntil(
  timeoutMs: number,
  intervalMs: number,
  check: () => Promise<boolean>,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let index = 0; index <= attempts; index += 1) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return false;
}

function removeIfExists(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true });
}

function printHelp(): void {
  console.log(`my-agent 网关命令

用法:
  bun run gateway start [--port 3100]
  bun run gateway stop
  bun run gateway restart [--port 3100]
  bun run gateway status [--port 3100]
  bun run gateway logs [--lines 100] [--follow]

说明:
  网关是本地运行控制命令，负责管理现有 src/main.ts 服务进程。
  进程号(PID) 是操作系统进程编号，会写入 .runtime/my-agent.pid。`);
}

async function runLogs(paths: GatewayPaths, options: GatewayCliOptions): Promise<number> {
  if (!existsSync(paths.logPath)) {
    console.log(`暂无日志: ${paths.logPath}`);
    return 0;
  }

  if (options.follow) {
    const proc = Bun.spawn(["tail", "-n", String(options.lines), "-f", paths.logPath], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    return await proc.exited;
  }

  console.log(tailLines(readFileSync(paths.logPath, "utf-8"), options.lines));
  return 0;
}

async function main(): Promise<number> {
  const options = parseGatewayArgs(process.argv.slice(2));
  if (options.help || options.command === "help") {
    printHelp();
    return 0;
  }

  const paths = resolveGatewayPaths();
  switch (options.command) {
    case "start":
      return (await startGateway({ paths, port: options.port })) ? 0 : 1;
    case "stop":
      return (await stopGateway({ paths, port: options.port })) ? 0 : 1;
    case "restart": {
      const stopped = await stopGateway({ paths, port: options.port });
      if (!stopped) return 1;
      return (await startGateway({ paths, port: options.port })) ? 0 : 1;
    }
    case "status": {
      const status = await readGatewayStatus(paths, options.port);
      console.log(formatStatus(status, paths));
      return status.state === "unhealthy" ? 1 : 0;
    }
    case "logs":
      return runLogs(paths, options);
  }
}

if (import.meta.main) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
