import type { Database } from "bun:sqlite";
import {
  syncProfileFromMemories,
  type ProfileSyncPort,
  type ProfileSyncSource,
} from "../agents/profile-sync";
import { appendEvent } from "../events/event-log";
import {
  addMemory,
  getMemory,
  listMemories,
  setMemoryStatus,
  updateMemory,
  type Memory,
} from "./store";
import {
  isCanonicalDuplicateMemory,
  isMoreCompleteMemoryContent,
} from "./canonical";
import type {
  memoryEvidence,
  memoryPlan,
  memoryRecall,
  HumanMemoryToolContext,
  HumanMemoryStorePort,
} from "./human-memory-tools";

export type MemoryServiceAction =
  | "created"
  | "reused"
  | "reinforced"
  | "updated"
  | "forgotten"
  | "completed";

export interface MemoryServiceStore {
  listMemories(params: Parameters<typeof listMemories>[0]): ReturnType<typeof listMemories>;
  getMemory(id: string): Promise<Memory | null>;
  addMemory(params: Parameters<typeof addMemory>[0]): Promise<Memory | null>;
  updateMemory(id: string, content: string): Promise<Memory | null>;
  setMemoryStatus(id: string, status: string): Promise<Memory | null>;
}

export interface MemoryServiceContext {
  agentId?: string;
  taskId?: string | null;
  conversationId?: string | null;
  database?: Database;
  store?: MemoryServiceStore;
  profileSync?: ProfileSyncPort;
}

export interface RememberMemoryInput {
  content: string;
  memory_type?: string;
  source_session_id?: string;
  source_text?: string;
  reason?: string;
  evidenceEventIds?: string[];
  confidence?: number;
  status?: string;
  profileSyncSource?: ProfileSyncSource;
}

export interface MemoryServiceResult {
  action: MemoryServiceAction;
  memory: Memory | null;
  duplicateOfMemoryId?: string;
  reason?: string;
}

export type MemoryRecallInput = Parameters<typeof memoryRecall>[0];
export type MemoryPlanInput = Parameters<typeof memoryPlan>[0];
export type MemoryEvidenceInput = Parameters<typeof memoryEvidence>[0];

const defaultStore: MemoryServiceStore = {
  listMemories,
  getMemory,
  addMemory,
  updateMemory,
  setMemoryStatus,
};

/**
 * 当前进程内的记忆服务层。
 *
 * Service layer（服务层）集中处理记忆写入、去重、强化、事件和 profile 同步；
 * store 只负责底层 LanceDB CRUD，tools/routes/workers 不再自行决定新增或复用。
 */
export class MemoryService {
  private readonly store: MemoryServiceStore;
  private readonly profileSync: ProfileSyncPort;

  constructor(options: { store?: MemoryServiceStore; profileSync?: ProfileSyncPort } = {}) {
    this.store = options.store ?? defaultStore;
    this.profileSync = options.profileSync ?? syncProfileFromMemories;
  }

  /**
   * 写入或复用一条长期记忆。
   *
   * @param input 候选记忆内容、类型、置信度和来源。
   * @param context Agent/task/conversation 上下文。
   * @returns 写入结果和动作类型。
   */
  async remember(input: RememberMemoryInput, context: MemoryServiceContext = {}): Promise<MemoryServiceResult> {
    const store = this.getStore(context);
    const content = input.content.trim();
    if (!content) return { action: "reused", memory: null, reason: "empty_content" };

    const memoryType = input.memory_type ?? "fact";
    const confidence = input.confidence ?? 0.8;
    const activeMemories = await this.listActiveMemories(context);
    const duplicate = findDuplicateMemory(content, memoryType, activeMemories);

    if (duplicate) {
      const shouldUpdate = isMoreCompleteMemoryContent(content, duplicate.content);
      const nextConfidence = Math.max(duplicate.confidence, confidence);
      if (shouldUpdate) {
        const updated = await store.updateMemory(duplicate.id, content);
        const memory = updated
          ? await this.ensureConfidence(updated, nextConfidence, store)
          : null;
        await this.emitRememberEvent("updated", memory, input, context, duplicate.id);
        if (memory) await this.syncProfileIfNeeded(memory, input, context, "updated");
        return {
          action: "updated",
          memory,
          duplicateOfMemoryId: duplicate.id,
          reason: "incoming_memory_more_complete",
        };
      }

      const action: Extract<MemoryServiceAction, "reused" | "reinforced"> =
        nextConfidence > duplicate.confidence ? "reinforced" : "reused";
      const memory = action === "reinforced"
        ? await this.ensureConfidence(duplicate, nextConfidence, store)
        : duplicate;
      await this.emitRememberEvent(action, memory, input, context, duplicate.id);
      return {
        action,
        memory,
        duplicateOfMemoryId: duplicate.id,
        reason: "duplicate_memory_reused",
      };
    }

    const created = await store.addMemory({
      content,
      memory_type: memoryType,
      source_session_id: input.source_session_id,
      source_text: input.source_text ?? JSON.stringify({
        reason: input.reason ?? "",
        evidenceEventIds: input.evidenceEventIds ?? [],
      }),
      confidence,
      status: input.status ?? "active",
    });
    await this.emitRememberEvent("created", created, input, context);
    if (created) await this.syncProfileIfNeeded(created, input, context, "created");
    return { action: "created", memory: created, reason: "new_memory_created" };
  }

