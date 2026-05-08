import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";

type WorkingMemoryRow = {
  key: string;
  value: string;
};

export function setWorkingMemory(
  agentId: string,
  taskId: string,
  key: string,
  value: unknown,
  database: Database = getDb(),
): void {
  database
    .query(
      `INSERT INTO working_memory (agent_id, task_id, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, task_id, key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(agentId, taskId, key, JSON.stringify(value), Date.now());
}

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

export function clearWorkingMemory(
  agentId: string,
  taskId: string,
  database: Database = getDb(),
): void {
  database
    .query(
      `DELETE FROM working_memory
       WHERE agent_id = ? AND task_id = ?`,
    )
    .run(agentId, taskId);
}
