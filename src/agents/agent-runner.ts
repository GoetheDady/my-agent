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
import { buildAgentTools, tools } from "../brain/tools";
import { getConfig } from "../core/config";
import { getDb } from "../core/database";
import { getTask, markTaskCompleted, markTaskFailed } from "../tasks/task-store";
import { claimTask } from "../tasks/task-queue";
import type { TaskRecord } from "../tasks/task-types";

type StreamTextRunner = typeof streamText;
type StreamTextRunResult = ReturnType<typeof streamText<typeof tools, never>>;
const MODEL_RUN_TIMEOUT_MS = 45_000;

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
  let settled = false;
  const runAbortSignal = createRunAbortSignal(input.abortSignal, MODEL_RUN_TIMEOUT_MS);
  const nextEventTimestamp = (): number => {
    eventTimestamp += 1;
    return eventTimestamp;
  };

  const failTaskOnce = (message: string): void => {
    if (settled) return;
    settled = true;
    runAbortSignal.cleanup();
    const latest = getTask(input.task.id, database);
    if (!latest || latest.status !== "running") return;

    markTaskFailed(input.task.id, message, database);
    appendEvent({
      agent_id: input.task.agent_id,
      task_id: input.task.id,
      conversation_id: input.task.conversation_id,
      type: "task.failed",
      payload: { error: message },
      created_at: nextEventTimestamp(),
    }, database);
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
  if (runAbortSignal.signal.aborted) {
    const message = runAbortSignal.reason();
    failTaskOnce(message);
    throw new Error(message);
  }
  runAbortSignal.signal.addEventListener("abort", () => failTaskOnce(runAbortSignal.reason()), {
    once: true,
  });

  try {
    const runner = input.streamTextRunner ?? streamText;
    const taskTools = buildAgentTools({
      agentId: input.task.agent_id,
      taskId: input.task.id,
      conversationId: input.task.conversation_id,
      database,
    });
    const result = runner({
      model: getModel(),
      system: buildAgentSystemPrompt(input.task, database),
      messages: input.messages,
      stopWhen: stepCountIs(5),
      tools: taskTools,
      abortSignal: runAbortSignal.signal,
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
        if (settled) return;
        settled = true;
        runAbortSignal.cleanup();
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
        failTaskOnce(message);
      },
    }) as unknown as StreamTextRunResult;

    return { result, taskId: input.task.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failTaskOnce(message);
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

function createRunAbortSignal(
  clientSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; reason: () => string; cleanup: () => void } {
  const controller = new AbortController();
  let reason = "";
  const timeout = setTimeout(() => {
    reason = `Model run timed out after ${timeoutMs}ms`;
    controller.abort();
  }, timeoutMs);

  const abortFromClient = () => {
    reason = "Client aborted stream";
    clearTimeout(timeout);
    controller.abort();
  };

  if (clientSignal?.aborted) {
    abortFromClient();
  } else {
    clientSignal?.addEventListener("abort", abortFromClient, { once: true });
  }

  return {
    signal: controller.signal,
    reason: () => reason || "Model run aborted",
    cleanup: () => {
      clearTimeout(timeout);
      clientSignal?.removeEventListener("abort", abortFromClient);
    },
  };
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
