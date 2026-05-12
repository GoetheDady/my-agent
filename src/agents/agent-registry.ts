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

/**
 * 确保默认 Agent 存在。
 *
 * 启动阶段会调用这个方法初始化 `default` Agent。
 * 多 Agent 的完整创建、文件初始化和配置同步由 `AgentService` 负责。
 *
 * @param database 可选数据库连接，测试中可传入内存数据库。
 * @returns 已存在或刚创建的默认 Agent 记录。
 */
export function ensureDefaultAgent(database: Database = getDb()): AgentRecord {
  // default agent 是系统启动的保底 Agent。这里保持轻量初始化，避免测试环境
  // 只为了建表就写入 profile/agent.json 文件；完整 Agent 创建由 AgentService 负责。
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

/**
 * 读取指定 Agent 的当前状态。
 *
 * @param agentId Agent 标识，例如 `default`。
 * @param database 可选数据库连接。
 * @returns 找到时返回 Agent 记录，否则返回 `null`。
 */
export function getAgent(agentId: string, database: Database = getDb()): AgentRecord | null {
  return readAgent(database, agentId);
}

/**
 * 更新 Agent 的运行状态和当前任务。
 *
 * 这个方法是单 Agent 单线程约束的核心：当状态为 `running` 且存在
 * `currentTaskId` 时，任务队列不会再给该 Agent 派发新任务。
 *
 * @param agentId Agent 标识。
 * @param status 新状态。
 * @param currentTaskId 当前任务 id；传 `null` 表示释放任务；不传则保留旧值。
 * @param database 可选数据库连接。
 * @throws 当 Agent 不存在时抛出错误。
 */
export function updateAgentStatus(
  agentId: string,
  status: AgentStatus,
  currentTaskId?: string | null,
  database: Database = getDb(),
): void {
  // Agent 状态是单线程执行约束的核心：
  // running + current_task_id 表示当前 Agent 被某个 task 占用，队列不会再派新任务给它。
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
