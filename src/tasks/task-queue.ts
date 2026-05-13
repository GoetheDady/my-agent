import type { Database } from "bun:sqlite";
import { getAgent, updateAgentStatus } from "../agents/agent-registry";
import { getDb } from "../core/database";
import { defaultRealtimeService } from "../realtime/service";
import { getTask } from "./task-store";
import type { TaskRecord } from "./task-types";

/**
 * 任务队列的核心约束：同一个 Agent 同时只能运行一个 task。
 *
 * 这里使用 SQLite transaction 把“检查 Agent 是否空闲”和“领取任务”合成一个原子操作。
 * 这样即使后续接入多个 channel，也不会出现同一 Agent 并发处理两个任务的问题。
 */
/**
 * 为指定 Agent 领取下一条可执行任务。
 *
 * 领取过程在数据库事务中完成：只有 Agent 处于 idle 时才会把最高优先级、
 * 最早创建的 queued task 切换成 running。
 *
 * @param agentId 要领取任务的 Agent 标识。
 * @param database 可选数据库连接。
 * @returns 成功领取时返回任务记录；Agent 忙或无任务时返回 `null`。
 */
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

    // 队列顺序：priority 高的优先；同优先级下创建更早的先执行。
    return claimQueuedTask(nextTask, database);
  });

  return claim();
}

/**
 * 为指定 Agent 领取下一条来自指定渠道的任务。
 *
 * 外部渠道（例如飞书）需要后台队列自动续跑，但 Web task 依赖 HTTP stream，
 * 不能被外部渠道 runner 误领取，所以这里额外限制 source_channel。
 *
 * @param agentId 要领取任务的 Agent 标识。
 * @param sourceChannels 允许领取的渠道列表。
 * @param database 可选数据库连接。
 * @returns 成功领取时返回任务记录；Agent 忙、无任务或渠道列表为空时返回 `null`。
 */
export function claimNextTaskForChannels(
  agentId: string,
  sourceChannels: string[],
  database: Database = getDb(),
): TaskRecord | null {
  if (sourceChannels.length === 0) return null;

  const claim = database.transaction(() => {
    const agent = getAgent(agentId, database);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.status === "running") {
      return null;
    }

    const placeholders = sourceChannels.map(() => "?").join(", ");
    const nextTask = database
      .query<TaskRecord, [string, ...string[]]>(
        `SELECT id, agent_id, conversation_id, source_channel, source_user_id, status,
                priority, input, result, error, created_at, started_at, completed_at
         FROM tasks
         WHERE agent_id = ? AND status = 'queued' AND source_channel IN (${placeholders})
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`,
      )
      .get(agentId, ...sourceChannels) ?? null;

    if (!nextTask) {
      return null;
    }

    return claimQueuedTask(nextTask, database);
  });

  return claim();
}

/**
 * 按指定 taskId 领取任务。
 *
 * 这个方法用于 Web 请求已经创建好 task 后立即启动执行。
 * 它同样会检查 Agent 是否空闲，保证同一个 Agent 同一时间只跑一个任务。
 *
 * @param taskId 要领取的任务 id。
 * @param database 可选数据库连接。
 * @returns 成功领取时返回任务记录；任务不存在、不是 queued 或 Agent 忙时返回 `null`。
 */
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
  // task.status 和 agent.status 必须一起更新，二者共同表达“Agent 当前被哪个任务占用”。
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
  defaultRealtimeService.broadcast({
    type: "runtime.task.updated",
    agentId: claimed.agent_id,
    taskId: claimed.id,
    payload: { task: claimed },
    createdAt: Date.now(),
  });
  return claimed;
}
