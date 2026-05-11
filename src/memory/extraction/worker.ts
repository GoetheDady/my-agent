import type { Database } from "bun:sqlite";
import {
  syncProfileFromMemories,
  type ProfileSyncPort,
} from "../../agents/profile/profile-sync";
import {
  appendAssistantToolPart,
} from "../../channels/session-api";
import { getDb } from "../../core/database";
import { appendEvent, listTaskEvents } from "../../events/event-log";
import { createMemoryService } from "../service";
import {
  addMemory,
  getMemory,
  listMemories,
  searchMemories,
  setMemoryStatus,
  updateMemory,
  type Memory,
} from "../storage/store";
import { normalizePlan, planMemoryChangesWithModel } from "./planner";
import { isAllowedMemoryContent, RELATED_MEMORY_LIMIT } from "./safety";
import {
  completeExtractTool,
  completeReconsolidateTool,
  failMemoryToolParts,
} from "./tool-parts";
import type {
  MemoryChangePlanner,
  MemoryExtractionJob,
  MemoryExtractionWorkerOptions,
  MemoryWorkerResult,
  MemoryWorkerStore,
  PlannedMemoryUpdate,
  PlannedNewMemory,
} from "./types";
import { buildSummary, extractResultIds, uniqueStrings } from "./utils";

export type {
  MemoryChangePlan,
  MemoryChangePlanner,
  MemoryExtractionJob,
  MemoryExtractionWorkerOptions,
  MemoryWorkerResult,
  MemoryWorkerStore,
  PlannedMemoryUpdate,
  PlannedNewMemory,
} from "./types";

const defaultStore: MemoryWorkerStore = {
  addMemory,
  getMemory,
  listMemories,
  searchMemories,
  setMemoryStatus,
  updateMemory,
};

interface QueueItem {
  job: MemoryExtractionJob;
  resolve: (result: MemoryWorkerResult) => void;
  reject: (error: unknown) => void;
}

/**
 * 后台记忆提取 worker。
 *
 * 它在助手消息持久化后串行执行记忆提取、再巩固、去重和 profile 同步，
 * 并把合成工具卡写回对应 assistant message。
 */
export class MemoryExtractionWorker {
  private readonly queue: QueueItem[] = [];
  private running = false;
  private readonly planner: MemoryChangePlanner;
  private readonly store: MemoryWorkerStore;
  private readonly profileSync: ProfileSyncPort;

  /**
   * 创建记忆提取 worker。
   *
   * @param options 可注入 planner、store 和 profile sync 的测试/运行配置。
   */
  constructor(options: MemoryExtractionWorkerOptions = {}) {
    this.planner = options.planner ?? planMemoryChangesWithModel;
    this.store = options.store ?? defaultStore;
    this.profileSync = options.profileSync ?? syncProfileFromMemories;
  }

  /**
   * 将一条记忆提取任务加入串行队列。
   *
   * @param job 当前 task/session/message 对应的提取任务。
   * @returns 本次提取结果。
   */
  enqueue(job: MemoryExtractionJob): Promise<MemoryWorkerResult> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // 记忆写入必须串行：同一批 active memory 如果被多个 LLM worker 并发改写，
    // 很容易出现重复记忆、冲突覆盖或 profile 文件重复写入。
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;

