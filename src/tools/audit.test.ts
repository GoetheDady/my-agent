import { describe, expect, test } from "bun:test";
import { tool } from "ai";
import { z } from "zod";
import { withToolAudit } from "./audit";

describe("tool audit", () => {
  test("wraps a successful tool call with audit metadata", async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const auditedTool = withToolAudit("demo_tool", tool({
      description: "demo",
      inputSchema: z.object({ value: z.string() }),
      execute: async (input: { value: string }) => ({ echoed: input.value }),
    }), {
      agentId: "default",
      taskId: "task-1",
      conversationId: "conversation-1",
      appendEvent: (event) => {
        events.push({ type: event.type, payload: event.payload as Record<string, unknown> });
      },
      updateTaskProgress: () => null,
    });

    const result = await auditedTool.execute?.({ value: "hello" }, {
      toolCallId: "call-1",
      messages: [],
      experimental_context: {},
    });

    expect(result).toEqual({ echoed: "hello" });
    expect(events.map((event) => event.type)).toEqual(["tool.call", "tool.result"]);
    expect(events[0].payload).toMatchObject({
      toolName: "demo_tool",
      toolCallId: "call-1",
    });
    expect(events[1].payload).toMatchObject({
      toolName: "demo_tool",
      toolCallId: "call-1",
      success: true,
    });
  });

  test("records failed tool calls before rethrowing", async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const auditedTool = withToolAudit("demo_tool", tool({
      description: "demo",
      inputSchema: z.object({ flag: z.boolean().optional() }),
      execute: async (_input: { flag?: boolean }): Promise<{ ok: boolean }> => {
        throw new Error("boom");
      },
    }), {
      agentId: "default",
      taskId: "task-1",
      conversationId: "conversation-1",
      appendEvent: (event) => {
        events.push({ type: event.type, payload: event.payload as Record<string, unknown> });
      },
      updateTaskProgress: () => null,
    });

    await expect(
      auditedTool.execute?.({}, {
        toolCallId: "call-1",
        messages: [],
        experimental_context: {},
      }),
    ).rejects.toThrow("boom");
    expect(events.map((event) => event.type)).toEqual(["tool.call", "tool.result"]);
    expect(events[1].payload).toMatchObject({
      toolName: "demo_tool",
      toolCallId: "call-1",
      success: false,
      error: "boom",
    });
  });
});
