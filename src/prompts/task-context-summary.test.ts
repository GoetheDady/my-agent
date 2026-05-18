import { describe, expect, test } from "bun:test";
import type { DelegationRecord } from "../delegations/types";
import type { TaskRecord, TaskStepRecord } from "../tasks/task-types";
import {
  TASK_CONTEXT_BUDGETS,
  buildSummaryTaskMessages,
  buildTaskContextSummary,
  previewTaskText,
} from "./task-context-summary";

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "task-1",
    agent_id: "default",
    parent_task_id: null,
    plan_step_id: null,
    conversation_id: "conversation-1",
    source_channel: "web",
    source_user_id: "default",
    status: "queued",
    priority: 0,
    input: "父任务输入",
    result: null,
    error: null,
    created_at: 1,
    started_at: null,
    completed_at: null,
    attempt_count: 0,
    max_attempts: 3,
    lease_expires_at: null,
    idempotency_key: null,
    canceled_at: null,
    failure_type: null,
    failure_stage: null,
    retriable: null,
    progress_status: "waiting",
    progress_message: "",
    last_progress_at: 1,
    ...overrides,
  };
}

function step(overrides: Partial<TaskStepRecord>): TaskStepRecord {
  return {
    id: "step-1",
    task_id: "parent",
    step_index: 0,
    title: "研究实现",
    detail: "读取源码并总结",
    status: "completed",
    child_task_id: "child-1",
    created_at: 1,
    updated_at: 2,
    ...overrides,
  };
}

function delegation(overrides: Partial<DelegationRecord>): DelegationRecord {
  return {
    id: "delegation-1",
    parent_session_id: null,
    parent_agent_id: "default",
    parent_task_id: "parent",
    parent_conversation_id: "conversation-1",
    callback_task_id: "callback-1",
    child_agent_id: "researcher",
    child_task_id: "child-1",
    source_channel: "web",
    source_user_id: "default",
    source_metadata: "{}",
    instruction: "研究实现",
    status: "completed",
    result: null,
    error: null,
    created_at: 1,
    completed_at: 2,
    ...overrides,
  };
}

describe("task context summary", () => {
  test("builds bounded child summaries for parent summary tasks", () => {
    const tail = "RAW_RESULT_TAIL_SHOULD_NOT_APPEAR";
    const parent = task({ id: "parent", input: "请拆分后汇总" });
    const child = task({
      id: "child-1",
      agent_id: "researcher",
      parent_task_id: parent.id,
      status: "completed",
      input: "研究实现",
      result: `关键结论：可以复用现有服务。${"x".repeat(TASK_CONTEXT_BUDGETS.childResult + 100)} ${tail}`,
    });

    const summary = buildTaskContextSummary({
      parentTask: parent,
      steps: [step({ task_id: parent.id, child_task_id: child.id })],
      childTasks: [child],
      delegations: [delegation({ parent_task_id: parent.id, child_task_id: child.id })],
    });

    expect(summary.childSummaries).toHaveLength(1);
    expect(summary.childSummaries[0].resultPreview).toContain("关键结论");
    expect(summary.childSummaries[0].resultPreview).not.toContain(tail);
    expect(summary.childSummaries[0].resultPreview.length).toBeLessThanOrEqual(TASK_CONTEXT_BUDGETS.childResult + 32);
    expect(summary.planLines[0]).toContain("研究实现");
  });

  test("keeps failed child error previews even when result text is empty", () => {
    const parent = task({ id: "parent", input: "请拆分后汇总" });
    const child = task({
      id: "child-failed",
      agent_id: "researcher",
      parent_task_id: parent.id,
      status: "failed",
      input: "研究失败点",
      result: "",
      error: "模型调用失败：context window exceeded",
    });

    const summary = buildTaskContextSummary({
      parentTask: parent,
      steps: [],
      childTasks: [child],
      delegations: [delegation({
        id: "delegation-failed",
        child_task_id: child.id,
        status: "failed",
        result: null,
        error: "delegation error fallback",
      })],
    });

    expect(summary.childSummaries[0]).toMatchObject({
      childTaskId: child.id,
      status: "failed",
      resultPreview: "无结果文本",
      errorPreview: "模型调用失败：context window exceeded",
    });
  });

  test("summary task messages use structured context and omit raw event stream noise", () => {
    const noisyTail = "EVENT_STREAM_NOISE_SHOULD_NOT_APPEAR";
    const parent = task({ id: "parent", input: "父任务" });
    const child = task({
      id: "child-1",
      agent_id: "researcher",
      parent_task_id: parent.id,
      status: "completed",
      input: "子任务",
      result: `结果摘要：完成。${"e".repeat(TASK_CONTEXT_BUDGETS.childResult + 100)} ${noisyTail}`,
    });

    const [message] = buildSummaryTaskMessages({
      parentTask: parent,
      steps: [step({ task_id: parent.id, child_task_id: child.id })],
      childTasks: [child],
      delegations: [delegation({ child_task_id: child.id })],
    });
    const text = Array.isArray(message.content) && message.content[0]?.type === "text"
      ? message.content[0].text
      : "";

    expect(text).toContain("结构化任务上下文");
    expect(text).toContain("child_task_id: child-1");
    expect(text).toContain("callback_task_id: callback-1");
    expect(text).toContain("结果摘要");
    expect(text).not.toContain(noisyTail);
    expect(text).not.toContain("source_event_ids");
  });

  test("previewTaskText returns null for blank text and marks truncation", () => {
    expect(previewTaskText("   ")).toBeNull();
    const preview = previewTaskText(`abc ${"x".repeat(100)}`, 12);
    expect(preview).toContain("已按上下文预算截断");
  });
});