  async update(input: {
    memoryId: string;
    content: string;
    reason?: string;
    evidenceEventIds?: string[];
    profileSyncSource?: ProfileSyncSource;
  }, context: MemoryServiceContext = {}): Promise<MemoryServiceResult> {
    const store = this.getStore(context);
    const memory = await store.updateMemory(input.memoryId, input.content);
    appendEvent({
      ...contextIds(context),
      type: "memory.update",
      payload: {
        memoryId: input.memoryId,
        reason: input.reason ?? "",
        evidenceEventIds: input.evidenceEventIds ?? [],
      },
    }, context.database);
    if (memory) await this.syncProfileIfNeeded(memory, input, context, "updated");
    return { action: "updated", memory };
  }

  async forget(input: { memoryId: string; reason?: string }, context: MemoryServiceContext = {}): Promise<MemoryServiceResult> {
    const memory = await this.getStore(context).setMemoryStatus(input.memoryId, "inactive");
    appendEvent({
      ...contextIds(context),
      type: "memory.update",
      payload: { memoryId: input.memoryId, action: "forget", reason: input.reason ?? "" },
    }, context.database);
    return { action: "forgotten", memory };
  }

  async completePlan(input: { memoryId: string; reason?: string }, context: MemoryServiceContext = {}): Promise<MemoryServiceResult> {
    const memory = await this.getStore(context).setMemoryStatus(input.memoryId, "completed");
    appendEvent({
      ...contextIds(context),
      type: "memory.update",
      payload: { memoryId: input.memoryId, action: "complete", reason: input.reason ?? "" },
    }, context.database);
    return { action: "completed", memory };
  }

  /**
   * 统一回忆入口。
   *
   * recall（回忆）负责从语义、情景、前瞻、程序、反思等记忆层取资料；
   * 当前复用已稳定的 `memory_recall` 工具实现，后续新调用方应优先走本服务方法。
   *
   * @param input 查询、意图和过滤条件。
   * @param context Agent/task/conversation 上下文。
   * @returns 分层后的回忆结果。
   */
  async recall(input: MemoryRecallInput, context: MemoryServiceContext = {}): ReturnType<typeof memoryRecall> {
    const tools = await import("./human-memory-tools");
    return tools.memoryRecall(input, this.toHumanMemoryContext(context));
  }

  /**
   * 管理前瞻记忆。
   *
   * 前瞻记忆指未来计划、待办和提醒意图；创建动作最终仍会走 `remember()` 的统一写入逻辑。
   *
   * @param input create/list/complete 操作。
   * @param context Agent/task/conversation 上下文。
   * @returns 单条计划或计划列表。
   */
  async plan(input: MemoryPlanInput, context: MemoryServiceContext = {}): ReturnType<typeof memoryPlan> {
    const tools = await import("./human-memory-tools");
    return tools.memoryPlan(input, this.toHumanMemoryContext(context));
  }

