import type { Database } from "bun:sqlite";
import { tool } from "ai";
import { z } from "zod";
import {
  syncProfileFromMemories,
  type ProfileSyncPort,
} from "../agents/profile-sync";
import { appendEvent } from "../events/event-log";
import {
  addMemory,
  getMemory,
  listMemories,
  searchMemories,
  setMemoryStatus,
  type Memory,
} from "./store";
import { getEpisode, searchEpisodes, type EpisodeRecord } from "./episode-store";
import {
  createReviewItem,
  listReviewItems,
  type MemoryReviewItem,
  type MemoryReviewType,
} from "./review-store";

export type MemoryRecallIntent =
  | "auto"
  | "semantic"
  | "episodic"
  | "procedural"
  | "prospective"
  | "reflective"
  | "social"
  | "evidence";

export interface HumanMemoryToolContext {
  agentId?: string;
  taskId?: string | null;
  conversationId?: string | null;
  database?: Database;
  store?: HumanMemoryStorePort;
  profileSync?: ProfileSyncPort;
}

export interface HumanMemoryStorePort {
  searchMemories(query: string, limit?: number): Promise<Memory[]>;
  listMemories(params: Parameters<typeof listMemories>[0]): ReturnType<typeof listMemories>;
  getMemory(id: string): Promise<Memory | null>;
  addMemory(params: Parameters<typeof addMemory>[0]): Promise<Memory | null>;
  setMemoryStatus(id: string, status: string): Promise<Memory | null>;
}

const defaultStore: HumanMemoryStorePort = {
  searchMemories,
  listMemories,
  getMemory,
  addMemory,
  setMemoryStatus,
};

const recallIntentSchema = z.enum([
  "auto",
  "semantic",
  "episodic",
  "procedural",
  "prospective",
  "reflective",
  "social",
  "evidence",
]);

const memoryRecallSchema = z.object({
  query: z.string().describe("要回忆的问题"),
  intent: recallIntentSchema.optional().describe("回忆意图"),
  kinds: z.array(z.string()).optional().describe("限定记忆种类"),
  from: z.number().optional().describe("起始时间戳"),
  to: z.number().optional().describe("结束时间戳"),
  limit: z.number().int().min(1).max(20).optional().describe("最多返回条数"),
});

