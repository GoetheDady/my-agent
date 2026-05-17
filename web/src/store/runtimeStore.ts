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
  parent_task_id?: string | null;
  plan_step_id?: string | null;
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
  attempt_count?: number;
  max_attempts?: number;
  lease_expires_at?: number | null;
  canceled_at?: number | null;
  failure_type?: string | null;
  failure_stage?: string | null;
  retriable?: boolean | null;
  progress_status?: string;
  progress_message?: string;
  last_progress_at?: number | null;
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

export type RuntimeTaskTimelineKind =
  | "task"
  | "progress"
  | "tool"
  | "approval"
  | "assistant"
  | "memory"
  | "episode"
  | "channel"
  | "watchdog"
  | "agent"
  | "other";

export type RuntimeTaskTimelineTone = "info" | "success" | "warning" | "error";

export interface RuntimeTaskTimelineItem {
  id: string;
  eventId: string;
  kind: RuntimeTaskTimelineKind;
  tone: RuntimeTaskTimelineTone;
  title: string;
  detail: string;
  createdAt: number;
  payloadJson: Record<string, unknown>;
}

export interface RuntimeTaskCurrentView {
  progressStatus: string;
  progressMessage: string;
  currentToolName: string | null;
  currentToolCallId: string | null;
  recentOutput: string | null;
  failureType: string | null;
  failureStage: string | null;
  retriable: boolean | null;
  leaseExpiresAt: number | null;
  lastProgressAt: number | null;
}

export interface RuntimeTaskEpisode {
  id: string;
  task_id: string;
  title: string;
  summary: string;
  outcome: string;
  key_steps: string[];
  problems: string[];
}

export type RuntimeTaskStepStatus = "pending" | "running" | "completed" | "failed" | "canceled" | "skipped";

export interface RuntimeTaskStep {
  id: string;
  task_id: string;
  step_index: number;
  title: string;
  detail: string;
  status: RuntimeTaskStepStatus;
  child_task_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface RuntimeTaskDependency {
  task_id: string;
  depends_on_task_id: string;
  reason: string;
  created_at: number;
  depends_on_status: RuntimeTaskStatus;
  depends_on_input: string;
}

export interface RuntimeTaskTimelineResponse {
  task: RuntimeTask;
  episode: RuntimeTaskEpisode | null;
  current: RuntimeTaskCurrentView;
  plan: {
    steps: RuntimeTaskStep[];
  };
  dependencies: RuntimeTaskDependency[];
  children: RuntimeTask[];
  timeline: RuntimeTaskTimelineItem[];
}

export interface RuntimeWatchdogNotice {
  title: string;
  detail: string;
  tone: "warning" | "error";
  taskId?: string;
}

interface RuntimeState {
  agent: RuntimeAgent | null;
  tasks: RuntimeTask[];
  events: RuntimeEvent[];
  selectedTaskId: string | null;
  selectedTaskTimeline: RuntimeTaskTimelineResponse | null;
  taskTimelineLoading: boolean;
  taskTimelineError: string | null;
  loading: boolean;
  error: string | null;
  polling: boolean;
  pollingAgentId: string;

