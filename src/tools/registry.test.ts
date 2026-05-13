import { describe, expect, test } from "bun:test";
import { tool } from "ai";
import { z } from "zod";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAgentConfigService } from "../agents/config-service";
import { buildAgentTools } from "./builtin-tools";
import { getTool, listToolsForAgent, registerTool } from "./registry";
import "./service";

const originalGetAgentConfig = defaultAgentConfigService.getAgentConfig.bind(defaultAgentConfigService);
const originalPatchAgentConfig = defaultAgentConfigService.patchAgentConfig.bind(defaultAgentConfigService);

async function withTemporaryAgentConfig<T>(run: () => Promise<T> | T): Promise<T> {
  const rootDir = mkdtempSync(join(tmpdir(), "my-agent-tool-runtime-"));
  const { AgentConfigService } = await import("../agents/config-service");
  const service = new AgentConfigService({ rootDir });
  defaultAgentConfigService.getAgentConfig = service.getAgentConfig.bind(service);
  defaultAgentConfigService.patchAgentConfig = service.patchAgentConfig.bind(service);
  try {
    return await run();
  } finally {
    defaultAgentConfigService.getAgentConfig = originalGetAgentConfig;
    defaultAgentConfigService.patchAgentConfig = originalPatchAgentConfig;
    rmSync(rootDir, { recursive: true, force: true });
  }
}

async function resolveNeedsApproval(needsApproval: unknown): Promise<boolean | undefined> {
  if (typeof needsApproval === "boolean") return needsApproval;
  if (typeof needsApproval !== "function") return undefined;
  return await needsApproval({}, { toolCallId: "call", messages: [] });
}

describe("tool registry", () => {
  test("registers built-in tools", () => {
    expect(getTool("search_files")).toMatchObject({
      name: "search_files",
      toolset: "file",
      category: "read",
    });
    expect(getTool("read_file")).toMatchObject({
      name: "read_file",
      toolset: "file",
      category: "read",
    });
    expect(getTool("write_file")).toMatchObject({
      name: "write_file",
      toolset: "file",
      category: "write",
    });
  });

  test("registers memory tools", () => {
    expect(getTool("memory_search")).toMatchObject({
      toolset: "memory",
      category: "memory_read",
    });
    expect(getTool("memory_remember")).toMatchObject({
      toolset: "memory",
      category: "memory_write",
    });
  });

  test("lists tools by agent", () => {
    const names = listToolsForAgent("default").map((registeredTool) => registeredTool.name);

    expect(names).toContain("search_files");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("memory_search");
    expect(names).toContain("agent_list");
    expect(names).toContain("agent_get");
    expect(names).toContain("agent_create");
  });

  test("can disable a tool for one agent", () => {
    registerTool({
      name: "disabled_for_researcher",
      tool: tool({
        description: "test tool",
        inputSchema: z.object({}),
      }),
      toolset: "memory",
      category: "read",
      disabledForAgents: ["researcher"],
    });

    expect(listToolsForAgent("default").map((registeredTool) => registeredTool.name)).toContain(
      "disabled_for_researcher",
    );
    expect(listToolsForAgent("researcher").map((registeredTool) => registeredTool.name)).not.toContain(
      "disabled_for_researcher",
    );
  });

  test("buildAgentTools follows enabledToolsets from agent config", async () => {
    await withTemporaryAgentConfig(async () => {
      defaultAgentConfigService.patchAgentConfig("default", {
        tools: { removeEnabledToolsets: ["file"] },
      });
      const names = Object.keys(buildAgentTools({ agentId: "default" }));

      expect(names).not.toContain("search_files");
      expect(names).not.toContain("read_file");
      expect(names).not.toContain("write_file");
      expect(names).toContain("memory_recall");
    });
  });

  test("buildAgentTools follows requiresApproval from agent config", async () => {
    await withTemporaryAgentConfig(async () => {
      let tools = buildAgentTools({ agentId: "default" });
      await expect(resolveNeedsApproval(tools.skill_create.needsApproval)).resolves.toBe(true);

      defaultAgentConfigService.patchAgentConfig("default", {
        tools: { removeRequiresApproval: ["skill_create"] },
      });
      tools = buildAgentTools({ agentId: "default" });

      await expect(resolveNeedsApproval(tools.skill_create.needsApproval)).resolves.toBe(false);
    });
  });
});