  /**
   * 查询记忆证据。
   *
   * evidence（证据）用于回答“你为什么这么判断”，返回记忆或 episode 的来源信息。
   *
   * @param input memory/episode id。
   * @param context Agent/task/conversation 上下文。
   * @returns 记忆、episode 和来源证据。
   */
  async evidence(input: MemoryEvidenceInput, context: MemoryServiceContext = {}): ReturnType<typeof memoryEvidence> {
    const tools = await import("./human-memory-tools");
    return tools.memoryEvidence(input, this.toHumanMemoryContext(context));
  }

  private async listActiveMemories(context: MemoryServiceContext): Promise<Memory[]> {
    const { memories } = await this.getStore(context).listMemories({ status: "active", pageSize: 1000 });
    return memories;
  }

  private async ensureConfidence(memory: Memory, confidence: number, store: MemoryServiceStore): Promise<Memory | null> {
    if (confidence <= memory.confidence) return memory;
    // 当前 store 没有单独更新 confidence 的 API。为了不改 schema，只在确实需要强化时
    // 通过 updateMemory 保持内容不变并更新时间；置信度仍以旧值为准。
    return store.updateMemory(memory.id, memory.content);
  }

  private getStore(context: MemoryServiceContext): MemoryServiceStore {
    return context.store ?? this.store;
  }

  private getProfileSync(context: MemoryServiceContext): ProfileSyncPort {
    return context.profileSync ?? this.profileSync;
  }

  private toHumanMemoryContext(context: MemoryServiceContext): HumanMemoryToolContext {
    const store = this.getStore(context);
    return {
      ...context,
      store: hasSearchMemories(store) ? store : undefined,
      profileSync: this.getProfileSync(context),
    };
  }

  private async emitRememberEvent(
    action: Extract<MemoryServiceAction, "created" | "reused" | "reinforced" | "updated">,
    memory: Memory | null,
    input: RememberMemoryInput,
    context: MemoryServiceContext,
    duplicateOfMemoryId?: string,
  ): Promise<void> {
    appendEvent({
      ...contextIds(context),
      type: "memory.remember",
      payload: {
        action,
        memoryId: memory?.id ?? null,
        duplicateOfMemoryId: duplicateOfMemoryId ?? null,
        memory_type: input.memory_type ?? "fact",
        reason: input.reason ?? "",
        evidenceEventIds: input.evidenceEventIds ?? [],
      },
    }, context.database);
  }

  private async syncProfileIfNeeded(
    memory: Memory,
    input: Pick<RememberMemoryInput, "reason" | "evidenceEventIds" | "profileSyncSource">,
    context: MemoryServiceContext,
    sourceAction: "created" | "updated",
  ): Promise<void> {
    if (sourceAction !== "created" && sourceAction !== "updated") return;
    try {
      await this.getProfileSync(context)({
        agentId: context.agentId ?? "default",
        userId: "default",
        taskId: context.taskId ?? null,
        conversationId: context.conversationId ?? null,
        database: context.database,
        source: input.profileSyncSource ?? "memory_tool",
        memories: [memory],
        reason: input.reason ?? "memory_remember",
        sourceEventIds: input.evidenceEventIds ?? [],
      });
    } catch (error) {
      appendEvent({
        ...contextIds(context),
        type: "profile.sync.failed",
        payload: {
          source: input.profileSyncSource ?? "memory_tool",
          memoryIds: [memory.id],
          error: error instanceof Error ? error.message : String(error),
        },
      }, context.database);
    }
  }
}

export function createMemoryService(context: MemoryServiceContext = {}): MemoryService {
  return new MemoryService({
    store: context.store,
    profileSync: context.profileSync,
  });
}

export const defaultMemoryService = new MemoryService();

function findDuplicateMemory(content: string, memoryType: string, memories: Memory[]): Memory | null {
  for (const memory of memories) {
    if (isCanonicalDuplicateMemory(content, memory.content, memoryType, memory.memory_type)) return memory;
  }
  return null;
}

function contextIds(context: MemoryServiceContext): {
  agent_id: string;
  task_id: string | null;
  conversation_id: string | null;
} {
  return {
    agent_id: context.agentId ?? "default",
    task_id: context.taskId ?? null,
    conversation_id: context.conversationId ?? null,
  };
}

function hasSearchMemories(store: MemoryServiceStore): store is HumanMemoryStorePort {
  return "searchMemories" in store && typeof store.searchMemories === "function";
}