  fetchRuntimeSnapshot: (agentId?: string) => Promise<void>;
  selectTask: (taskId: string) => Promise<void>;
  fetchTaskTimeline: (taskId: string) => Promise<void>;
  clearSelectedTask: () => void;
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

function getNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

export function getTaskStatusDetail(task: RuntimeTask): string | null {
  const progressMessage = task.progress_message?.trim();
  if (task.status === "canceled") {
    if (task.failure_type === "system_canceled") {
      return `系统自动取消${progressMessage ? `：${progressMessage}` : ""}`;
    }
    if (task.failure_type === "user_canceled") {
      return `用户取消${progressMessage ? `：${progressMessage}` : ""}`;
    }
  }
  if (task.status === "failed") {
    const reason = task.failure_type ?? "unknown";
    return `失败原因：${reason}${progressMessage ? ` · ${progressMessage}` : ""}`;
  }
  return progressMessage && task.status !== "completed" ? progressMessage : null;
}

export function getWatchdogNotice(events: RuntimeEvent[]): RuntimeWatchdogNotice | null {
  let canceled = 0;
  let alerted = 0;
  let recovered = 0;
  let repaired = 0;
  let hasP0 = false;
  let taskId: string | null = null;

  for (const event of events) {
    const isWatchdogEvent = event.type.startsWith("task.watchdog.") || event.type === "agent.watchdog.repaired";
    if (!isWatchdogEvent) continue;

    const payload = payloadRecord(event);
    const notificationLevel = getString(payload, "notificationLevel");
    if (notificationLevel !== "P0" && notificationLevel !== "P1") continue;
    hasP0 ||= notificationLevel === "P0";
    taskId ??= event.task_id ?? getString(payload, "taskId") ?? getString(payload, "task_id");

    if (event.type === "task.watchdog.canceled") {
      canceled += 1;
    } else if (event.type === "task.watchdog.recovered") {
      recovered += 1;
    } else if (event.type === "agent.watchdog.repaired") {
      repaired += 1;
    } else if (event.type === "task.watchdog.alerted") {
      const reason = getString(payload, "reason");
      if (reason === "web_queued_stale_batch") {
        canceled += getNumber(payload, "count") ?? 0;
      } else {
        alerted += 1;
      }
    }
  }

  const details: string[] = [];
  if (canceled > 0) details.push(`系统清理了 ${canceled} 个异常任务`);
  if (repaired > 0) details.push(`修复了 ${repaired} 个 Agent 状态`);
  if (recovered > 0) details.push(`恢复了 ${recovered} 个运行任务`);
  if (alerted > 0) details.push(`发现 ${alerted} 个需要关注的任务`);
  if (details.length === 0) return null;

  return taskId
    ? {
        title: "Watchdog 状态提醒",
        detail: details.join("；"),
        tone: hasP0 ? "error" : "warning",
        taskId,
      }
    : {
        title: "Watchdog 状态提醒",
        detail: details.join("；"),
        tone: hasP0 ? "error" : "warning",
      };
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

  if (event.type === "agent.watchdog.repaired") {
    return {
      label: "Watchdog 修复 Agent",
      detail: getString(payload, "reason") ?? getString(payload, "previousCurrentTaskId") ?? event.type,
      tone: "task",
    };
  }

  if (event.type.startsWith("task.watchdog.")) {
    const labels: Record<string, string> = {
      "task.watchdog.detected": "Watchdog 检测任务",
      "task.watchdog.canceled": "Watchdog 取消任务",
      "task.watchdog.recovered": "Watchdog 恢复任务",
      "task.watchdog.alerted": "Watchdog 告警",
    };
    return {
      label: labels[event.type] ?? "Watchdog 事件",
      detail: getString(payload, "reason") ?? getString(payload, "action") ?? event.task_id ?? event.type,
      tone: event.type === "task.watchdog.canceled" || event.type === "task.watchdog.alerted" ? "error" : "task",
    };
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
      "task.plan.updated": "任务计划更新",
      "task.step.updated": "任务步骤更新",
      "task.dependency.added": "任务依赖添加",
      "task.dependency.removed": "任务依赖移除",
      "task.dependency.blocked": "等待依赖",
      "task.child.created": "子任务创建",
      "task.started": "任务开始",
      "task.completed": "任务完成",
    };
    const firstBlocker = Array.isArray(payload.blockers) && payload.blockers[0] && typeof payload.blockers[0] === "object"
      ? getString(payload.blockers[0] as Record<string, unknown>, "taskId")
      : null;
    return {
      label: labels[event.type] ?? "任务事件",
      detail: getDisplayValue(payload, "stepCount")
        ?? getString(payload, "title")
        ?? getString(payload, "dependsOnTaskId")
        ?? firstBlocker
        ?? getString(payload, "childTaskId")
        ?? event.task_id
        ?? event.type,
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
  selectedTaskId: null,
  selectedTaskTimeline: null,
  taskTimelineLoading: false,
  taskTimelineError: null,
  loading: false,
  error: null,
  polling: false,
  pollingAgentId: "default",

  fetchRuntimeSnapshot: async (agentId = "default") => {
    set({ loading: true, error: null });
    const encodedAgentId = encodeURIComponent(agentId);
    try {
      const [agentRes, tasksRes, eventsRes] = await Promise.all([
        fetch(`/api/runtime/agents/${encodedAgentId}`),
        fetch(`/api/runtime/tasks?agentId=${encodedAgentId}`),
        fetch(`/api/runtime/events?agentId=${encodedAgentId}&limit=50`),
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
      const selectedTaskId = get().selectedTaskId;
      if (selectedTaskId) {
        void get().fetchTaskTimeline(selectedTaskId);
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "获取运行状态失败",
      });
    }
  },

  selectTask: async (taskId) => {
    set({ selectedTaskId: taskId });
    await get().fetchTaskTimeline(taskId);
  },

  fetchTaskTimeline: async (taskId) => {
    set({ taskTimelineLoading: true, taskTimelineError: null, selectedTaskTimeline: null });
    try {
      const res = await fetch(`/api/runtime/tasks/${encodeURIComponent(taskId)}/timeline`);
      if (!res.ok) throw new Error("获取任务时间线失败");
      const timeline = await res.json() as RuntimeTaskTimelineResponse;
      set({
        selectedTaskId: taskId,
        selectedTaskTimeline: timeline,
        taskTimelineLoading: false,
        taskTimelineError: null,
      });
    } catch (error) {
      set({
        taskTimelineLoading: false,
        taskTimelineError: error instanceof Error ? error.message : "获取任务时间线失败",
      });
    }
  },

  clearSelectedTask: () => {
    set({
      selectedTaskId: null,
      selectedTaskTimeline: null,
      taskTimelineLoading: false,
      taskTimelineError: null,
    });
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
