import { Database } from "bun:sqlite";
import * as lancedb from "@lancedb/lancedb";
import { resolve } from "path";

interface OldMemory {
  id: string;
  user_id: string;
  agent_id: string;
  memory_type: string;
  content: string;
  embedding: string;
  source_session_id: string;
  source_text: string;
  status: string;
  confidence: number;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  access_count: number;
  embedding_model: string;
  embedding_dim: number;
}

async function migrate() {
  const dbPath = resolve(import.meta.dir, "../data/agent.sqlite");
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    console.log("[migrate] SQLite 文件不存在或无法读取，跳过迁移");
    return;
  }

  let rows: OldMemory[];
  try {
    rows = db.query("SELECT * FROM memories").all() as OldMemory[];
  } catch {
    console.log("[migrate] memories 表不存在，跳过迁移");
    db.close();
    return;
  }

  console.log(`[migrate] 找到 ${rows.length} 条记忆`);

  if (rows.length === 0) {
    console.log("[migrate] 无需迁移");
    db.close();
    return;
  }

  const lancePath = resolve(import.meta.dir, "../data/memories.lancedb");
  const conn = await lancedb.connect(lancePath);

  const records = rows.map(row => {
    let embedding: number[] = [];
    try { embedding = JSON.parse(row.embedding); } catch { /* skip */ }
    return {
      id: row.id,
      user_id: row.user_id,
      agent_id: row.agent_id,
      memory_type: row.memory_type,
      content: row.content,
      vector: new Float32Array(embedding),
      source_session_id: row.source_session_id,
      source_text: row.source_text,
      status: row.status,
      confidence: row.confidence,
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_accessed_at: row.last_accessed_at,
      access_count: row.access_count,
      embedding_model: row.embedding_model,
      embedding_dim: row.embedding_dim,
    };
  }).filter(r => r.vector.length > 0);

  const existingTables = await conn.tableNames();
  if (existingTables.includes("memories")) {
    await conn.dropTable("memories");
  }

  await conn.createTable("memories", records);
  console.log(`[migrate] 迁移完成: ${records.length} 条记忆已写入 LanceDB`);

  db.close();
}

migrate().catch(err => {
  console.error("[migrate] 失败:", err);
  process.exit(1);
});
