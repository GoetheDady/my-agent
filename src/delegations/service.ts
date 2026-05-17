import type { ModelMessage } from "ai";
import type { Database } from "bun:sqlite";
import { getAgent } from "../agents/agent-registry";
import { defaultChannelService, type ChannelService } from "../channels/service";
import { getTaskChannelMetadata } from "../channels/external-runner";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { finalizeEpisodeForTask } from "../memory/episode-store";
import { runInternalAgentTask, type RunInternalAgentTaskInput } from "../runtime/internal-runner";
import { claimNextTaskForChannels } from "../tasks/task-queue";
import { createTask, getTask, markTaskCanceled } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/task-types";
import { addTaskDependency } from "../tasks/task-plan-store";
import {
  createDelegation,
  getDelegation,
  getDelegationByCallbackTask,
  getDelegationByChildTask,
  listDelegations,
  toPublicDelegation,
  updateDelegation,
} from "./store";
import type { DelegateTaskInput, DelegationRecord, DelegationStatus, PublicDelegation } from "./types";

type InternalRunner = (input: RunInternalAgentTaskInput) => Promise<{ task: TaskRecord; text: string }>;

export interface DelegationServiceOptions {
  database?: Database;
  channelService?: ChannelService;
  internalRunner?: InternalRunner;
  autoStart?: boolean;
}

const DELEGATION_CHANNELS = ["delegation", "delegation_callback"];
const drainingAgents = new Set<string>();

