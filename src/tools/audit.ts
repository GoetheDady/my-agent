import type { Database } from "bun:sqlite";
import type { Tool, ToolExecutionOptions } from "ai";
import { getDb } from "../core/database";
import { appendEvent, type AppendEventInput } from "../events/event-log";
import { updateTaskProgress } from "../tasks/task-store";

export interface ToolAuditContext {
  agentId?: string;
  taskId?: string | null;
  conversationId?: string | null;
  database?: Database;
  appendEvent?: (input: AppendEventInput, database?: Database) => unknown;
  updateTaskProgress?: typeof updateTaskProgress;
}

export function withToolAudit(toolName: string, baseTool: Tool, context: ToolAuditContext): Tool {
  if (typeof baseTool.execute !== "function") return baseTool;

  const execute = baseTool.execute;
  return {
    ...baseTool,
    execute: async (input: unknown, options: ToolExecutionOptions) => {
      const database = context.database ?? getDb();
      const agentId = context.agentId ?? "default";
      const taskId = context.taskId ?? null;
      const conversationId = context.conversationId ?? null;
      const toolCallId = options.toolCallId;
      const startedAt = Date.now();
      const writeEvent = context.appendEvent ?? appendEvent;
      const writeProgress = context.updateTaskProgress ?? updateTaskProgress;

      if (taskId) {
        writeProgress(taskId, {
          status: "using_tool",
          message: `正在执行工具：${toolName}`,
          metadata: {
            currentToolName: toolName,
            currentToolCallId: toolCallId,
          },
        }, database);
      }
      writeEvent({
        agent_id: agentId,
        task_id: taskId,
        conversation_id: conversationId,
        type: "tool.call",
        payload: {
          toolName,
          toolCallId,
          args: input,
          startedAt,
        },
        created_at: startedAt,
      }, database);

      try {
        const output = await execute(input, options);
        const durationMs = Date.now() - startedAt;
        writeEvent({
          agent_id: agentId,
          task_id: taskId,
          conversation_id: conversationId,
          type: "tool.result",
          payload: {
            toolName,
            toolCallId,
            success: true,
            durationMs,
            outputPreview: previewValue(output),
          },
        }, database);
        if (taskId) {
          writeProgress(taskId, {
            status: "using_tool",
            message: `工具执行完成：${toolName}`,
            metadata: {
              currentToolName: toolName,
              currentToolCallId: toolCallId,
              recentOutput: previewValue(output),
            },
          }, database);
        }
        return output;
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        writeEvent({
          agent_id: agentId,
          task_id: taskId,
          conversation_id: conversationId,
          type: "tool.result",
          payload: {
            toolName,
            toolCallId,
            success: false,
            durationMs,
            error: message,
          },
        }, database);
        if (taskId) {
          writeProgress(taskId, {
            status: "using_tool",
            message: `工具执行失败：${toolName}`,
            metadata: {
              currentToolName: toolName,
              currentToolCallId: toolCallId,
              recentOutput: message,
            },
          }, database);
        }
        throw error;
      }
    },
  };
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 500);
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}
