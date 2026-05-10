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

export interface MemorySnapshotRestore {
  id: string;
  content: string;
  memory_type: string;
  status: string;
  confidence: number;
  updated_at?: number;
}

const USER_ID = "default";
const AGENT_ID = "";
const TABLE_NAME = "memories";
const EMBEDDING_DIM = 2048;

let db: lancedb.Connection | null = null;
let tbl: lancedb.Table | null = null;

async function getTable(): Promise<lancedb.Table> {
  // LanceDB 是向量数据库：它把文本对应的 embedding（向量）存起来，
  // 方便用语义相似度查找“意思接近”的记忆，而不只靠关键词。
  if (tbl) return tbl;

  const dbPath = resolve(import.meta.dir, "../../data/memories.lancedb");
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

/**
 * 新增一条长期记忆。
 *
 * 方法会调用 embedding 服务生成向量，并把记忆写入 LanceDB。
 *
 * @param params 记忆内容、类型、来源 session/source text、置信度和状态。
 * @returns 写入成功时返回记忆记录；embedding 失败时返回 `null`。
 */
export async function addMemory(params: {
  content: string;
  memory_type?: string;
  source_session_id?: string;
  source_text?: string;
  confidence?: number;
  status?: string;
}): Promise<Memory | null> {
  // 写入长期记忆时先生成 embedding。embedding 失败说明外部向量服务不可用，
  // 这时返回 null，让上层记录失败或跳过，避免写入不可检索的数据。
  const { content, memory_type = "fact", source_session_id = "", source_text = "", confidence = 1.0, status = "active" } = params;
  const embedding = await embedText(content);
  if (embedding.length === 0) return null;

  const table = await getTable();
  const id = crypto.randomUUID();
  const now = Date.now();

  const memory: Memory = {
    id, user_id: USER_ID, agent_id: AGENT_ID, memory_type, content, embedding,
    source_session_id, source_text, status, confidence,
    created_at: now, updated_at: now, last_accessed_at: now, access_count: 0,
    embedding_model: "embedding-3", embedding_dim: embedding.length,
  };

  await table.add([toRecord(memory)]);
  return memory;
}

/**
 * 更新一条记忆的文本内容。
 *
 * 更新后会重新生成 embedding，保证检索结果与新文本一致。
 *
 * @param id 记忆 id。
 * @param content 新内容。
 * @returns 更新后的记忆；记忆不存在或 embedding 失败时返回 `null`。
 */
export async function updateMemory(id: string, content: string): Promise<Memory | null> {
  // LanceDB 当前更新路径采用“删旧行 + 加新行”。
  // 业务上仍视为同一条记忆，因为 id 保持不变，证据链不会断。
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

/**
 * 根据快照恢复记忆。
 *
 * 主要用于撤销 Memory Decision，恢复内容、类型、状态和置信度。
 *
 * @param snapshot 记忆快照。
 * @returns 恢复后的记忆；目标不存在或 embedding 失败时返回 `null`。
 */
export async function restoreMemorySnapshot(snapshot: MemorySnapshotRestore): Promise<Memory | null> {
  // 用于撤销 Memory Decision。恢复内容/类型/状态/置信度后重新计算 embedding，
  // 确保撤销后的记忆仍能按恢复后的文本被搜索到。
  const table = await getTable();
  const rows = await table.query().where(`id = '${snapshot.id}'`).limit(1).toArray();
  if (rows.length === 0) return null;

  const existing = toMemory(rows[0] as unknown as Record<string, unknown>);
  const embedding = await embedText(snapshot.content);
  if (embedding.length === 0) return null;

  const updated: Memory = {
    ...existing,
    content: snapshot.content,
    memory_type: snapshot.memory_type,
    status: snapshot.status,
    confidence: snapshot.confidence,
    embedding,
    updated_at: snapshot.updated_at ?? Date.now(),
    embedding_dim: embedding.length,
  };

  await table.delete(`id = '${snapshot.id}'`);
  await table.add([toRecord(updated)]);
  return updated;
}

/**
 * 将旧记忆标记为 superseded。
 *
 * superseded 表示已被新记忆取代，不再参与默认回忆，但仍保留历史轨迹。
 *
 * @param oldId 被取代的旧记忆 id。
 * @param _params 兼容旧调用的参数，当前只使用 oldId。
 */
export async function supersedeMemory(oldId: string, _params: {
  content: string;
  memory_type?: string;
  confidence?: number;
}): Promise<void> {
  // superseded 表示“被新记忆取代”，不同于 delete。
  // 旧记忆仍保留在库里，便于解释用户曾经如何改变过想法。
  const table = await getTable();
  const rows = await table.query().where(`id = '${oldId}'`).limit(1).toArray();
  if (rows.length === 0) return;

  const existing = toMemory(rows[0] as unknown as Record<string, unknown>);
  const updated: Memory = { ...existing, status: "superseded", updated_at: Date.now() };

  await table.delete(`id = '${oldId}'`);
  await table.add([toRecord(updated)]);
}

/**
 * 物理删除一条记忆。
 *
 * 自动整理流程不使用该方法；高风险场景优先通过 status 停用。
 *
 * @param id 要删除的记忆 id。
 */
export async function deleteMemory(id: string): Promise<void> {
  const table = await getTable();
  await table.delete(`id = '${id}'`);
}

/**
 * 更新记忆状态。
 *
 * @param id 记忆 id。
 * @param status 新状态，例如 `active`、`inactive`、`superseded`、`completed`。
 * @returns 更新后的记忆；记忆不存在时返回 `null`。
 */
export async function setMemoryStatus(id: string, status: string): Promise<Memory | null> {
  // status 是记忆生命周期控制：active 参与回忆，inactive/superseded/completed 默认不参与。
  // 自动整理优先改 status，不做物理删除。
  const table = await getTable();
  const rows = await table.query().where(`id = '${id}'`).limit(1).toArray();
  if (rows.length === 0) return null;

  const existing = toMemory(rows[0] as unknown as Record<string, unknown>);
  const updated: Memory = { ...existing, status, updated_at: Date.now() };

  await table.delete(`id = '${id}'`);
  await table.add([toRecord(updated)]);
  return updated;
}

/**
 * 记录一次记忆被访问。
 *
 * 会更新 `last_accessed_at` 并增加 `access_count`，用于检索排序和记忆强化。
 *
 * @param id 记忆 id。
 */
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
  // 衰减表示“长期不用的记忆权重降低”。fact 衰减为 1，
  // 因为稳定事实不应该仅因最近没被问到就被遗忘。
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

/**
 * 搜索 active 长期记忆。
 *
 * 使用向量相似度、文本相关性和记忆衰减混合排序，并对返回记忆执行 touch。
 *
 * @param query 查询文本。
 * @param topN 最大返回条数。
 * @returns 排序后的相关 active 记忆列表。
 */
export async function searchMemories(
  query: string,
  topN: number = 5,
): Promise<Memory[]> {
  // 混合检索：向量相似度负责“意思像不像”，TF-IDF 负责“关键词有没有命中”。
  // TF-IDF 是一种文本相关性算法，这里用于补足专有名词、中文短词和项目名检索。
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
    // MMR 是 Maximal Marginal Relevance，意思是“既相关又尽量多样”。
    // 它避免搜索结果全是同一条事实的轻微改写，给 Agent 更多上下文。
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

/**
 * 分页列出记忆。
 *
 * 管理 UI 使用该方法查看记忆列表；Agent 回忆优先使用 `searchMemories` 或 `memory_recall`。
 *
 * @param params 分页、类型、状态和搜索条件。
 * @returns 当前页记忆和过滤后的总数。
 */
export async function listMemories(params: {
  page?: number;
  pageSize?: number;
  type?: string;
  status?: string;
  search?: string;
}): Promise<{ memories: Memory[]; total: number }> {
  // 管理页列表偏向可解释和分页，不追求复杂排序；
  // 真正给 Agent 回忆使用的是 searchMemories / memory_recall。
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

/**
 * 获取单条记忆。
 *
 * @param id 记忆 id。
 * @returns 找到时返回记忆，否则返回 `null`。
 */
export async function getMemory(id: string): Promise<Memory | null> {
  const table = await getTable();
  const rows = await table.query().where(`id = '${id}'`).limit(1).toArray();
  return rows.length > 0 ? toMemory(rows[0] as unknown as Record<string, unknown>) : null;
}

/**
 * 获取记忆统计信息。
 *
 * @returns 总数、按类型分组数量和按状态分组数量。
 */
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
