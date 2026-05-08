import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import type { AgentRecord, AgentStatus } from "./agent-types";

const DEFAULT_AGENT_ID = "default";
const DEFAULT_AGENT_NAME = "Default Agent";

function readAgent(database: Database, agentId: string): AgentRecord | null {
  return database
    .query<AgentRecord, [string]>(
      `SELECT id, name, status, current_task_id, workspace_path, created_at, updated_at
       FROM agents
       WHERE id = ?`,
    )
    .get(agentId) ?? null;
}

export function ensureDefaultAgent(database: Database = getDb()): AgentRecord {
  const existing = readAgent(database, DEFAULT_AGENT_ID);
  if (existing) return existing;

  const now = Date.now();
  database
    .query(
      `INSERT INTO agents (id, name, status, current_task_id, workspace_path, created_at, updated_at)
       VALUES (?, ?, 'idle', NULL, '', ?, ?)`,
    )
    .run(DEFAULT_AGENT_ID, DEFAULT_AGENT_NAME, now, now);

  const created = readAgent(database, DEFAULT_AGENT_ID);
  if (!created) {
    throw new Error("Failed to create default agent");
  }

  return created;
}

export function getAgent(agentId: string, database: Database = getDb()): AgentRecord | null {
  return readAgent(database, agentId);
}

export function updateAgentStatus(
  agentId: string,
  status: AgentStatus,
  currentTaskId?: string | null,
  database: Database = getDb(),
): void {
  const existing = readAgent(database, agentId);
  if (!existing) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  const nextCurrentTaskId = currentTaskId === undefined ? existing.current_task_id : currentTaskId;
  database
    .query(
      `UPDATE agents
       SET status = ?, current_task_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(status, nextCurrentTaskId, Date.now(), agentId);
}
