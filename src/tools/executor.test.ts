import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isAgentConfigPath, writeFile } from "./executor";
import { getProjectRoot } from "../core/config";

describe("tool executor", () => {
  test("detects agent config paths", () => {
    const projectRoot = getProjectRoot();

    expect(isAgentConfigPath(join(projectRoot, "data", "agents", "default", "agent.json"))).toBe(true);
    expect(isAgentConfigPath(join(projectRoot, "data", "agents", "default", "skills", "demo", "SKILL.md"))).toBe(false);
  });

  test("write_file cannot modify agent.json", () => {
    const projectRoot = getProjectRoot();
    const configPath = join(projectRoot, "data", "agents", "executor-test", "agent.json");
    mkdirSync(join(projectRoot, "data", "agents", "executor-test"), { recursive: true });
    writeFileSync(configPath, '{"name":"before"}', "utf8");

    try {
      const result = writeFile("data/agents/executor-test/agent.json", '{"name":"after"}', "overwrite");

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe("permission_denied");
      expect(readFileSync(configPath, "utf8")).toBe('{"name":"before"}');
    } finally {
      rmSync(join(projectRoot, "data", "agents", "executor-test"), { recursive: true, force: true });
    }
  });
});
