import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";

type WorkingMemoryRow = {
  key: string;
  value: string;
};

/**
 * 写入或更新当前 task 的工作记忆。
 *
 * 工作记忆是 task 级临时状态，不会自动进入长期记忆。
 *
 * @param agentId Agent 标识。
 * @param taskId 任务 id。
 * @param key 工作记忆键。
 * @param value 可 JSON 序列化的值。
 * @param database 可选数据库连接。
 */
export function setWorkingMemory(
  agentId: string,
  taskId: string,
  key: string,
  value: unknown,
  database: Database = getDb(),
): void {
  // Working Memory 是当前 task 内的临时状态，不等于长期记忆。
  // 例如中间步骤、临时判断可以放这里，任务结束后可清理。
  database
    .query(
      `INSERT INTO working_memory (agent_id, task_id, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, task_id, key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(agentId, taskId, key, JSON.stringify(value), Date.now());
}

/**
 * 读取当前 task 的某条工作记忆。
 *
 * @param agentId Agent 标识。
 * @param taskId 任务 id。
 * @param key 工作记忆键。
 * @param database 可选数据库连接。
 * @returns 找到时返回反序列化后的值，否则返回 `null`。
 */
export function getWorkingMemory<T>(
  agentId: string,
  taskId: string,
  key: string,
  database: Database = getDb(),
): T | null {
  const row = database
    .query<WorkingMemoryRow, [string, string, string]>(
      `SELECT key, value
       FROM working_memory
       WHERE agent_id = ? AND task_id = ? AND key = ?`,
    )
    .get(agentId, taskId, key);

  if (!row) return null;
  return JSON.parse(row.value) as T;
}

/**
 * 列出当前 task 的全部工作记忆。
 *
 * @param agentId Agent 标识。
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 * @returns 以 key/value 形式返回的工作记忆对象。
 */
export function listWorkingMemory(
  agentId: string,
  taskId: string,
  database: Database = getDb(),
): Record<string, unknown> {
  const rows = database
    .query<WorkingMemoryRow, [string, string]>(
      `SELECT key, value
       FROM working_memory
       WHERE agent_id = ? AND task_id = ?
       ORDER BY key ASC`,
    )
    .all(agentId, taskId);

  return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value) as unknown]));
}

/**
 * 清理当前 task 的全部工作记忆。
 *
 * @param agentId Agent 标识。
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 */
export function clearWorkingMemory(
  agentId: string,
  taskId: string,
  database: Database = getDb(),
): void {
  // 清理当前 task 的临时状态，避免下一次任务误读旧的中间变量。
  database
    .query(
      `DELETE FROM working_memory
       WHERE agent_id = ? AND task_id = ?`,
    )
    .run(agentId, taskId);
}
