import type { Database } from "bun:sqlite";
import { tool } from "ai";
import { z } from "zod";
import type { ProfileSyncPort } from "../../profiles/sync";
import { appendEvent } from "../../events/event-log";
import {
  addMemory,
  getMemory,
  listMemories,
  searchMemories,
  setMemoryStatus,
  updateMemory,
  type Memory,
} from "../storage/store";
import { createMemoryService, type MemoryServiceStore } from "../service";
import { getEpisode, searchEpisodes } from "../episode-store";
import {
  createReviewItem,
  listReviewItems,
  type MemoryReviewItem,
  type MemoryReviewType,
} from "../review-store";
import { inferRecallIntent, type MemoryRecallIntent } from "./recall-intent";
import { rankRecallMemories } from "./recall-ranking";
import {
  mapKindToMemoryType,
  parseSourceText,
  toRecallEpisode,
  toRecallMemory,
} from "./serializers";

export type { MemoryRecallIntent } from "./recall-intent";

export interface HumanMemoryToolContext {
  agentId?: string;
  taskId?: string | null;
  conversationId?: string | null;
  database?: Database;
  store?: HumanMemoryStorePort;
  profileSync?: ProfileSyncPort;
}

export interface HumanMemoryStorePort extends MemoryServiceStore {
  searchMemories(query: string, limit?: number): Promise<Memory[]>;
}

