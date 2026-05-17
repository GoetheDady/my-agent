import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import {
  getTask,
  TASK_SELECT_COLUMNS,
  taskRowToRecord,
  type TaskRow,
} from "./task-store";
import type { TaskDependencyRecord, TaskRecord, TaskStepRecord, TaskStepStatus } from "./task-types";

export interface TaskPlanStepInput {
  title: string;
  detail?: string;
}

type TaskStepRow = TaskStepRecord;

type TaskDependencyRow = TaskDependencyRecord;

export function setTaskPlan(
  taskId: string,
  steps: TaskPlanStepInput[],
  database: Database = getDb(),
): TaskStepRecord[] {
  const task = requireTask(taskId, database);
  const normalizedSteps = steps.map((step) => ({
    title: normalizeRequiredText(step.title, "步骤标题不能为空。"),
    detail: step.detail?.trim() ?? "",
  }));
  const now = Date.now();

  const write = database.transaction(() => {
    const linkedChildren = database
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count
         FROM task_steps
         WHERE task_id = ? AND child_task_id IS NOT NULL`,
      )
      .get(task.id)?.count ?? 0;
    if (linkedChildren > 0) {
      throw new Error("已有步骤关联子任务，不能直接覆盖计划。");
    }

    database.query("DELETE FROM task_steps WHERE task_id = ?").run(task.id);
    for (const [index, step] of normalizedSteps.entries()) {
      database
        .query(
          `INSERT INTO task_steps (
             id, task_id, step_index, title, detail, status, child_task_id, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
        )
        .run(crypto.randomUUID(), task.id, index, step.title, step.detail, now, now);
    }

    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.plan.updated",
      payload: {
        stepCount: normalizedSteps.length,
        steps: normalizedSteps.map((step, index) => ({
          stepIndex: index,
          title: step.title,
          detail: step.detail,
        })),
      },
      created_at: now,
    }, database);
  });

  write();
  return listTaskSteps(task.id, database);
}

export function listTaskSteps(taskId: string, database: Database = getDb()): TaskStepRecord[] {
  return database
    .query<TaskStepRow, [string]>(
      `SELECT id, task_id, step_index, title, detail, status, child_task_id, created_at, updated_at
       FROM task_steps
       WHERE task_id = ?
       ORDER BY step_index ASC`,
    )
    .all(taskId);
}

export function getTaskStep(stepId: string, database: Database = getDb()): TaskStepRecord | null {
  return database
    .query<TaskStepRow, [string]>(
      `SELECT id, task_id, step_index, title, detail, status, child_task_id, created_at, updated_at
       FROM task_steps
       WHERE id = ?`,
    )
    .get(stepId) ?? null;
}