function normalizeAgentId(value: string): string {
  return value.trim() || "default";
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function buildChildMessages(instruction: string, parentAgentId: string, reason?: string): ModelMessage[] {
  const reasonLine = reason?.trim() ? `\n委派原因：${reason.trim()}` : "";
  return [{
    role: "user",
    content: [{
      type: "text",
      text: [
        `你收到来自 Agent ${parentAgentId} 的异步委派任务。请独立完成，并只返回给委派方需要的结果、结论和必要证据。`,
        "",
        "如果任务要求基于当前项目、代码、配置或实现细节，请优先使用文件读取工具查看相关源码和配置，不能只查询记忆。",
        "如果你没有权限读取某个文件、找不到路径、或工具返回错误，必须在最终结果里明确说明具体读不了什么、原因是什么、需要什么授权或下一步操作。",
        "任何情况下都不要返回空结果；即使资料不足，也要返回你已经尝试了什么和为什么无法完成。",
        "",
        `任务：${instruction}${reasonLine}`,
      ].join("\n"),
    }],
  }];
}

function buildCallbackMessages(input: {
  instruction: string;
  childAgentId: string;
  result: string;
}): ModelMessage[] {
  const childResult = input.result.trim()
    ? input.result
    : "子 Agent 没有返回可用文本结果。请如实告诉用户本次委派没有拿到有效输出，并建议下一步可以重试、换 Agent，或由你直接完成。";
  return [{
    role: "user",
    content: [{
      type: "text",
      text: [
        "你之前把一个任务异步委派给了另一个 Agent。现在子 Agent 已经完成。",
        "请把结果整理成用户能直接理解的回复，说明已完成，并保留关键结论。",
        "不要暴露内部实现细节，不要说自己无法访问用户会话。",
        "",
        `原始委派指令：${input.instruction}`,
        `完成 Agent：${input.childAgentId}`,
        "",
        "子 Agent 结果：",
        childResult,
      ].join("\n"),
    }],
  }];
}

/**
 * DelegationService 管理异步 Agent 委派。
 *
 * 委派表示 Agent A 创建 Agent B 的后台任务；Agent B 完成后，再创建 Agent A
 * 的 callback task，由 Agent A 整理结果并通知原用户。
 */
export class DelegationService {
  private readonly database: Database;
  private readonly channelService: ChannelService;
  private readonly internalRunner: InternalRunner;
  private readonly autoStart: boolean;

  constructor(options: DelegationServiceOptions = {}) {
    this.database = options.database ?? getDb();
    this.channelService = options.channelService ?? defaultChannelService;
    this.internalRunner = options.internalRunner ?? runInternalAgentTask;
    this.autoStart = options.autoStart ?? true;
  }

  delegateTask(input: DelegateTaskInput): PublicDelegation {
    const parentAgentId = normalizeAgentId(input.parentAgentId);
    const childAgentId = normalizeAgentId(input.targetAgentId);
    const instruction = input.instruction.trim();
    if (!instruction) throw new Error("instruction 不能为空");
    if (parentAgentId === childAgentId) throw new Error("不能把任务委派给自己");
    if (input.sourceChannel === "delegation_callback") {
      throw new Error("MVP 不允许递归委派");
    }
    if (!getAgent(parentAgentId, this.database)) {
      throw new Error(`Parent agent not found: ${parentAgentId}`);
    }
    if (!getAgent(childAgentId, this.database)) {
      throw new Error(`Target agent not found: ${childAgentId}`);
    }

    const parentTask = getTask(input.parentTaskId, this.database);
    if (!parentTask) throw new Error(`Parent task not found: ${input.parentTaskId}`);
    if (parentTask.source_channel === "delegation_callback" || parentTask.source_channel === "delegation") {
      throw new Error("MVP 不允许递归委派");
    }

    const sourceMetadata: Record<string, unknown> = input.sourceMetadata ?? {
      ...getTaskChannelMetadata(parentTask.id, this.database),
    };
    const childTask = createTask({
      agent_id: childAgentId,
      parent_task_id: parentTask.id,
      plan_step_id: input.planStepId ?? null,
      conversation_id: input.parentConversationId ?? parentTask.conversation_id,
      source_channel: "delegation",
      source_user_id: input.sourceUserId,
      input: instruction,
    }, this.database);
    for (const dependsOnTaskId of input.dependsOnTaskIds ?? []) {
      addTaskDependency(childTask.id, dependsOnTaskId, input.reason ?? "", this.database);
    }
    const delegation = createDelegation({
      parentSessionId: input.parentSessionId,
      parentAgentId,
      parentTaskId: parentTask.id,
      parentConversationId: input.parentConversationId ?? parentTask.conversation_id,
      childAgentId,
      childTaskId: childTask.id,
      sourceChannel: input.sourceChannel,
      sourceUserId: input.sourceUserId,
      sourceMetadata,
      instruction,
    }, this.database);

    appendEvent({
      agent_id: parentAgentId,
      task_id: parentTask.id,
      conversation_id: parentTask.conversation_id,
      type: "agent.delegation.created",
      payload: {
        delegationId: delegation.id,
        childAgentId,
        childTaskId: childTask.id,
        instruction,
        reason: input.reason,
      },
    }, this.database);

    if (this.autoStart) {
      void this.drainAgent(childAgentId);
    }
    return toPublicDelegation(delegation);
  }

  getDelegation(id: string): PublicDelegation | null {
    const record = getDelegation(id, this.database);
    return record ? toPublicDelegation(record) : null;
  }

  listDelegations(input: {
    agentId?: string;
    sessionId?: string;
    status?: DelegationStatus;
    limit?: number;
  } = {}): PublicDelegation[] {
    return listDelegations(input, this.database).map(toPublicDelegation);
  }

  cancelDelegation(id: string): PublicDelegation {
    const delegation = getDelegation(id, this.database);
    if (!delegation) throw new Error(`Delegation not found: ${id}`);
    if (delegation.status !== "queued") throw new Error("只能取消未完成的 delegation");
    const childTask = getTask(delegation.child_task_id, this.database);
    if (childTask?.status === "queued") {
      markTaskCanceled(childTask.id, this.database);
      finalizeEpisodeForTask(childTask.id, this.database);
    }
    const canceled = updateDelegation({
      id,
      status: "canceled",
      error: "Delegation canceled",
      completedAt: Date.now(),
    }, this.database);
    return toPublicDelegation(canceled);
  }

  async drainAgent(agentId: string): Promise<void> {
    if (drainingAgents.has(agentId)) return;
    drainingAgents.add(agentId);
    try {
      while (true) {
        const task = claimNextTaskForChannels(agentId, DELEGATION_CHANNELS, this.database);
        if (!task) return;
        await this.runClaimedDelegationTask(task);
      }
    } finally {
      drainingAgents.delete(agentId);
    }
  }

  async runClaimedDelegationTask(task: TaskRecord): Promise<void> {
    const childDelegation = getDelegationByChildTask(task.id, this.database);
    if (childDelegation) {
      await this.runChildTask(childDelegation, task);
      return;
    }

    const callbackDelegation = getDelegationByCallbackTask(task.id, this.database);
    if (callbackDelegation) {
      await this.runCallbackTask(callbackDelegation, task);
      return;
    }

    await this.internalRunner({
      task,
      messages: [{ role: "user", content: [{ type: "text", text: task.input }] }],
      database: this.database,
    });
  }

  private async runChildTask(delegation: DelegationRecord, task: TaskRecord): Promise<void> {
    try {
      const result = await this.internalRunner({
        task,
        messages: buildChildMessages(delegation.instruction, delegation.parent_agent_id),
        database: this.database,
        emptyResultMessage: "子 Agent 没有返回可用文本结果；它应说明已尝试的读取或检索步骤，以及无法完成的具体原因。",
      });
      const completed = updateDelegation({
        id: delegation.id,
        status: "completed",
        result: result.text,
        error: null,
        completedAt: Date.now(),
      }, this.database);
      appendEvent({
        agent_id: delegation.parent_agent_id,
        task_id: delegation.parent_task_id,
        conversation_id: delegation.parent_conversation_id,
        type: "agent.delegation.completed",
        payload: {
          delegationId: delegation.id,
          childAgentId: delegation.child_agent_id,
          childTaskId: delegation.child_task_id,
        },
      }, this.database);
      await this.createAndRunCallbackTask(completed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = updateDelegation({
        id: delegation.id,
        status: "failed",
        error: message,
        completedAt: Date.now(),
      }, this.database);
      appendEvent({
        agent_id: delegation.parent_agent_id,
        task_id: delegation.parent_task_id,
        conversation_id: delegation.parent_conversation_id,
        type: "agent.delegation.failed",
        payload: {
          delegationId: delegation.id,
          childAgentId: delegation.child_agent_id,
          childTaskId: delegation.child_task_id,
          error: message,
        },
      }, this.database);
      await this.notifyDelegationFailure(failed, message);
    } finally {
      if (this.autoStart) {
        void this.drainAgent(task.agent_id);
      }
    }
  }

  private async createAndRunCallbackTask(delegation: DelegationRecord): Promise<void> {
    const callbackTask = createTask({
      agent_id: delegation.parent_agent_id,
      conversation_id: delegation.parent_conversation_id,
      source_channel: "delegation_callback",
      source_user_id: delegation.source_user_id,
      input: `整理子 Agent ${delegation.child_agent_id} 的委派结果并回复用户。`,
    }, this.database);
    const updated = updateDelegation({
      id: delegation.id,
      callbackTaskId: callbackTask.id,
    }, this.database);
    appendEvent({
      agent_id: delegation.parent_agent_id,
      task_id: callbackTask.id,
      conversation_id: callbackTask.conversation_id,
      type: "agent.delegation.callback.created",
      payload: {
        delegationId: delegation.id,
        childAgentId: delegation.child_agent_id,
        callbackTaskId: callbackTask.id,
      },
    }, this.database);
    if (this.autoStart) {
      void this.drainAgent(updated.parent_agent_id);
    }
  }

  private async runCallbackTask(delegation: DelegationRecord, task: TaskRecord): Promise<void> {
    try {
      const result = await this.internalRunner({
        task,
        messages: buildCallbackMessages({
          instruction: delegation.instruction,
          childAgentId: delegation.child_agent_id,
          result: delegation.result ?? "",
        }),
        database: this.database,
      });
      await this.deliverCallbackResult(delegation, result.text);
      appendEvent({
        agent_id: delegation.parent_agent_id,
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "agent.delegation.callback.completed",
        payload: {
          delegationId: delegation.id,
          callbackTaskId: task.id,
        },
      }, this.database);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendEvent({
        agent_id: delegation.parent_agent_id,
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "agent.delegation.callback.failed",
        payload: {
          delegationId: delegation.id,
          callbackTaskId: task.id,
          error: message,
        },
      }, this.database);
      await this.notifyDelegationFailure(delegation, message);
    } finally {
      if (this.autoStart) {
        void this.drainAgent(task.agent_id);
      }
    }
  }

  private async deliverCallbackResult(delegation: DelegationRecord, text: string): Promise<void> {
    if (delegation.parent_session_id) {
      const { appendMessage, getSession } = await import("../sessions/service");
      if (getSession(delegation.parent_session_id, this.database)) {
        appendMessage(delegation.parent_session_id, "assistant", JSON.stringify([{ type: "text", text }]), this.database);
      }
      return;
    }

    if (delegation.source_channel !== "web") {
      await this.channelService.deliverMessage({
        channel: delegation.source_channel,
        conversationId: delegation.parent_conversation_id ?? "",
        taskId: delegation.callback_task_id ?? undefined,
        text,
        metadata: parseMetadata(delegation.source_metadata),
      });
    }
  }

  private async notifyDelegationFailure(delegation: DelegationRecord, message: string): Promise<void> {
    const text = `委派任务处理失败：${message}`;
    if (delegation.parent_session_id) {
      const { appendMessage, getSession } = await import("../sessions/service");
      if (getSession(delegation.parent_session_id, this.database)) {
        appendMessage(delegation.parent_session_id, "assistant", JSON.stringify([{ type: "text", text }]), this.database);
      }
      return;
    }
    if (delegation.source_channel !== "web") {
      await this.channelService.deliverMessage({
        channel: delegation.source_channel,
        conversationId: delegation.parent_conversation_id ?? "",
        taskId: delegation.callback_task_id ?? delegation.parent_task_id,
        text,
        metadata: parseMetadata(delegation.source_metadata),
      }).catch(() => undefined);
    }
  }
}

export const defaultDelegationService = new DelegationService();
