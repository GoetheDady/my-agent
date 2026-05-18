import type { ModelMessage } from "ai";
import type { DelegationRecord } from "../delegations/types";
import type { EpisodeRecord } from "../memory/episode-store";
import type { TaskRecord, TaskStepRecord } from "../tasks/task-types";

export const TASK_CONTEXT_BUDGETS = {
  profileFile: 4_000,
  skillIndex: 4_000,
  workingMemoryValue: 1_000,
  parentInput: 1_200,
  stepTitle: 160,
  stepDetail: 260,
  childInput: 500,
  childResult: 800,
  childError: 600,
  episodeSummary: 700,
  maxSteps: 24,
  maxChildren: 16,
} as const;

const TRUNCATED_MARK = "（已按上下文预算截断）";

export interface TaskContextChildSummary {
  childTaskId: string;
  agentId: string;
  status: TaskRecord["status"];
  planStepId: string | null;
  inputPreview: string;
  resultPreview: string;
  errorPreview: string | null;
  delegationId: string | null;
  callbackTaskId: string | null;
}

export interface TaskContextSummary {
  parentTaskId: string;
  parentInputPreview: string;
  planLines: string[];
  childSummaries: TaskContextChildSummary[];
  episodeLine: string | null;
}

export interface BuildTaskContextSummaryInput {
  parentTask: TaskRecord;
  steps?: TaskStepRecord[];
  childTasks?: TaskRecord[];
  delegations?: DelegationRecord[];
  episode?: EpisodeRecord | null;
}

export function previewTaskText(value: string | null | undefined, maxLength = 240): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...${TRUNCATED_MARK}`;
}

export function limitPromptText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}\n${TRUNCATED_MARK}`;
}

export function buildTaskContextSummary(input: BuildTaskContextSummaryInput): TaskContextSummary {
  const steps = [...(input.steps ?? [])].sort((a, b) => a.step_index - b.step_index).slice(0, TASK_CONTEXT_BUDGETS.maxSteps);
  const delegations = input.delegations ?? [];
  const childSummaries = [...(input.childTasks ?? [])]
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
    .slice(0, TASK_CONTEXT_BUDGETS.maxChildren)
    .map((child) => {
      const delegation = delegations.find((item) => item.child_task_id === child.id) ?? null;
      const resultPreview = previewTaskText(child.result, TASK_CONTEXT_BUDGETS.childResult)
        ?? previewTaskText(delegation?.result, TASK_CONTEXT_BUDGETS.childResult)
        ?? "无结果文本";
      return {
        childTaskId: child.id,
        agentId: child.agent_id,
        status: child.status,
        planStepId: child.plan_step_id,
        inputPreview: previewTaskText(child.input, TASK_CONTEXT_BUDGETS.childInput) ?? "无输入文本",
        resultPreview,
        errorPreview: previewTaskText(child.error, TASK_CONTEXT_BUDGETS.childError)
          ?? previewTaskText(delegation?.error, TASK_CONTEXT_BUDGETS.childError),
        delegationId: delegation?.id ?? null,
        callbackTaskId: delegation?.callback_task_id ?? null,
      };
    });

  const planLines = steps.map((step) => {
    const title = previewTaskText(step.title, TASK_CONTEXT_BUDGETS.stepTitle) ?? "未命名步骤";
    const detail = previewTaskText(step.detail, TASK_CONTEXT_BUDGETS.stepDetail);
    return `- [${step.status}] ${step.step_index + 1}. ${title}${detail ? `：${detail}` : ""} -> ${step.child_task_id ?? "无子任务"}`;
  });

  const episodeLine = input.episode
    ? previewTaskText([
      input.episode.title,
      input.episode.outcome,
      input.episode.summary,
    ].filter(Boolean).join("；"), TASK_CONTEXT_BUDGETS.episodeSummary)
    : null;

  return {
    parentTaskId: input.parentTask.id,
    parentInputPreview: previewTaskText(input.parentTask.input, TASK_CONTEXT_BUDGETS.parentInput) ?? "无父任务输入",
    planLines,
    childSummaries,
    episodeLine,
  };
}

export function buildSummaryTaskMessages(input: BuildTaskContextSummaryInput): ModelMessage[] {
  const summary = buildTaskContextSummary(input);
  const planLines = summary.planLines.length > 0
    ? summary.planLines.join("\n")
    : "无结构化步骤。";
  const childLines = summary.childSummaries.length > 0
    ? summary.childSummaries.map((child) => [
      `- child_task_id: ${child.childTaskId}`,
      `  agent: ${child.agentId}`,
      `  status: ${child.status}`,
      `  plan_step_id: ${child.planStepId ?? "none"}`,
      `  input: ${child.inputPreview}`,
      `  result: ${child.resultPreview}`,
      child.errorPreview ? `  error: ${child.errorPreview}` : "",
      child.delegationId
        ? `  delegation_id: ${child.delegationId}; callback_task_id: ${child.callbackTaskId ?? "none"}`
        : "",
    ].filter(Boolean).join("\n")).join("\n\n")
    : "无子任务。";
  const episodeLine = summary.episodeLine ? `\n已有经历摘要：\n${summary.episodeLine}\n` : "";

  return [{
    role: "user",
    content: [{
      type: "text",
      text: [
        "你正在为一个已拆分执行的父任务做最终汇总。",
        "请基于下面的结构化任务上下文输出用户能直接理解的最终结论。",
        "这些内容已经按上下文预算截断：保留子任务状态、关键结果和失败摘要，不包含完整事件流水。",
        "需要说明哪些子任务完成、哪些失败或取消，以及最终可交付结果。不要继续委派，也不要创建新的子任务。",
        "",
        `父任务 id：${summary.parentTaskId}`,
        `父任务：${summary.parentInputPreview}`,
        episodeLine.trimEnd(),
        "",
        "计划步骤：",
        planLines,
        "",
        "直接子任务：",
        childLines,
      ].filter((line) => line !== "").join("\n"),
    }],
  }];
}
