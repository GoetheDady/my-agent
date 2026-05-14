import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  formatStatus,
  parseGatewayArgs,
  readGatewayStatus,
  readPidFile,
  resolveGatewayPaths,
  tailLines,
  type GatewayPaths,
  type HealthResult,
} from "./gateway";

function withTempPaths<T>(run: (paths: GatewayPaths) => T): T {
  const root = mkdtempSync(resolve(tmpdir(), "my-agent-gateway-"));
  try {
    const paths = resolveGatewayPaths(root);
    mkdirSync(paths.runtimeDir, { recursive: true });
    return run(paths);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fakeRuntime(params: {
  alive?: boolean;
  health?: HealthResult;
}) {
  return {
    isProcessAlive: () => params.alive ?? false,
    killProcess: () => undefined,
    sleep: () => Promise.resolve(),
    healthCheck: () => Promise.resolve(params.health ?? { ok: false, error: "down" }),
  };
}

describe("gateway cli", () => {
  test("parseGatewayArgs reads command, port, log lines and follow flag", () => {
    expect(parseGatewayArgs(["logs", "--port", "4000", "--lines=20", "--follow"])).toEqual({
      command: "logs",
      port: 4000,
      lines: 20,
      follow: true,
      help: false,
    });
  });

  test("parseGatewayArgs uses PORT env and defaults to help", () => {
    expect(parseGatewayArgs([], { PORT: "3999" })).toMatchObject({
      command: "help",
      port: 3999,
    });
  });

  test("parseGatewayArgs defaults to port 3100", () => {
    expect(parseGatewayArgs(["status"], {})).toMatchObject({
      command: "status",
      port: 3100,
    });
  });

  test("readPidFile returns valid pids and ignores invalid content", () => {
    withTempPaths((paths) => {
      writeFileSync(paths.pidPath, "1234\n", "utf-8");
      expect(readPidFile(paths.pidPath)).toBe(1234);

      writeFileSync(paths.pidPath, "abc\n", "utf-8");
      expect(readPidFile(paths.pidPath)).toBeNull();
    });
  });

  test("readGatewayStatus reports managed running process", async () => {
    await withTempPaths(async (paths) => {
      writeFileSync(paths.pidPath, "1234\n", "utf-8");
      const status = await readGatewayStatus(
        paths,
        3100,
        fakeRuntime({ alive: true, health: { ok: true, status: 200 } }),
      );

      expect(status).toMatchObject({
        state: "running",
        pid: 1234,
        pidAlive: true,
        managed: true,
      });
    });
  });

  test("readGatewayStatus cleans stale pid files and reports stopped", async () => {
    await withTempPaths(async (paths) => {
      writeFileSync(paths.pidPath, "1234\n", "utf-8");
      const status = await readGatewayStatus(paths, 3100, fakeRuntime({ alive: false }));

      expect(status.state).toBe("stopped");
      expect(readPidFile(paths.pidPath)).toBeNull();
    });
  });

  test("formatStatus includes state, health and important paths", () => {
    withTempPaths((paths) => {
      const text = formatStatus(
        {
          state: "running",
          pid: 1234,
          pidAlive: true,
          health: { ok: true, status: 200 },
          port: 3100,
          healthUrl: "http://localhost:3100/api/health",
          managed: true,
        },
        paths,
      );

      expect(text).toContain("网关状态: 运行中");
      expect(text).toContain("进程号(PID): 1234");
      expect(text).toContain("健康检查: 正常 (200)");
      expect(text).toContain(paths.logPath);
    });
  });

  test("tailLines returns the requested number of trailing lines", () => {
    expect(tailLines("a\nb\nc\nd\n", 2)).toBe("c\nd");
  });
});
