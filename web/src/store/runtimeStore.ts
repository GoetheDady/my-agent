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

  fetchRuntimeSnapshot: (agentId?: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  startPolling: (intervalMs?: number, agentId?: string) => void;
  stopPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

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

  if (event.type.startsWith("memory.")) {
    if (event.type === "memory.search") {
      return {
        label: "记忆检索",
        detail: getString(payload, "query") ?? "memory.search",
        tone: "memory",
      };
    }
    if (event.type === "memory.propose") {
      return {
        label: "候选记忆",
        detail: getString(payload, "reason") ?? getString(payload, "memoryId") ?? "memory.propose",
        tone: "memory",
      };
    }
    return {
      label: "记忆更新",
      detail: getString(payload, "reason") ?? getString(payload, "memoryId") ?? event.type,
      tone: "memory",
    };
  }

  if (event.type.startsWith("tool.")) {
    return {
      label: event.type === "tool.result" ? "工具结果" : "工具调用",
      detail: getString(payload, "toolName") ?? getString(payload, "name") ?? event.type,
      tone: "tool",
    };
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

  cancelTask: async (taskId) => {
    const res = await fetch(`/api/runtime/tasks/${taskId}/cancel`, { method: "POST" });
    if (!res.ok) throw new Error("取消任务失败");
    await get().fetchRuntimeSnapshot();
  },

  startPolling: (intervalMs = 2500, agentId = "default") => {
    if (pollTimer) return;
    set({ polling: true });
    get().fetchRuntimeSnapshot(agentId);
    pollTimer = setInterval(() => {
      get().fetchRuntimeSnapshot(agentId);
    }, intervalMs);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ polling: false });
  },
}));
