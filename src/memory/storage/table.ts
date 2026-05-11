import * as lancedb from "@lancedb/lancedb";
import { mkdirSync } from "node:fs";
import { resolve } from "path";
import { getRuntimeDataDir } from "../../core/config";
import type { Memory } from "./types";

export const USER_ID = "default";
export const AGENT_ID = "";
export const BASE_FILTER = "user_id = 'default' AND agent_id = ''";

const TABLE_NAME = "memories";
const EMBEDDING_DIM = 2048;

let db: lancedb.Connection | null = null;
let tbl: lancedb.Table | null = null;

export async function getTable(): Promise<lancedb.Table> {
  // LanceDB 是向量数据库：它把文本对应的 embedding（向量）存起来，
  // 方便用语义相似度查找“意思接近”的记忆，而不只靠关键词。
  if (tbl) return tbl;

  const dataDir = getRuntimeDataDir();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(dataDir, "memories.lancedb");
  db = await lancedb.connect(dbPath);

  const existing = await db.tableNames();
  if (existing.includes(TABLE_NAME)) {
    tbl = await db.openTable(TABLE_NAME);
  } else {
    // LanceDB 不能直接创建完全空表，因此先插入占位行，再立即删除。
    // 这只是建表技巧，不会参与真实记忆查询。
    tbl = await db.createTable(TABLE_NAME, [
      {
        id: "__init__",
        user_id: "__init__",
        agent_id: "",
        memory_type: "fact",
        content: "",
        vector: new Float32Array(EMBEDDING_DIM),
        source_session_id: "",
        source_text: "",
        status: "active",
        confidence: 0,
        created_at: 0,
        updated_at: 0,
        last_accessed_at: 0,
        access_count: 0,
        embedding_model: "embedding-3",
        embedding_dim: EMBEDDING_DIM,
      },
    ]);
    await tbl.delete("id = '__init__'");
  }

  console.log(`[lancedb] 记忆表已就绪: ${dbPath}`);
  return tbl;
}

export function toRecord(m: Memory): Record<string, unknown> {
  return {
    id: m.id,
    user_id: m.user_id,
    agent_id: m.agent_id,
    memory_type: m.memory_type,
    content: m.content,
    vector: new Float32Array(m.embedding),
    source_session_id: m.source_session_id,
    source_text: m.source_text,
    status: m.status,
    confidence: m.confidence,
    created_at: m.created_at,
    updated_at: m.updated_at,
    last_accessed_at: m.last_accessed_at,
    access_count: m.access_count,
    embedding_model: m.embedding_model,
    embedding_dim: m.embedding_dim,
  };
}

export function toMemory(row: Record<string, unknown>): Memory {
  const vec = row.vector;
  const embedding = vec
    ? Array.isArray(vec)
      ? vec
      : Array.from(vec as ArrayLike<number>)
    : [];
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    agent_id: row.agent_id as string,
    memory_type: row.memory_type as string,
    content: row.content as string,
    embedding,
    source_session_id: row.source_session_id as string,
    source_text: row.source_text as string,
    status: row.status as string,
    confidence: row.confidence as number,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
    last_accessed_at: row.last_accessed_at as number,
    access_count: row.access_count as number,
    embedding_model: row.embedding_model as string,
    embedding_dim: row.embedding_dim as number,
  };
}