const defaultStore: HumanMemoryStorePort = {
  searchMemories,
  listMemories,
  getMemory,
  addMemory,
  updateMemory,
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

/**
 * 统一回忆入口。
 *
 * 依据用户意图在 semantic、episodic、procedural、prospective、reflective 和 social
 * 记忆层之间路由，并返回证据链和相关 review item。
 *
 * @param input 查询文本、意图、时间范围、限定 kind 和返回条数。
 * @param context Agent、task、conversation 和可选存储端口。
 * @returns 按记忆层分组的回忆结果。
 */
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

  // semantic 是稳定事实层；这里先用通用向量/文本搜索兜底，
  // 因为用户问“我在开发什么”这类问题通常不需要知道更细的底层分类。
  const semantic = should("semantic")
    ? (await store.searchMemories(input.query, limit)).map(toRecallMemory)
    : [];
  let episodic: ReturnType<typeof toRecallEpisode>[] = [];
  if (should("episodic")) {
    // episodic 是情景记忆，指某次任务/对话/工具调用的摘要。
    // 如果关键词没命中，仍按时间范围返回最近经历，避免“刚才做了什么”因为措辞不同查不到。
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

  // memory.search 事件是证据链的一部分。后续记忆再巩固需要知道：
  // 本轮 Agent 到底查过哪些旧记忆，才能判断新事实是否在修正旧事实。
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

/**
 * 显式写入一条长期记忆。
 *
 * @param input 记忆内容、kind、reason 和 confidence。
 * @param context Agent、task、conversation 和可选存储端口。
 * @returns 写入后的记忆，或 `null`。
 */
export async function memoryRemember(
  input: z.infer<typeof memoryRememberSchema>,
  context: HumanMemoryToolContext = {},
): Promise<{
  action: string;
  memory: ReturnType<typeof toRecallMemory> | null;
  duplicateOfMemoryId?: string;
  reason?: string;
}> {
  // memory_remember 是显式写入入口，适合“请记住……”这类用户明确授权的内容。
  // 真实写入委托给 MemoryService，保证工具、worker、API 使用同一套去重和 profile 同步规则。
  const result = await createMemoryService({
    ...context,
    store: context.store ?? defaultStore,
  }).remember({
    content: input.content,
    memory_type: mapKindToMemoryType(input.kind ?? "semantic"),
    confidence: input.confidence ?? 0.8,
    status: "active",
    source_text: JSON.stringify({ reason: input.reason ?? "", kind: input.kind ?? "semantic" }),
    reason: input.reason ?? "memory_remember",
    profileSyncSource: "memory_tool",
  }, {
    ...context,
    store: context.store ?? defaultStore,
  });
  return {
    action: result.action,
    memory: result.memory ? toRecallMemory(result.memory) : null,
    duplicateOfMemoryId: result.duplicateOfMemoryId,
    reason: result.reason,
  };
}

/**
 * 管理前瞻记忆。
 *
 * `create` 用于新增计划，`list` 用于列出当前 active 计划，`complete` 用于标记完成。
 *
 * @param input 操作类型、内容、memoryId 和原因。
 * @param context Agent、task、conversation 和可选存储端口。
 * @returns 当前记忆或计划列表。
 */
export async function memoryPlan(
  input: z.infer<typeof memoryPlanSchema>,
  context: HumanMemoryToolContext = {},
): Promise<{ memory: ReturnType<typeof toRecallMemory> | null; memories: ReturnType<typeof toRecallMemory>[] }> {
  const store = context.store ?? defaultStore;
  if (input.action === "create") {
    // prospective memory 是前瞻记忆，表示未来要做的事或计划。
    // v1 只负责“记得有这件事”，不负责真正定时通知。
    if (!input.content) return { memory: null, memories: [] };
    const result = await createMemoryService({
      ...context,
      store,
    }).remember({
      content: input.content,
      memory_type: "prospective",
      status: "active",
      confidence: 0.8,
      source_text: JSON.stringify({ reason: input.reason ?? "", kind: "prospective" }),
      reason: input.reason ?? "memory_plan",
      profileSyncSource: "memory_tool",
    }, {
      ...context,
      store,
    });
    const memory = result.memory;
    return { memory: memory ? toRecallMemory(memory) : null, memories: [] };
  }

  if (input.action === "complete") {
    // 完成计划时不删除记忆，而是改状态。这样以后还能追溯“以前计划过什么”。
    if (!input.memoryId) return { memory: null, memories: [] };
    const result = await createMemoryService({
      ...context,
      store,
    }).completePlan({
      memoryId: input.memoryId,
      reason: input.reason ?? "memory_plan_complete",
    }, {
      ...context,
      store,
    });
    return { memory: result.memory ? toRecallMemory(result.memory) : null, memories: [] };
  }

  const memories = (await store.listMemories({ type: "prospective", status: "active", pageSize: 20 }))
    .memories
    .map(toRecallMemory);
  return { memory: null, memories };
}

/**
 * 查询记忆或 episode 的证据。
 *
 * @param input memory id 或 episode id，以及可选 kind。
 * @param context Agent、task、conversation 和可选存储端口。
 * @returns 记忆/episode 及其来源证据。
 */
export async function memoryEvidence(
  input: z.infer<typeof memoryEvidenceSchema>,
  context: HumanMemoryToolContext = {},
): Promise<{ memory: ReturnType<typeof toRecallMemory> | null; episode: ReturnType<typeof toRecallEpisode> | null; source: unknown }> {
  // evidence 是证据查询入口。用户问“你为什么这么判断”时，
  // Agent 应该用这里返回的 source_event_ids/source_text 说明依据，而不是凭空解释。
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

/**
 * 生成反思或程序记忆建议。
 *
 * 这里不直接改写 active memory，而是创建 review item 供后续整理流程使用。
 *
 * @param input 建议标题、拟写内容、类型、目标记忆、证据和置信度。
 * @param context Agent、task、conversation 和可选数据库。
 * @returns 新创建的 review item。
 */
export function memoryReflect(
  input: z.infer<typeof memoryReflectSchema>,
  context: HumanMemoryToolContext = {},
): { reviewItem: MemoryReviewItem } {
  // 反思类内容抽象程度高，容易把一次性现象误写成长期规律。
  // 所以工具层仍保留 review item：先记录建议，不直接改 active memory。
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

/**
 * 创建带上下文的记忆工具集合。
 *
 * @param context Agent、task、conversation 和可选存储端口。
 * @returns 可交给 AI SDK 的记忆工具集。
 */
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