const memoryRememberSchema = z.object({
  content: z.string().describe("要记住的内容"),
  kind: z.enum(["semantic", "procedural", "prospective", "reflective", "social", "identity"]).optional(),
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

const memoryPlanSchema = z.object({
  action: z.enum(["create", "list", "complete"]),
  content: z.string().optional(),
  memoryId: z.string().optional(),
  reason: z.string().optional(),
});

const memoryEvidenceSchema = z.object({
  id: z.string().describe("memory id 或 episode id"),
  kind: z.enum(["memory", "episode"]).optional(),
});

const memoryReflectSchema = z.object({
  title: z.string(),
  proposedContent: z.string(),
  type: z.enum(["merge", "semantic_update", "procedural_memory", "conflict", "reflective_memory"]).optional(),
  sourceEventIds: z.array(z.string()).optional(),
  targetMemoryIds: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

export async function memoryRecall(
  input: z.infer<typeof memoryRecallSchema>,
  context: HumanMemoryToolContext = {},
): Promise<{
  intent: MemoryRecallIntent;
  semantic: ReturnType<typeof toRecallMemory>[];
  episodic: ReturnType<typeof toRecallEpisode>[];
  prospective: ReturnType<typeof toRecallMemory>[];
  procedural: ReturnType<typeof toRecallMemory>[];
  reflective: ReturnType<typeof toRecallMemory>[];
  social: ReturnType<typeof toRecallMemory>[];
  reviewItems: MemoryReviewItem[];
}> {
  const intent = input.intent ?? inferRecallIntent(input.query);
  const store = context.store ?? defaultStore;
  const agentId = context.agentId ?? "default";
  const limit = input.limit ?? 5;
  const should = (kind: MemoryRecallIntent) =>
    intent === "auto" || intent === kind || input.kinds?.includes(kind);

  const semantic = should("semantic")
    ? (await store.searchMemories(input.query, limit)).map(toRecallMemory)
    : [];
  let episodic: ReturnType<typeof toRecallEpisode>[] = [];
  if (should("episodic")) {
    const matchedEpisodes = searchEpisodes({
      agentId,
      query: input.query,
      from: input.from,
      to: input.to,
      limit,
    }, context.database);
    const episodes = matchedEpisodes.length > 0
      ? matchedEpisodes
      : searchEpisodes({
        agentId,
        from: input.from,
        to: input.to,
        limit,
      }, context.database);
    episodic = episodes.map(toRecallEpisode);
  }
  const prospective = should("prospective")
    ? (await recallMemoriesByTypes(store, input.query, ["prospective"], limit)).map(toRecallMemory)
    : [];
  const procedural = should("procedural")
    ? (await recallMemoriesByTypes(store, input.query, ["procedural"], limit)).map(toRecallMemory)
    : [];
  const reflective = should("reflective")
    ? (await recallMemoriesByTypes(store, input.query, ["reflective", "lesson"], limit)).map(toRecallMemory)
    : [];
  const social = should("social")
    ? (await recallMemoriesByTypes(store, input.query, ["preference", "social"], limit)).map(toRecallMemory)
    : [];
  const reviewItems = should("reflective")
    ? listReviewItems({ agentId, status: "pending", limit }, context.database)
    : [];

  appendEvent({
    agent_id: agentId,
    task_id: context.taskId ?? null,
    conversation_id: context.conversationId ?? null,
    type: "memory.search",
    payload: {
      query: input.query,
      intent,
      resultIds: [
        ...semantic.map((memory) => memory.id),
        ...prospective.map((memory) => memory.id),
        ...procedural.map((memory) => memory.id),
        ...reflective.map((memory) => memory.id),
        ...social.map((memory) => memory.id),
        ...episodic.map((episode) => episode.id),
      ],
      source: "memory_recall",
    },
  }, context.database);

  return { intent, semantic, episodic, prospective, procedural, reflective, social, reviewItems };
}

export async function memoryRemember(
  input: z.infer<typeof memoryRememberSchema>,
  context: HumanMemoryToolContext = {},
): Promise<{ memory: ReturnType<typeof toRecallMemory> | null }> {
  const memory = await (context.store ?? defaultStore).addMemory({
    content: input.content,
    memory_type: mapKindToMemoryType(input.kind ?? "semantic"),
    confidence: input.confidence ?? 0.8,
    status: "active",
    source_text: JSON.stringify({ reason: input.reason ?? "", kind: input.kind ?? "semantic" }),
  });
  if (memory) {
    await syncProfileSafely(context.profileSync ?? syncProfileFromMemories, {
      agentId: context.agentId ?? "default",
      userId: "default",
      taskId: context.taskId ?? null,
      conversationId: context.conversationId ?? null,
      database: context.database,
      source: "memory_tool",
      memories: [memory],
      reason: input.reason ?? "memory_remember",
    });
  }
  return { memory: memory ? toRecallMemory(memory) : null };
}

export async function memoryPlan(
  input: z.infer<typeof memoryPlanSchema>,
  context: HumanMemoryToolContext = {},
): Promise<{ memory: ReturnType<typeof toRecallMemory> | null; memories: ReturnType<typeof toRecallMemory>[] }> {
  const store = context.store ?? defaultStore;
  if (input.action === "create") {
    if (!input.content) return { memory: null, memories: [] };
    const memory = await store.addMemory({
      content: input.content,
      memory_type: "prospective",
      status: "active",
      confidence: 0.8,
      source_text: JSON.stringify({ reason: input.reason ?? "", kind: "prospective" }),
    });
    if (memory) {
      await syncProfileSafely(context.profileSync ?? syncProfileFromMemories, {
        agentId: context.agentId ?? "default",
        userId: "default",
        taskId: context.taskId ?? null,
        conversationId: context.conversationId ?? null,
        database: context.database,
        source: "memory_tool",
        memories: [memory],
        reason: input.reason ?? "memory_plan",
      });
    }
    return { memory: memory ? toRecallMemory(memory) : null, memories: [] };
  }

  if (input.action === "complete") {
    if (!input.memoryId) return { memory: null, memories: [] };
    const memory = await store.setMemoryStatus(input.memoryId, "completed");
    return { memory: memory ? toRecallMemory(memory) : null, memories: [] };
  }

  const memories = (await store.listMemories({ type: "prospective", status: "active", pageSize: 20 }))
    .memories
    .map(toRecallMemory);
  return { memory: null, memories };
}

export async function memoryEvidence(
  input: z.infer<typeof memoryEvidenceSchema>,
  context: HumanMemoryToolContext = {},
): Promise<{ memory: ReturnType<typeof toRecallMemory> | null; episode: ReturnType<typeof toRecallEpisode> | null; source: unknown }> {
  if (input.kind === "episode") {
    const episode = getEpisode(input.id, context.database);
    return { memory: null, episode: episode ? toRecallEpisode(episode) : null, source: episode?.source_event_ids ?? [] };
  }

  const memory = await (context.store ?? defaultStore).getMemory(input.id);
  return {
    memory: memory ? toRecallMemory(memory) : null,
    episode: null,
    source: parseSourceText(memory?.source_text ?? ""),
  };
}

export function memoryReflect(
  input: z.infer<typeof memoryReflectSchema>,
  context: HumanMemoryToolContext = {},
): { reviewItem: MemoryReviewItem } {
  const reviewItem = createReviewItem({
    agentId: context.agentId ?? "default",
    type: input.type as MemoryReviewType ?? "reflective_memory",
    title: input.title,
    proposedContent: input.proposedContent,
    targetMemoryIds: input.targetMemoryIds,
    sourceEventIds: input.sourceEventIds,
    confidence: input.confidence,
    reason: input.reason,
  }, context.database);
  return { reviewItem };
}

async function syncProfileSafely(sync: ProfileSyncPort, input: Parameters<ProfileSyncPort>[0]): Promise<void> {
  try {
    await sync(input);
  } catch (error) {
    appendEvent({
      agent_id: input.agentId ?? "default",
      task_id: input.taskId ?? null,
      conversation_id: input.conversationId ?? null,
      type: "profile.sync.failed",
      payload: {
        source: input.source,
        memoryIds: input.memories.map((memory) => memory.id),
        error: error instanceof Error ? error.message : String(error),
      },
    }, input.database);
  }
}

export function createHumanMemoryTools(context: HumanMemoryToolContext = {}) {
  return {
    memory_recall: tool({
      description: "统一回忆入口。用于过去经历、用户偏好、未来计划、做事方法、反思复盘和证据追问。",
      inputSchema: memoryRecallSchema,
      execute: (input) => memoryRecall(input, context),
    }),
    memory_remember: tool({
      description: "写入一条类人记忆，可指定 semantic/procedural/prospective/reflective/social/identity。",
      inputSchema: memoryRememberSchema,
      execute: (input) => memoryRemember(input, context),
    }),
    memory_plan: tool({
      description: "管理未来计划、待办和提醒意图。第一阶段只负责记住、列出、完成，不负责系统通知。",
      inputSchema: memoryPlanSchema,
      execute: (input) => memoryPlan(input, context),
    }),
    memory_evidence: tool({
      description: "查看一条记忆或 episode 的证据来源。",
      inputSchema: memoryEvidenceSchema,
      execute: (input) => memoryEvidence(input, context),
    }),
    memory_reflect: tool({
      description: "生成程序记忆或反思记忆的待审查建议，不直接改写 active memory。",
      inputSchema: memoryReflectSchema,
      execute: (input) => memoryReflect(input, context),
    }),
  };
}

function inferRecallIntent(query: string): MemoryRecallIntent {
  if (/(刚才|上午|下午|昨天|上周|做了什么|发生了什么|之前)/.test(query)) return "episodic";
  if (/(后续|以后|计划|待办|提醒|要做什么)/.test(query)) return "prospective";
  if (/(怎么做|流程|步骤|注意什么|应该怎么)/.test(query)) return "procedural";
  if (/(坑|复盘|风险|教训|为什么错)/.test(query)) return "reflective";
  if (/(偏好|喜欢|习惯|风格|沟通)/.test(query)) return "social";
  return "semantic";
}

function mapKindToMemoryType(kind: string): string {
  if (kind === "semantic") return "fact";
  if (kind === "social") return "preference";
  return kind;
}

async function recallMemoriesByTypes(
  store: HumanMemoryStorePort,
  query: string,
  memoryTypes: string[],
  limit: number,
): Promise<Memory[]> {
  const byId = new Map<string, Memory>();
  for (const memoryType of memoryTypes) {
    const { memories } = await store.listMemories({
      type: memoryType,
      status: "active",
      pageSize: 1000,
    });
    for (const memory of memories) {
      byId.set(memory.id, memory);
    }
  }

  return rankRecallMemories(Array.from(byId.values()), query).slice(0, limit);
}

function rankRecallMemories(memories: Memory[], query: string): Memory[] {
  const queryTokens = tokenizeRecallText(query);
  const asksPreference = /(喜欢|偏好|习惯|风格|沟通)/.test(query);
  const asksChange = /(改过主意|变化|变过|曾经|以前|现在|不喜欢|改为|不再|后来)/.test(query);
  const now = Date.now();

  return [...memories].sort((a, b) => {
    const scoreA = scoreRecallMemory(a, queryTokens, { asksPreference, asksChange, now });
    const scoreB = scoreRecallMemory(b, queryTokens, { asksPreference, asksChange, now });
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (b.updated_at !== a.updated_at) return b.updated_at - a.updated_at;
    return a.id.localeCompare(b.id);
  });
}

function scoreRecallMemory(
  memory: Memory,
  queryTokens: string[],
  context: { asksPreference: boolean; asksChange: boolean; now: number },
): number {
  const content = memory.content;
  const contentTokens = new Set(tokenizeRecallText(content));
  let tokenScore = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) tokenScore += 1;
  }

  const confidenceScore = memory.confidence * 2;
  const ageDays = Math.max(0, (context.now - memory.updated_at) / 86_400_000);
  const recencyScore = 1 / (1 + ageDays / 7);
  const preferenceScore = context.asksPreference && /(喜欢|偏好|习惯|风格|沟通)/.test(content) ? 1.5 : 0;
  const changeScore = context.asksChange && /(曾经|曾表示|现在|改为|不喜欢|不再|变化|改)/.test(content) ? 3 : 0;

  return tokenScore + confidenceScore + recencyScore + preferenceScore + changeScore;
}

function tokenizeRecallText(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-z0-9]/g, " ");
  const tokens: string[] = [];

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const bigram = normalized.slice(index, index + 2).trim();
    if (bigram.length === 2 && !/\s/.test(bigram)) tokens.push(bigram);
  }

  tokens.push(...normalized.split(/\s+/).filter((word) => word.length > 1));
  return tokens;
}

function toRecallMemory(memory: Memory) {
  return {
    id: memory.id,
    kind: mapMemoryTypeToKind(memory.memory_type),
    memory_type: memory.memory_type,
    content: memory.content,
    status: memory.status,
    confidence: memory.confidence,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
  };
}

function toRecallEpisode(episode: EpisodeRecord) {
  return {
    id: episode.id,
    kind: "episodic",
    title: episode.title,
    summary: episode.summary,
    outcome: episode.outcome,
    task_id: episode.task_id,
    time_range_start: episode.time_range_start,
    time_range_end: episode.time_range_end,
    tools_used: episode.tools_used,
    files_touched: episode.files_touched,
    importance: episode.importance,
  };
}

function mapMemoryTypeToKind(memoryType: string): string {
  if (memoryType === "fact" || memoryType === "project") return "semantic";
  if (memoryType === "preference") return "social";
  return memoryType;
}

function parseSourceText(sourceText: string): unknown {
  try {
    return JSON.parse(sourceText) as unknown;
  } catch {
    return sourceText;
  }
}