export function updateTaskStepStatus(
  stepId: string,
  status: TaskStepStatus,
  database: Database = getDb(),
): TaskStepRecord {
  const step = requireTaskStep(stepId, database);
  const task = requireTask(step.task_id, database);
  const now = Date.now();
  database
    .query(
      `UPDATE task_steps
       SET status = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(status, now, step.id);
  const updated = requireTaskStep(step.id, database);
  appendEvent({
    agent_id: task.agent_id,
    task_id: task.id,
    conversation_id: task.conversation_id,
    type: "task.step.updated",
    payload: {
      stepId: updated.id,
      stepIndex: updated.step_index,
      title: updated.title,
      status: updated.status,
      childTaskId: updated.child_task_id,
    },
    created_at: now,
  }, database);
  return updated;
}

export function addTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
  reason = "",
  database: Database = getDb(),
): TaskDependencyRecord {
  const task = getTask(taskId, database);
  if (!task) throw new Error("任务不存在。");
  const dependsOnTask = getTask(dependsOnTaskId, database);
  if (!dependsOnTask) throw new Error("依赖任务不存在。");
  if (task.id === dependsOnTask.id) throw new Error("任务不能依赖自己。");
  if (hasDependencyPath(dependsOnTask.id, task.id, database)) {
    throw new Error("任务依赖不能形成循环。");
  }

  const now = Date.now();
  database
    .query(
      `INSERT INTO task_dependencies (task_id, depends_on_task_id, reason, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(task_id, depends_on_task_id)
       DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at`,
    )
    .run(task.id, dependsOnTask.id, reason.trim(), now);
  appendEvent({
    agent_id: task.agent_id,
    task_id: task.id,
    conversation_id: task.conversation_id,
    type: "task.dependency.added",
    payload: {
      dependsOnTaskId: dependsOnTask.id,
      reason: reason.trim(),
    },
    created_at: now,
  }, database);
  return requireDependency(task.id, dependsOnTask.id, database);
}

export function removeTaskDependency(
  taskId: string,
  dependsOnTaskId: string,
  database: Database = getDb(),
): boolean {
  const task = requireTask(taskId, database);
  const dependency = listTaskDependencies(task.id, database)
    .find((item) => item.depends_on_task_id === dependsOnTaskId);
  const result = database
    .query(
      `DELETE FROM task_dependencies
       WHERE task_id = ? AND depends_on_task_id = ?`,
    )
    .run(task.id, dependsOnTaskId);
  if (result.changes === 0) return false;
  const createdAt = Math.max(Date.now(), (dependency?.created_at ?? 0) + 1);
  appendEvent({
    agent_id: task.agent_id,
    task_id: task.id,
    conversation_id: task.conversation_id,
    type: "task.dependency.removed",
    payload: {
      dependsOnTaskId,
      reason: dependency?.reason ?? "",
    },
    created_at: createdAt,
  }, database);
  return true;
}

export function listTaskDependencies(taskId: string, database: Database = getDb()): TaskDependencyRecord[] {
  return database
    .query<TaskDependencyRow, [string]>(
      `SELECT
         dependency.task_id,
         dependency.depends_on_task_id,
         dependency.reason,
         dependency.created_at,
         task.status AS depends_on_status,
         task.input AS depends_on_input
       FROM task_dependencies dependency
       JOIN tasks task ON task.id = dependency.depends_on_task_id
       WHERE dependency.task_id = ?
       ORDER BY dependency.created_at ASC, dependency.depends_on_task_id ASC`,
    )
    .all(taskId);
}

export function getUnmetTaskDependencies(taskId: string, database: Database = getDb()): TaskDependencyRecord[] {
  return listTaskDependencies(taskId, database)
    .filter((dependency) => dependency.depends_on_status !== "completed");
}

export function listChildTasks(taskId: string, database: Database = getDb()): TaskRecord[] {
  return database
    .query<TaskRow, [string]>(
      `SELECT ${TASK_SELECT_COLUMNS}
       FROM tasks
       WHERE parent_task_id = ?
       ORDER BY created_at ASC`,
    )
    .all(taskId)
    .map(taskRowToRecord);
}

export function taskHasUnmetDependencies(taskId: string, database: Database = getDb()): boolean {
  const row = database
    .query<{ count: number }, [string]>(
      `SELECT COUNT(*) AS count
       FROM task_dependencies dependency
       JOIN tasks task ON task.id = dependency.depends_on_task_id
       WHERE dependency.task_id = ? AND task.status != 'completed'`,
    )
    .get(taskId);
  return (row?.count ?? 0) > 0;
}

function requireTask(taskId: string, database: Database): TaskRecord {
  const task = getTask(taskId, database);
  if (!task) throw new Error("任务不存在。");
  return task;
}

function requireTaskStep(stepId: string, database: Database): TaskStepRecord {
  const step = getTaskStep(stepId, database);
  if (!step) throw new Error("任务步骤不存在。");
  return step;
}

function requireDependency(
  taskId: string,
  dependsOnTaskId: string,
  database: Database,
): TaskDependencyRecord {
  const dependency = listTaskDependencies(taskId, database)
    .find((item) => item.depends_on_task_id === dependsOnTaskId);
  if (!dependency) throw new Error("任务依赖不存在。");
  return dependency;
}

function hasDependencyPath(fromTaskId: string, targetTaskId: string, database: Database): boolean {
  const visited = new Set<string>();
  const stack = [fromTaskId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    if (current === targetTaskId) return true;
    visited.add(current);
    const dependencies = database
      .query<{ depends_on_task_id: string }, [string]>(
        `SELECT depends_on_task_id
         FROM task_dependencies
         WHERE task_id = ?`,
      )
      .all(current);
    stack.push(...dependencies.map((dependency) => dependency.depends_on_task_id));
  }
  return false;
}

function normalizeRequiredText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}
