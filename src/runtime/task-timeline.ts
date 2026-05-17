import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { listTaskEvents } from "../events/event-log";
import type { RuntimeEvent } from "../events/event-types";
import { getEpisodeByTaskId, type EpisodeRecord } from "../memory/episode-store";
import { getTask } from "../tasks/task-store";
import {
  listChildTasks,
  listTaskDependencies,
  listTaskSteps,
} from "../tasks/task-plan-store";
import type { TaskDependencyRecord, TaskRecord, TaskStepRecord } from "../tasks/task-types";

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

export interface RuntimeTaskTimelineResponse {
  task: TaskRecord;
  episode: EpisodeRecord | null;
  current: RuntimeTaskCurrentView;
  plan: {
    steps: TaskStepRecord[];
  };
  dependencies: TaskDependencyRecord[];
  children: TaskRecord[];
  timeline: RuntimeTaskTimelineItem[];
}

export function getTaskTimeline(
  taskId: string,
  database: Database = getDb(),
): RuntimeTaskTimelineResponse | null {
  const task = getTask(taskId, database);
  if (!task) return null;

  const events = listTaskEvents(taskId, database);
  const episode = getEpisodeByTaskId(taskId, database);
  return {
    task,
    episode,
    current: buildCurrentView(task, events),
    plan: {
      steps: listTaskSteps(taskId, database),
    },
    dependencies: listTaskDependencies(taskId, database),
    children: listChildTasks(taskId, database),
    timeline: events.map(toTimelineItem),
  };
}

function buildCurrentView(task: TaskRecord, events: RuntimeEvent[]): RuntimeTaskCurrentView {
  const latestProgress = findLastPayload(events, (event) => event.type === "task.progress.updated");
  const latestToolCall = findLastPayload(events, (event) => event.type === "tool.call");
  const latestToolResult = findLastPayload(events, (event) => event.type === "tool.result");
  const latestAssistant = findLastPayload(events, (event) => event.type === "assistant.message");

  return {
    progressStatus: task.progress_status,
    progressMessage: task.progress_message,
    currentToolName: stringValue(latestProgress?.currentToolName)
      ?? stringValue(latestToolCall?.toolName)
      ?? stringValue(latestToolResult?.toolName),
    currentToolCallId: stringValue(latestProgress?.currentToolCallId)
      ?? stringValue(latestToolCall?.toolCallId)
      ?? stringValue(latestToolResult?.toolCallId),
    recentOutput: stringValue(latestProgress?.recentOutput)
      ?? stringValue(latestAssistant?.text)
      ?? stringValue(latestToolResult?.outputPreview)
      ?? stringValue(latestToolResult?.error)
      ?? task.result
      ?? task.error,
    failureType: task.failure_type,
    failureStage: task.failure_stage,
    retriable: task.retriable,
    leaseExpiresAt: task.lease_expires_at,
    lastProgressAt: task.last_progress_at,
  };
}

function toTimelineItem(event: RuntimeEvent): RuntimeTaskTimelineItem {
  const payload = parsePayload(event.payload);
  return {
    id: event.id,
    eventId: event.id,
    kind: eventKind(event),
    tone: eventTone(event, payload),
    title: eventTitle(event),
    detail: eventDetail(event, payload),
    createdAt: event.created_at,
    payloadJson: payload,
  };
}

function eventKind(event: RuntimeEvent): RuntimeTaskTimelineKind {
  if (event.type === "task.progress.updated") return "progress";
  if (event.type.startsWith("task.watchdog.")) return "watchdog";
  if (event.type.startsWith("task.")) return "task";
  if (event.type.startsWith("tool.approval.")) return "approval";
  if (event.type.startsWith("tool.")) return "tool";
  if (event.type.startsWith("assistant.")) return "assistant";
  if (event.type.startsWith("memory.")) return "memory";
  if (event.type.startsWith("episode.")) return "episode";
  if (event.type.startsWith("channel.")) return "channel";
  if (event.type.startsWith("agent.")) return "agent";
  return "other";
}

function eventTone(event: RuntimeEvent, payload: Record<string, unknown>): RuntimeTaskTimelineTone {
  if (
    event.type.includes("failed") ||
    event.type.includes("denied") ||
    event.type.includes("canceled") ||
    payload.success === false
  ) {
    return "error";
  }
  if (
    event.type.includes("alerted") ||
    event.type.includes("approval.created") ||
    event.type.includes("retry_scheduled") ||
    event.type.includes("recovered")
  ) {
    return "warning";
  }
  if (
    event.type.includes("completed") ||
    event.type.includes("approved") ||
    event.type === "tool.result" ||
    event.type === "episode.created" ||
    event.type === "episode.updated"
  ) {
    return "success";
  }
  return "info";
}

function eventTitle(event: RuntimeEvent): string {
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
    "task.failed": "任务失败",
    "task.failed.classified": "失败分类",
    "task.progress.updated": "任务进度",
    "task.cancel.requested": "请求取消",
    "task.cancel.rejected": "取消被拒绝",
    "task.canceled": "任务取消",
    "task.recovered": "任务恢复",
    "task.retry_scheduled": "任务重试排队",
    "task.failed_permanently": "任务永久失败",
    "task.lease.renewed": "租约续期",
    "task.watchdog.detected": "Watchdog 检测",
    "task.watchdog.canceled": "Watchdog 取消",
    "task.watchdog.recovered": "Watchdog 恢复",
    "task.watchdog.alerted": "Watchdog 告警",
    "tool.call": "工具调用",
    "tool.result": "工具结果",
    "tool.approval.created": "工具审批创建",
    "tool.approval.approved": "工具审批批准",
    "tool.approval.denied": "工具审批拒绝",
    "assistant.delta": "助手增量",
    "assistant.message": "助手回复",
    "episode.created": "经历记录创建",
    "episode.updated": "经历记录更新",
    "episode.failed": "经历记录失败",
    "channel.delivery.completed": "渠道投递完成",
    "channel.delivery.failed": "渠道投递失败",
    "agent.watchdog.repaired": "Agent 状态修复",
  };
  return labels[event.type] ?? event.type;
}

function eventDetail(event: RuntimeEvent, payload: Record<string, unknown>): string {
  return stringValue(payload.progressMessage)
    ?? stringValue(payload.title)
    ?? stringValue(payload.dependsOnTaskId)
    ?? stringValue(payload.childTaskId)
    ?? stringValue(payload.toolName)
    ?? stringValue(payload.reason)
    ?? stringValue(payload.error)
    ?? stringValue(payload.text)
    ?? stringValue(payload.result)
    ?? stringValue(payload.episodeId)
    ?? event.type;
}

function findLastPayload(
  events: RuntimeEvent[],
  predicate: (event: RuntimeEvent) => boolean,
): Record<string, unknown> | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return parsePayload(events[index].payload);
  }
  return null;
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
