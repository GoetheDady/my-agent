import {
  type ModelMessage,
  consumeStream,
  convertToModelMessages,
  streamText,
  stepCountIs,
} from "ai";
import { createDeepSeek, deepseek } from "@ai-sdk/deepseek";
import type { Database } from "bun:sqlite";
import { appendEvent } from "../events/event-log";
import { buildAgentSystemPrompt } from "../brain/prompt-builder";
import { tools } from "../brain/tools";
import { getConfig } from "../core/config";
import { getDb } from "../core/database";
import { getTask, markTaskCompleted, markTaskFailed } from "../tasks/task-store";
import { claimTask } from "../tasks/task-queue";
import type { TaskRecord } from "../tasks/task-types";

type StreamTextRunner = typeof streamText;
type StreamTextRunResult = ReturnType<typeof streamText<typeof tools, never>>;

export interface AgentRunInput {
  task: TaskRecord;
  messages: ModelMessage[];
  thinkingEnabled?: boolean;
  abortSignal?: AbortSignal;
  streamTextRunner?: StreamTextRunner;
  database?: Database;
}

export interface AgentRunResult {
  result: StreamTextRunResult;
  taskId: string;
}

export class AgentBusyError extends Error {
  constructor(agentId: string) {
    super(`Agent is busy: ${agentId}`);
    this.name = "AgentBusyError";
  }
}

export async function toModelMessages(uiMessages: Array<{
  role: string;
  parts?: unknown;
  content?: unknown;
}>): Promise<ModelMessage[]> {
  return convertToModelMessages(
    uiMessages.map((message) => {
      if (message.parts) return message;
      if (typeof message.content === "string") {
        return { role: message.role, parts: [{ type: "text", text: message.content }] };
      }
      if (Array.isArray(message.content)) {
        return {
          role: message.role,
          parts: (message.content as Array<Record<string, unknown>>).map((block) => ({
            type: block.type ?? "text",
            text: (block.text ?? block.content ?? "") as string,
          })),
        };
      }
      return { role: message.role, parts: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  );
}

export function runAgentTask(input: AgentRunInput): AgentRunResult {
  const database = input.database ?? getDb();
  let eventTimestamp = Date.now();
  const nextEventTimestamp = (): number => {
    eventTimestamp += 1;
    return eventTimestamp;
  };

  ensureTaskCanRun(input.task, database);
  appendEvent({
    agent_id: input.task.agent_id,
    task_id: input.task.id,
    conversation_id: input.task.conversation_id,
    type: "task.started",
    payload: { input: input.task.input },
    created_at: nextEventTimestamp(),
  }, database);

  try {
    const runner = input.streamTextRunner ?? streamText;
    const result = runner({
      model: getModel(),
      system: buildAgentSystemPrompt(input.task, database),
      messages: input.messages,
      stopWhen: stepCountIs(5),
      tools,
      abortSignal: input.abortSignal,
      providerOptions: {
        deepseek: { thinking: input.thinkingEnabled ? { type: "enabled" } : { type: "disabled" } },
      },
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") {
          appendEvent({
            agent_id: input.task.agent_id,
            task_id: input.task.id,
            conversation_id: input.task.conversation_id,
            type: "assistant.delta",
            payload: { text: chunk.text },
            created_at: nextEventTimestamp(),
          }, database);
        }
      },
      onFinish: ({ text }) => {
        appendEvent({
          agent_id: input.task.agent_id,
          task_id: input.task.id,
          conversation_id: input.task.conversation_id,
          type: "assistant.message",
          payload: { text },
          created_at: nextEventTimestamp(),
        }, database);
        markTaskCompleted(input.task.id, text, database);
        appendEvent({
          agent_id: input.task.agent_id,
          task_id: input.task.id,
          conversation_id: input.task.conversation_id,
          type: "task.completed",
          payload: { result: text },
          created_at: nextEventTimestamp(),
        }, database);
      },
      onError: ({ error }) => {
        const message = error instanceof Error ? error.message : String(error);
        markTaskFailed(input.task.id, message, database);
        appendEvent({
          agent_id: input.task.agent_id,
          task_id: input.task.id,
          conversation_id: input.task.conversation_id,
          type: "task.failed",
          payload: { error: message },
          created_at: nextEventTimestamp(),
        }, database);
      },
    }) as StreamTextRunResult;

    return { result, taskId: input.task.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markTaskFailed(input.task.id, message, database);
    appendEvent({
      agent_id: input.task.agent_id,
      task_id: input.task.id,
      conversation_id: input.task.conversation_id,
      type: "task.failed",
      payload: { error: message },
      created_at: nextEventTimestamp(),
    }, database);
    throw error;
  }
}

function ensureTaskCanRun(task: TaskRecord, database: Database): void {
  const stored = getTask(task.id, database);
  if (!stored) {
    throw new Error(`Task not found: ${task.id}`);
  }

  if (stored.status === "running") {
    return;
  }

  if (stored.status !== "queued") {
    throw new Error(`Task is not runnable: ${task.id}`);
  }

  const claimed = claimTask(task.id, database);
  if (!claimed) {
    throw new AgentBusyError(task.agent_id);
  }
}

export function toAgentUiMessageStreamResponse(
  run: AgentRunResult,
  onFinish: (event: { responseMessage: unknown }) => void,
): Response {
  return run.result.toUIMessageStreamResponse({
    consumeSseStream: consumeStream,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
    onFinish,
  });
}

function getModel() {
  const config = getConfig();
  const provider = config.provider.baseURL
    ? createDeepSeek({ baseURL: config.provider.baseURL })
    : deepseek;
  return provider(config.provider.model);
}
