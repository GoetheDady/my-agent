import type { Database } from "bun:sqlite";
import { getAgent, updateAgentStatus } from "../agents/agent-registry";
import { getDb } from "../core/database";
import { getTask } from "./task-store";
import type { TaskRecord } from "./task-types";

export function claimNextTask(agentId: string, database: Database = getDb()): TaskRecord | null {
  const claim = database.transaction(() => {
    const agent = getAgent(agentId, database);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.status === "running") {
      return null;
    }

    const nextTask = database
      .query<TaskRecord, [string]>(
        `SELECT id, agent_id, conversation_id, source_channel, source_user_id, status,
                priority, input, result, error, created_at, started_at, completed_at
         FROM tasks
         WHERE agent_id = ? AND status = 'queued'
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`,
      )
      .get(agentId) ?? null;

    if (!nextTask) {
      return null;
    }

    return claimQueuedTask(nextTask, database);
  });

  return claim();
}

export function claimTask(taskId: string, database: Database = getDb()): TaskRecord | null {
  const claim = database.transaction(() => {
    const task = getTask(taskId, database);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== "queued") {
      return null;
    }

    const agent = getAgent(task.agent_id, database);
    if (!agent) {
      throw new Error(`Agent not found: ${task.agent_id}`);
    }

    if (agent.status === "running") {
      return null;
    }

    return claimQueuedTask(task, database);
  });

  return claim();
}

function claimQueuedTask(task: TaskRecord, database: Database): TaskRecord {
  database
    .query(
      `UPDATE tasks
       SET status = 'running', started_at = ?, error = NULL
       WHERE id = ?`,
    )
    .run(Date.now(), task.id);
  updateAgentStatus(task.agent_id, "running", task.id, database);

  const claimed = getTask(task.id, database);
  if (!claimed) {
    throw new Error(`Task not found after claim: ${task.id}`);
  }
  return claimed;
}