      try {
        item.resolve(await this.processJob(item.job));
      } catch (error) {
        item.reject(error);
      }
    }

    this.running = false;
  }

  private async processJob(job: MemoryExtractionJob): Promise<MemoryWorkerResult> {
    const database = job.database ?? getDb();
    const taskEvents = listTaskEvents(job.taskId, database);
    // 如果主 Agent 在本轮调用过 memory_search，这些旧记忆就是“被唤起的记忆”，
    // 后续再巩固只能更新这批旧记忆，避免 worker 随意改写未参与本轮对话的记忆。
    const memorySearchEvents = taskEvents.filter((event) => event.type === "memory.search");
    const agentRetrievedMemoryIds = uniqueStrings(memorySearchEvents.flatMap(extractResultIds));
    const evidenceEventIds = taskEvents
      .filter((event) => ["user.message", "assistant.message", "memory.search"].includes(event.type))
      .map((event) => event.id);

    // 合成工具卡：后台 worker 不参与主模型 stream，但前端历史消息仍需要看到它做了什么。
    const extractTool = appendAssistantToolPart(
      job.assistantMessageId,
      "memory_extract",
      {
        sessionId: job.sessionId,
        taskId: job.taskId,
      },
      database,
    );
    appendEvent({
      agent_id: job.agentId,
      task_id: job.taskId,
      conversation_id: job.conversationId,
      type: "memory.extract.started",
      payload: { assistantMessageId: job.assistantMessageId },
    }, database);
    let reconsolidateTool: { toolCallId: string } | null = null;
    let retrievedMemoryIds: string[] = agentRetrievedMemoryIds;

    try {
      // 即使主 Agent 没主动查记忆，worker 也会用本轮用户文本做一次自主检索。
      // 这样可以捕捉“用户直接修正旧事实”的场景，例如“我现在不喜欢西红柿了”。
      const autonomousSearch = await this.searchRelatedMemories(job, database);
      retrievedMemoryIds = uniqueStrings([
        ...agentRetrievedMemoryIds,
        ...autonomousSearch.memories.map((memory) => memory.id),
      ]);
      const allEvidenceEventIds = uniqueStrings([...evidenceEventIds, ...autonomousSearch.eventIds]);
      reconsolidateTool = retrievedMemoryIds.length > 0
        ? appendAssistantToolPart(
          job.assistantMessageId,
          "memory_reconsolidate",
          {
            memoryIds: retrievedMemoryIds,
            taskId: job.taskId,
            source: autonomousSearch.memories.length > 0 ? "worker_search" : "agent_search",
          },
          database,
        )
        : null;
      if (reconsolidateTool) {
        appendEvent({
          agent_id: job.agentId,
          task_id: job.taskId,
          conversation_id: job.conversationId,
          type: "memory.reconsolidate.started",
          payload: { memoryIds: retrievedMemoryIds },
        }, database);
      }
      const retrievedMemories = await this.getRetrievedMemories(retrievedMemoryIds, autonomousSearch.memories);
      const plan = normalizePlan(await this.planner({ job, retrievedMemories, evidenceEventIds: allEvidenceEventIds }));
      const addedMemories = await this.applyNewMemories(job, plan.new_memories, retrievedMemories, allEvidenceEventIds);
      const updatedMemories = await this.applyMemoryUpdates(job, plan.updates, new Set(retrievedMemoryIds), allEvidenceEventIds);
      const addedMemoryIds = addedMemories.map((memory) => memory.id);
      const updatedMemoryIds = updatedMemories.map((memory) => memory.id);
      const summary = plan.summary
        || buildSummary(addedMemoryIds.length, updatedMemoryIds.length);

      completeExtractTool({
        job,
        database,
        toolCallId: extractTool.toolCallId,
        addedMemoryIds,
        summary,
      });
      if (reconsolidateTool) {
        completeReconsolidateTool({
          job,
          database,
          toolCallId: reconsolidateTool.toolCallId,
          updatedMemoryIds,
          retrievedMemoryIds,
          evidenceEventIds: allEvidenceEventIds,
          summary,
        });
      }

      return { addedMemoryIds, updatedMemoryIds, retrievedMemoryIds, summary };
    } catch (error) {
      failMemoryToolParts({
        job,
        database,
        extractToolCallId: extractTool.toolCallId,
        reconsolidateToolCallId: reconsolidateTool?.toolCallId,
        retrievedMemoryIds,
        error,
      });
      throw error;
    }
  }

  private async getRetrievedMemories(ids: string[], knownMemories: Memory[] = []): Promise<Memory[]> {
    const memories: Memory[] = [...knownMemories];
    const knownIds = new Set(knownMemories.map((memory) => memory.id));
    for (const id of ids) {
      if (knownIds.has(id)) continue;
      const memory = await this.store.getMemory(id);
      if (memory) memories.push(memory);
    }
    return memories;
  }

  private async searchRelatedMemories(
    job: MemoryExtractionJob,
    database: Database,
  ): Promise<{ memories: Memory[]; eventIds: string[] }> {
    const query = job.userText.trim();
    if (!query) return { memories: [], eventIds: [] };

    const memories = await this.store.searchMemories(query, RELATED_MEMORY_LIMIT);
    // worker 自主检索也写 memory.search 事件，后续证据链和再巩固都能追溯。
    const event = appendEvent({
      agent_id: job.agentId,
      task_id: job.taskId,
      conversation_id: job.conversationId,
      type: "memory.search",
      payload: {
        query,
        resultIds: memories.map((memory) => memory.id),
        source: "memory_worker",
      },
    }, database);

    return { memories, eventIds: [event.id] };
  }

  private async applyNewMemories(
    job: MemoryExtractionJob,
    memories: PlannedNewMemory[],
    _retrievedMemories: Memory[],
    evidenceEventIds: string[],
  ): Promise<Memory[]> {
    const savedMemories: Memory[] = [];
    if (memories.length === 0) return savedMemories;

    for (const memory of memories) {
      const content = memory.content.trim();
      const confidence = memory.confidence ?? 0.8;
      if (!isAllowedMemoryContent(content, confidence)) continue;

      const result = await createMemoryService({
        store: this.store,
        profileSync: this.profileSync,
      }).remember({
        content,
        memory_type: memory.memory_type ?? "fact",
        source_session_id: job.sessionId,
        source_text: job.userText,
        confidence,
        status: "active",
        reason: memory.reason ?? "memory_extract",
        evidenceEventIds,
        profileSyncSource: "memory_worker",
      }, {
        agentId: job.agentId,
        taskId: job.taskId,
        conversationId: job.conversationId,
        database: job.database ?? getDb(),
        store: this.store,
        profileSync: this.profileSync,
      });
      if (result.memory && (result.action === "created" || result.action === "updated")) {
        savedMemories.push(result.memory);
      }
    }
    return savedMemories;
  }

  private async applyMemoryUpdates(
    job: MemoryExtractionJob,
    updates: PlannedMemoryUpdate[],
    allowedIds: Set<string>,
    evidenceEventIds: string[],
  ): Promise<Memory[]> {
    const updatedMemories: Memory[] = [];
    for (const update of updates) {
      // 安全边界：模型只能更新本轮检索/唤起过的记忆，不能凭空指定任意 memory_id。
      if (!allowedIds.has(update.memory_id)) continue;
      const content = update.content.trim();
      const confidence = update.confidence ?? 0.8;
      if (!isAllowedMemoryContent(content, confidence)) continue;
      const result = await createMemoryService({
        store: this.store,
        profileSync: this.profileSync,
      }).update({
        memoryId: update.memory_id,
        content,
        reason: update.reason ?? "memory_reconsolidate",
        evidenceEventIds,
        profileSyncSource: "memory_worker",
      }, {
        agentId: job.agentId,
        taskId: job.taskId,
        conversationId: job.conversationId,
        database: job.database ?? getDb(),
        store: this.store,
        profileSync: this.profileSync,
      });
      if (result.memory) updatedMemories.push(result.memory);
    }
    return updatedMemories;
  }
}

const defaultWorker = new MemoryExtractionWorker();

/**
 * 默认记忆提取入口。
 *
 * 直接把任务投递到单例 worker，供 lifecycle hook 调用。
 *
 * @param job 记忆提取任务。
 * @returns 本次提取结果。
 */
export function enqueueMemoryExtraction(job: MemoryExtractionJob): Promise<MemoryWorkerResult> {
  return defaultWorker.enqueue(job);
}
