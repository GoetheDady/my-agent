import { describe, expect, test } from "bun:test";
import { tool } from "ai";
import { z } from "zod";
import { getTool, listToolsForAgent, registerTool } from "./tool-registry";
import "./tools";

describe("tool registry", () => {
  test("registers built-in tools", () => {
    expect(getTool("read_file")).toMatchObject({
      name: "read_file",
      toolset: "filesystem",
      category: "read",
    });
    expect(getTool("write_file")).toMatchObject({
      name: "write_file",
      toolset: "filesystem",
      category: "write",
    });
  });

  test("registers memory tools", () => {
    expect(getTool("memory_search")).toMatchObject({
      toolset: "memory",
      category: "memory_read",
    });
    expect(getTool("memory_propose")).toMatchObject({
      toolset: "memory",
      category: "memory_write",
      createsCandidateMemory: true,
    });
  });

  test("lists tools by agent", () => {
    const names = listToolsForAgent("default").map((registeredTool) => registeredTool.name);

    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("memory_search");
  });

  test("can disable a tool for one agent", () => {
    registerTool({
      name: "disabled_for_researcher",
      tool: tool({
        description: "test tool",
        inputSchema: z.object({}),
      }),
      toolset: "test",
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
});
