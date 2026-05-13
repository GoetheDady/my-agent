import { create } from "zustand";

export type RuntimeAgentStatus = "idle" | "running" | "paused" | "error";
export type RuntimeTaskStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface RuntimeAgent {
  id: string;
  name: string;
  status: RuntimeAgentStatus;
  current_task_id: string | null;
  workspace_path: string;
  created_at: number;
  updated_at: number;
}

export interface RuntimeTask {
  id: string;
  agent_id: string;
  conversation_id: string | null;
  source_channel: string;
  source_user_id: string;
  status: RuntimeTaskStatus;
  priority: number;
  input: string;
  result: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface RuntimeEvent {
  id: string;
  agent_id: string;
  task_id: string | null;
  conversation_id: string | null;
  type: string;
  payload: string;
  payloadJson?: unknown;
  created_at: number;
}

export interface RuntimeEventView {
  label: string;
  detail: string;
  tone: "task" | "tool" | "memory" | "error" | "neutral";
}

interface RuntimeState {
  agent: RuntimeAgent | null;
  tasks: RuntimeTask[];
  events: RuntimeEvent[];
  loading: boolean;
  error: string | null;
  polling: boolean;
  pollingAgentId: string;

  fetchRuntimeSnapshot: (agentId?: string) => Promise<void>;
  cancelTask: (taskId: string, agentId?: string) => Promise<void>;
  startPolling: (intervalMs?: number, agentId?: string) => void;
  stopPolling: () => void;
}

function parsePayload(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

function payloadRecord(event: RuntimeEvent): Record<string, unknown> {
  const payload = event.payloadJson ?? parsePayload(event.payload);
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function normalizeEvents(events: RuntimeEvent[]): RuntimeEvent[] {
  return events.map((event) => ({
    ...event,
    payloadJson: parsePayload(event.payload),
  }));
}

function getString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getDisplayValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
  return null;
}

export function getQueuedTasks(tasks: RuntimeTask[]): RuntimeTask[] {
  return tasks
    .filter((task) => task.status === "queued")
    .sort((a, b) => b.priority - a.priority || a.created_at - b.created_at);
}

export function getCurrentTask(agent: RuntimeAgent | null, tasks: RuntimeTask[]): RuntimeTask | null {
  if (!agent) return null;
  if (agent.current_task_id) {
    const current = tasks.find((task) => task.id === agent.current_task_id);
    if (current) return current;
  }
  return tasks.find((task) => task.status === "running") ?? null;
}

export function getRuntimeEventView(event: RuntimeEvent): RuntimeEventView {
  const payload = payloadRecord(event);

  if (event.type.startsWith("profile.sync.")) {
    if (event.type === "profile.sync.started") {
      return {
        label: "认知文件同步开始",
        detail: getString(payload, "source") ?? "profile.sync.started",
        tone: "memory",
      };
    }
    if (event.type === "profile.sync.completed") {
      return {
        label: "认知文件同步完成",
        detail: getString(payload, "reason") ?? getString(payload, "source") ?? "profile.sync.completed",
        tone: "memory",
      };
    }
    if (event.type === "profile.sync.skipped") {
      return {
        label: "认知文件同步跳过",
        detail: getString(payload, "reason") ?? "profile.sync.skipped",
        tone: "memory",
      };
    }
    if (event.type === "profile.sync.failed") {
      return {
        label: "认知文件同步失败",
        detail: getString(payload, "error") ?? "profile.sync.failed",
        tone: "error",
      };
    }
  }

  if (event.type.startsWith("agent.config.")) {
    if (event.type === "agent.config.updated") {
      return {
        label: "Agent 配置更新",
        detail: getDisplayValue(payload, "changedKeys") ?? "agent.config.updated",
        tone: "tool",
      };
    }
    if (event.type === "agent.config.reset") {
      return {
        label: "Agent 配置重置",
        detail: getString(payload, "agentId") ?? "agent.config.reset",
        tone: "tool",
      };
    }
    if (event.type === "agent.config.migrated") {
      return {
        label: "Agent 配置迁移",
        detail: getDisplayValue(payload, "migratedCount") ?? "agent.config.migrated",
        tone: "tool",
      };
    }
    if (event.type === "agent.config.validation_failed") {
      return {
        label: "Agent 配置校验失败",
        detail: getString(payload, "error") ?? "agent.config.validation_failed",
        tone: "error",
      };
    }
  }

  if (event.type.startsWith("memory.")) {
    if (event.type === "memory.decision.created") {
      return {
        label: "记忆整理决策",
        detail: getString(payload, "title") ?? getString(payload, "decisionId") ?? "memory.decision.created",
        tone: "memory",
      };
    }
    if (event.type === "memory.decision.applied") {
      return {
        label: "记忆整理应用",
        detail: getString(payload, "title") ?? getString(payload, "decisionId") ?? "memory.decision.applied",
        tone: "memory",
      };
    }
    if (event.type === "memory.decision.skipped") {
      return {
        label: "记忆整理跳过",
        detail: getString(payload, "reason") ?? getString(payload, "title") ?? "memory.decision.skipped",
        tone: "memory",
      };
    }
    if (event.type === "memory.decision.failed") {
      return {
        label: "记忆整理失败",
        detail: getString(payload, "error") ?? getString(payload, "title") ?? "memory.decision.failed",
        tone: "error",
      };
    }
    if (event.type === "memory.decision.undone") {
      return {
        label: "记忆整理撤销",
        detail: getString(payload, "title") ?? getString(payload, "decisionId") ?? "memory.decision.undone",
        tone: "memory",
      };
    }
    if (event.type === "memory.review.created") {
      return {
        label: "审查建议创建",
        detail: getString(payload, "title") ?? getString(payload, "reviewItemId") ?? "memory.review.created",
        tone: "memory",
      };
    }
    if (event.type === "memory.review.accepted") {
      return {
        label: "审查建议接受",
        detail: getString(payload, "title") ?? getString(payload, "reviewItemId") ?? "memory.review.accepted",
        tone: "memory",
      };
    }
    if (event.type === "memory.review.rejected") {
      return {
        label: "审查建议拒绝",
        detail: getString(payload, "title") ?? getString(payload, "reviewItemId") ?? "memory.review.rejected",
        tone: "memory",
      };
    }
    if (event.type === "memory.extract.started") {
      return {
        label: "记忆提取开始",
        detail: getString(payload, "assistantMessageId") ?? "memory.extract.started",
        tone: "memory",
      };
    }
    if (event.type === "memory.extract.completed") {
      return {
        label: "记忆提取完成",
        detail: getString(payload, "summary") ?? getDisplayValue(payload, "count") ?? "memory.extract.completed",
        tone: "memory",
      };
    }
    if (event.type === "memory.extract.failed") {
      return {
        label: "记忆提取失败",
        detail: getString(payload, "error") ?? "memory.extract.failed",
        tone: "error",
      };
    }
    if (event.type === "memory.reconsolidate.started") {
      return {
        label: "记忆再巩固开始",
        detail: getString(payload, "memoryId") ?? "memory.reconsolidate.started",
        tone: "memory",
      };
    }
    if (event.type === "memory.reconsolidate.completed") {
      return {
        label: "记忆再巩固完成",
        detail: getString(payload, "summary") ?? getDisplayValue(payload, "updatedCount") ?? "memory.reconsolidate.completed",
        tone: "memory",
      };
    }
    if (event.type === "memory.reconsolidate.failed") {
      return {
        label: "记忆再巩固失败",
        detail: getString(payload, "error") ?? "memory.reconsolidate.failed",
        tone: "error",
      };
    }
    if (event.type === "memory.dedupe.started") {
      return {
        label: "记忆去重开始",
        detail: getDisplayValue(payload, "dryRun") ?? "memory.dedupe.started",
        tone: "memory",
      };
    }
    if (event.type === "memory.dedupe.completed") {
      return {
        label: "记忆去重完成",
        detail: getDisplayValue(payload, "duplicateGroupCount") ?? "memory.dedupe.completed",
        tone: "memory",
      };
    }
    if (event.type === "memory.dedupe.failed") {
      return {
        label: "记忆去重失败",
        detail: getString(payload, "error") ?? "memory.dedupe.failed",
        tone: "error",
      };
    }
    if (event.type === "memory.search") {
      return {
        label: "记忆检索",
        detail: getString(payload, "query") ?? "memory.search",
        tone: "memory",
      };
    }
    if (event.type === "memory.remember") {
      return {
        label: "写入记忆",
        detail: getString(payload, "action") ?? getString(payload, "reason") ?? getString(payload, "memoryId") ?? "memory.remember",
        tone: "memory",
      };
    }
    return {
      label: "记忆更新",
      detail: getString(payload, "reason") ?? getString(payload, "memoryId") ?? event.type,
      tone: "memory",
    };
  }

  if (event.type === "episode.created" || event.type === "episode.updated") {
    return {
      label: event.type === "episode.created" ? "经历记录创建" : "经历记录更新",
      detail: getString(payload, "title") ?? getString(payload, "episodeId") ?? event.type,
      tone: "memory",
    };
  }

  if (event.type === "episode.failed") {
    return {
      label: "经历记录失败",
      detail: getString(payload, "error") ?? event.type,
      tone: "error",
    };
  }

  if (event.type === "dream.started") {
    return {
      label: "梦整理开始",
      detail: getString(payload, "date") ?? "dream.started",
      tone: "memory",
    };
  }

  if (event.type === "dream.completed") {
    return {
      label: "梦整理完成",
      detail: getDisplayValue(payload, "episodeCount") ?? getString(payload, "date") ?? "dream.completed",
      tone: "memory",
    };
  }

  if (event.type === "dream.failed") {
    return {
      label: "梦整理失败",
      detail: getString(payload, "error") ?? "dream.failed",
      tone: "error",
    };
  }

  if (event.type.startsWith("tool.")) {
    if (event.type === "tool.approval.created") {
      return {
        label: "工具审批创建",
        detail: getString(payload, "toolName") ?? getString(payload, "approvalId") ?? event.type,
        tone: "tool",
      };
    }
    if (event.type === "tool.approval.approved") {
      return {
        label: "工具审批批准",
        detail: getString(payload, "toolName") ?? getString(payload, "approvalId") ?? event.type,
        tone: "tool",
      };
    }
    if (event.type === "tool.approval.denied") {
      return {
        label: "工具审批拒绝",
        detail: getString(payload, "toolName") ?? getString(payload, "approvalId") ?? event.type,
        tone: "error",
      };
    }
    if (event.type === "tool.approval.failed") {
      return {
        label: "工具审批失败",
        detail: getString(payload, "error") ?? getString(payload, "approvalId") ?? event.type,
        tone: "error",
      };
    }
    if (event.type === "tool.policy.updated") {
      return {
        label: "工具策略更新",
        detail: getString(payload, "toolName") ?? getDisplayValue(payload, "changedKeys") ?? event.type,
        tone: "tool",
      };
    }
    return {
      label: event.type === "tool.result" ? "工具结果" : "工具调用",
      detail: getString(payload, "toolName") ?? getString(payload, "name") ?? event.type,
      tone: "tool",
    };
  }

  if (event.type.startsWith("skill.")) {
    if (event.type === "skill.created" || event.type === "skill.updated") {
      return {
        label: event.type === "skill.created" ? "Skill 创建" : "Skill 更新",
        detail: getString(payload, "skillId") ?? getString(payload, "name") ?? event.type,
        tone: "memory",
      };
    }
    if (event.type === "skill.enabled" || event.type === "skill.disabled") {
      return {
        label: event.type === "skill.enabled" ? "Skill 启用" : "Skill 停用",
        detail: getString(payload, "skillId") ?? getString(payload, "name") ?? event.type,
        tone: "memory",
      };
    }
    if (event.type === "skill.viewed") {
      return {
        label: "Skill 读取",
        detail: getString(payload, "skillId") ?? getString(payload, "skillName") ?? event.type,
        tone: "memory",
      };
    }
  }

  if (event.type === "task.failed") {
    return {
      label: "任务失败",
      detail: getString(payload, "error") ?? event.task_id ?? event.type,
      tone: "error",
    };
  }

  if (event.type.startsWith("task.")) {
    const labels: Record<string, string> = {
      "task.created": "任务入队",
      "task.started": "任务开始",
      "task.completed": "任务完成",
    };
    return {
      label: labels[event.type] ?? "任务事件",
      detail: event.task_id ?? event.type,
      tone: "task",
    };
  }

  return {
    label: event.type,
    detail: getString(payload, "text") ?? getString(payload, "message") ?? event.type,
    tone: "neutral",
  };
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  agent: null,
  tasks: [],
  events: [],
  loading: false,
  error: null,
  polling: false,
  pollingAgentId: "default",

  fetchRuntimeSnapshot: async (agentId = "default") => {
    set({ loading: true, error: null });
    try {
      const [agentRes, tasksRes, eventsRes] = await Promise.all([
        fetch(`/api/runtime/agents/${agentId}`),
        fetch(`/api/runtime/tasks?agentId=${agentId}`),
        fetch(`/api/runtime/events?agentId=${agentId}&limit=50`),
      ]);

      if (!agentRes.ok) throw new Error("获取 Agent 状态失败");
      if (!tasksRes.ok) throw new Error("获取任务队列失败");
      if (!eventsRes.ok) throw new Error("获取事件历史失败");

      const agent = await agentRes.json() as RuntimeAgent;
      const taskData = await tasksRes.json() as { tasks: RuntimeTask[] };
      const eventData = await eventsRes.json() as { events: RuntimeEvent[] };

      set({
        agent,
        tasks: taskData.tasks,
        events: normalizeEvents(eventData.events),
        loading: false,
        error: null,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "获取运行状态失败",
      });
    }
  },

  cancelTask: async (taskId, agentId) => {
    const res = await fetch(`/api/runtime/tasks/${taskId}/cancel`, { method: "POST" });
    if (!res.ok) throw new Error("取消任务失败");
    await get().fetchRuntimeSnapshot(agentId ?? get().agent?.id ?? get().pollingAgentId);
  },

  startPolling: (_intervalMs = 2500, agentId = "default") => {
    set({ polling: true, pollingAgentId: agentId });
    get().fetchRuntimeSnapshot(agentId);
  },

  stopPolling: () => {
    set({ polling: false });
  },
}));
