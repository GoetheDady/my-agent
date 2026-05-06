import { getDb } from "../core/database";
import { embedText, cosineSimilarity } from "./embedder";

export interface Memory {
  id: string;
  user_id: string;
  agent_id: string;
  memory_type: string;
  content: string;
  embedding: number[];
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

type MemoryRow = Omit<Memory, "embedding"> & { embedding: string };

const USER_ID = "default";
const AGENT_ID = "";

export async function addMemory(params: {
  content: string;
  memory_type?: string;
  source_session_id?: string;
  source_text?: string;
  confidence?: number;
}): Promise<Memory | null> {
  const { content, memory_type = "fact", source_session_id = "", source_text = "", confidence = 1.0 } = params;
  const embedding = await embedText(content);
  if (embedding.length === 0) return null;

  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();

  db.run(
    `INSERT INTO memories (id, user_id, agent_id, memory_type, content, embedding, source_session_id, source_text, confidence, created_at, updated_at, last_accessed_at, embedding_model, embedding_dim)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, USER_ID, AGENT_ID, memory_type, content, JSON.stringify(embedding), source_session_id, source_text, confidence, now, now, now, "embedding-3", embedding.length],
  );

  return {
    id, user_id: USER_ID, agent_id: AGENT_ID, memory_type, content, embedding,
    source_session_id, source_text, status: "active", confidence,
    created_at: now, updated_at: now, last_accessed_at: now, access_count: 0,
    embedding_model: "embedding-3", embedding_dim: embedding.length,
  };
}

export async function updateMemory(id: string, content: string): Promise<Memory | null> {
  const embedding = await embedText(content);
  if (embedding.length === 0) return null;

  const db = getDb();
  const row = db.query("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow | null;
  if (!row) return null;

  const now = Date.now();
  db.run(
    "UPDATE memories SET content = ?, embedding = ?, embedding_dim = ?, updated_at = ? WHERE id = ?",
    [content, JSON.stringify(embedding), embedding.length, now, id],
  );

  return { ...row, embedding, content, updated_at: now, embedding_dim: embedding.length };
}

export function supersedeMemory(oldId: string, _params: {
  content: string;
  memory_type?: string;
  confidence?: number;
}): void {
  const db = getDb();
  db.run("UPDATE memories SET status = ? WHERE id = ?", ["superseded", oldId]);
}

export function deleteMemory(id: string): void {
  const db = getDb();
  db.run("DELETE FROM memories WHERE id = ?", [id]);
}

export function touchMemory(id: string): void {
  const db = getDb();
  db.run(
    "UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
    [Date.now(), id],
  );
}

function memoryDecay(memory_type: string, lastAccessedAt: number): number {
  const days = (Date.now() - lastAccessedAt) / (1000 * 60 * 60 * 24);
  switch (memory_type) {
    case "fact":       return 1.0;
    case "project":    return 0.5 ** (days / 90);
    case "preference": return 0.5 ** (days / 30);
    case "lesson":     return 0.5 ** (days / 14);
    default:           return 0.5 ** (days / 30);
  }
}

const MIN_SIMILARITY = 0.3;
const MIN_FINAL_SCORE = 0.15;

export async function searchMemories(
  query: string,
  topN: number = 5,
): Promise<Memory[]> {
  const queryEmbedding = await embedText(query);
  if (queryEmbedding.length === 0) return [];

  const db = getDb();
  const rows = db.query(
    "SELECT * FROM memories WHERE status = ? AND user_id = ? AND agent_id = ?",
  ).all("active", USER_ID, AGENT_ID) as MemoryRow[];

  const scored = rows
    .map((row) => {
      let emb: number[] = [];
      try { emb = JSON.parse(row.embedding); } catch { /* ignore parse errors */ }
      const similarity = cosineSimilarity(queryEmbedding, emb);
      return { ...row, embedding: emb, similarity };
    })
    .filter((m) => m.similarity >= MIN_SIMILARITY)
    .map((m) => {
      const decay = memoryDecay(m.memory_type, m.last_accessed_at);
      const finalScore = m.similarity * decay * m.confidence;
      return { ...m, finalScore, decay };
    })
    .filter((m) => m.finalScore >= MIN_FINAL_SCORE);

  scored.sort((a, b) => b.finalScore - a.finalScore);

  const deduped: typeof scored = [];
  for (const m of scored) {
    const dup = deduped.find((d) => cosineSimilarity(m.embedding, d.embedding) > 0.95);
    if (!dup) deduped.push(m);
  }

  const top = deduped.slice(0, topN);

  for (const m of top) {
    touchMemory(m.id);
  }

  return top.map((m) => ({
    id: m.id, user_id: m.user_id, agent_id: m.agent_id,
    memory_type: m.memory_type, content: m.content,
    embedding: m.embedding, source_session_id: m.source_session_id,
    source_text: m.source_text, status: m.status,
    confidence: m.confidence, created_at: m.created_at,
    updated_at: m.updated_at, last_accessed_at: m.last_accessed_at,
    access_count: m.access_count, embedding_model: m.embedding_model,
    embedding_dim: m.embedding_dim,
  }));
}
