import * as lancedb from "@lancedb/lancedb";
import { embedText, cosineSimilarity } from "./embedder";
import { resolve } from "path";

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

const USER_ID = "default";
const AGENT_ID = "";
const TABLE_NAME = "memories";
const EMBEDDING_DIM = 2048;

let db: lancedb.Connection | null = null;
let tbl: lancedb.Table | null = null;

async function getTable(): Promise<lancedb.Table> {
  if (tbl) return tbl;

  const dbPath = resolve(import.meta.dir, "../../data/memories.lancedb");
  db = await lancedb.connect(dbPath);

  const existing = await db.tableNames();
  if (existing.includes(TABLE_NAME)) {
    tbl = await db.openTable(TABLE_NAME);
  } else {
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

function toRecord(m: Memory): Record<string, unknown> {
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

function toMemory(row: Record<string, unknown>): Memory {
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

const BASE_FILTER = "user_id = 'default' AND agent_id = ''";

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

  const table = await getTable();
  const id = crypto.randomUUID();
  const now = Date.now();

  const memory: Memory = {
    id, user_id: USER_ID, agent_id: AGENT_ID, memory_type, content, embedding,
    source_session_id, source_text, status: "active", confidence,
    created_at: now, updated_at: now, last_accessed_at: now, access_count: 0,
    embedding_model: "embedding-3", embedding_dim: embedding.length,
  };

  await table.add([toRecord(memory)]);
  return memory;
}

export async function updateMemory(id: string, content: string): Promise<Memory | null> {
  const table = await getTable();
  const rows = await table.query().where(`id = '${id}'`).limit(1).toArray();
  if (rows.length === 0) return null;

  const existing = toMemory(rows[0] as unknown as Record<string, unknown>);
  const embedding = await embedText(content);
  if (embedding.length === 0) return null;

  const now = Date.now();
  const updated: Memory = {
    ...existing,
    content,
    embedding,
    updated_at: now,
    embedding_dim: embedding.length,
  };

  await table.delete(`id = '${id}'`);
  await table.add([toRecord(updated)]);
  return updated;
}

export async function supersedeMemory(oldId: string, _params: {
  content: string;
  memory_type?: string;
  confidence?: number;
}): Promise<void> {
  const table = await getTable();
  const rows = await table.query().where(`id = '${oldId}'`).limit(1).toArray();
  if (rows.length === 0) return;

  const existing = toMemory(rows[0] as unknown as Record<string, unknown>);
  const updated: Memory = { ...existing, status: "superseded", updated_at: Date.now() };

  await table.delete(`id = '${oldId}'`);
  await table.add([toRecord(updated)]);
}

export async function deleteMemory(id: string): Promise<void> {
  const table = await getTable();
  await table.delete(`id = '${id}'`);
}

export async function touchMemory(id: string): Promise<void> {
  const table = await getTable();
  const rows = await table.query().where(`id = '${id}'`).limit(1).toArray();
  if (rows.length === 0) return;

  const existing = toMemory(rows[0] as unknown as Record<string, unknown>);
  const updated: Memory = {
    ...existing,
    last_accessed_at: Date.now(),
    access_count: existing.access_count + 1,
  };

  await table.delete(`id = '${id}'`);
  await table.add([toRecord(updated)]);
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

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-z0-9]/g, " ");
  for (let i = 0; i < cleaned.length - 1; i++) {
    const bigram = cleaned.slice(i, i + 2).trim();
    if (bigram.length === 2 && !/\s/.test(bigram)) {
      tokens.push(bigram);
    }
  }
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  tokens.push(...words);
  return tokens;
}

function tfidfScore(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;
  const docFreq = new Map<string, number>();
  for (const t of docTokens) {
    docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const docLen = docTokens.length;
  let score = 0;
  const matched = new Set<string>();
  for (const qt of queryTokens) {
    const freq = docFreq.get(qt);
    if (freq) {
      matched.add(qt);
      score += (freq / docLen) * (1 / (1 + Math.log(docLen)));
    }
  }
  return matched.size > 0 ? score * (matched.size / queryTokens.length) : 0;
}

const MIN_SIMILARITY = 0.3;
const MIN_FINAL_SCORE = 0.15;
const VECTOR_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;
const MMR_LAMBDA = 0.7;

export async function searchMemories(
  query: string,
  topN: number = 5,
): Promise<Memory[]> {
  const queryEmbedding = await embedText(query);
  if (queryEmbedding.length === 0) return [];

  const table = await getTable();
  const filter = `${BASE_FILTER} AND status = 'active'`;

  const vectorResults = await table
    .search(new Float32Array(queryEmbedding))
    .where(filter)
    .limit(topN * 3)
    .toArray();

  const allRows = await table
    .query()
    .where(filter)
    .limit(5000)
    .toArray();

  const queryTokens = tokenize(query);
  const vectorMap = new Map<string, number>();
  for (const row of vectorResults) {
    const r = row as unknown as Record<string, unknown>;
    const distance = (r._distance as number) ?? 0;
    vectorMap.set(r.id as string, 1 - distance);
  }

  const merged = new Map<string, { mem: Memory; vecScore: number; txtScore: number }>();
  for (const row of allRows) {
    const r = row as unknown as Record<string, unknown>;
    const mem = toMemory(r);
    const vecScore = vectorMap.get(mem.id) ?? 0;
    const docTokens = tokenize(mem.content);
    const txtScore = tfidfScore(queryTokens, docTokens);
    if (vecScore < MIN_SIMILARITY && txtScore < MIN_SIMILARITY) continue;
    merged.set(mem.id, { mem, vecScore, txtScore });
  }
  for (const row of vectorResults) {
    const r = row as unknown as Record<string, unknown>;
    const id = r.id as string;
    if (!merged.has(id)) {
      const distance = (r._distance as number) ?? 0;
      const vecScore = 1 - distance;
      if (vecScore >= MIN_SIMILARITY) {
        merged.set(id, { mem: toMemory(r), vecScore, txtScore: 0 });
      }
    }
  }

  const scored = Array.from(merged.values())
    .map(({ mem, vecScore, txtScore }) => {
      const decay = memoryDecay(mem.memory_type, mem.last_accessed_at);
      const hybridScore = (vecScore * VECTOR_WEIGHT + txtScore * TEXT_WEIGHT) * decay * mem.confidence;
      return { mem, hybridScore };
    })
    .filter(s => s.hybridScore >= MIN_FINAL_SCORE);

  scored.sort((a, b) => b.hybridScore - a.hybridScore);

  const selected: typeof scored = [];
  for (const s of scored) {
    if (selected.length >= topN) break;
    const tooSimilar = selected.some(sel =>
      cosineSimilarity(s.mem.embedding, sel.mem.embedding) > (1 - MMR_LAMBDA)
    );
    if (!tooSimilar || selected.length === 0) {
      selected.push(s);
    } else {
      const maxSim = Math.max(...selected.map(sel =>
        cosineSimilarity(s.mem.embedding, sel.mem.embedding)
      ));
      const mmrScore = MMR_LAMBDA * s.hybridScore - (1 - MMR_LAMBDA) * maxSim;
      if (mmrScore > 0) {
        selected.push(s);
      }
    }
  }

  const top = selected.slice(0, topN);
  const now = Date.now();
  for (const s of top) {
    await touchMemory(s.mem.id);
  }

  return top.map(s => ({
    ...s.mem,
    last_accessed_at: now,
    access_count: s.mem.access_count + 1,
  }));
}

export async function listMemories(params: {
  page?: number;
  pageSize?: number;
  type?: string;
  status?: string;
  search?: string;
}): Promise<{ memories: Memory[]; total: number }> {
  const { page = 1, pageSize = 20, type, status = "active", search } = params;
  const table = await getTable();

  const conditions = [BASE_FILTER];
  if (status) conditions.push(`status = '${status}'`);
  if (type) conditions.push(`memory_type = '${type}'`);
  const whereClause = conditions.join(" AND ");

  let rows;
  if (search) {
    const queryEmb = await embedText(search);
    if (queryEmb.length > 0) {
      rows = await table.search(new Float32Array(queryEmb)).where(whereClause).limit(50).toArray();
    } else {
      rows = await table.query().where(whereClause).limit(100).toArray();
    }
  } else {
    rows = await table.query().where(whereClause).limit(1000).toArray();
  }

  let memories = rows.map(r => toMemory(r as unknown as Record<string, unknown>));
  if (search) {
    const searchLower = search.toLowerCase();
    memories = memories.filter(m =>
      m.content.toLowerCase().includes(searchLower)
      || m.memory_type.toLowerCase().includes(searchLower)
    );
  }

  memories.sort((a, b) => b.created_at - a.created_at);
  const total = memories.length;
  const start = (page - 1) * pageSize;
  memories = memories.slice(start, start + pageSize);

  return { memories, total };
}

export async function getMemory(id: string): Promise<Memory | null> {
  const table = await getTable();
  const rows = await table.query().where(`id = '${id}'`).limit(1).toArray();
  return rows.length > 0 ? toMemory(rows[0] as unknown as Record<string, unknown>) : null;
}

export async function getMemoryStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
}> {
  const table = await getTable();
  const rows = await table.query().where(BASE_FILTER).limit(10000).toArray();

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const row of rows) {
    const r = row as unknown as Record<string, unknown>;
    const t = r.memory_type as string;
    const s = r.status as string;
    byType[t] = (byType[t] ?? 0) + 1;
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }

  return { total: rows.length, byType, byStatus };
}
