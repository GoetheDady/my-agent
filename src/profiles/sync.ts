import type { Database } from "bun:sqlite";
import {
  applyProfileFileUpdates,
  type AppliedProfileUpdate,
} from "./files";
import { appendEvent } from "../events/event-log";
import type { Memory } from "../memory/storage/store";
import { classifyProfileUpdates } from "./classifier";

export { classifyProfileUpdates } from "./classifier";

export type ProfileSyncSource = "memory_worker" | "memory_tool" | "dream_worker";

export interface ProfileSyncInput {
  agentId?: string;
  userId?: string;
  taskId?: string | null;
  conversationId?: string | null;
  database?: Database;
  /**
   * 运行时数据根目录。默认使用 .my-agent/，profile 文件位于对应 Agent 目录下。
   *
   * 这里保留 rootDir 作为兼容字段，是为了现有测试和调用点能逐步迁移；
   * 新代码应优先传 profileRootDir。
   */
  profileRootDir?: string;
  /** @deprecated 请使用 profileRootDir。 */
  rootDir?: string;
  source: ProfileSyncSource;
  memories: Array<Pick<Memory, "id" | "content" | "memory_type" | "status" | "confidence">>;
  reason?: string;
  sourceEventIds?: string[];
}

export interface ProfileSyncResult {
  status: "completed" | "skipped" | "failed";
  applied: AppliedProfileUpdate[];
  skippedReason?: string;
  error?: string;
}

export type ProfileSyncPort = (input: ProfileSyncInput) => Promise<ProfileSyncResult>;

function appendProfileSyncEvent(
  database: Database | undefined,
  event: Parameters<typeof appendEvent>[0],
): void {
  if (!database) return;
  appendEvent(event, database);
}

/**
 * 空 profile 同步器。
 *
 * 测试或禁用文件写入时可以传入它，保持调用链完整但不产生任何文件副作用。
 *
 * @returns 一个表示“已跳过”的同步结果。
 */
export const noopProfileSync: ProfileSyncPort = async () => ({
  status: "skipped",
  applied: [],
  skippedReason: "profile sync disabled",
});

/**
 * 根据长期记忆同步 `user.md` 和 `soul.md`。
 *
 * 关系说明：memory 是证据层，保留事实、来源和变化轨迹；
 * `user.md` / `soul.md` 是稳定认知层，只保存高优先级、简洁、当前有效的画像/原则。
 * 同步失败只记录事件，不影响 memory 写入或聊天回复。
 *
 * @param input 本次同步的来源、候选记忆、Agent/User 标识和可选数据库连接。
 * @returns 同步结果，包括完成/跳过/失败状态和实际写入的 profile 条目。
 */
export async function syncProfileFromMemories(input: ProfileSyncInput): Promise<ProfileSyncResult> {
  const agentId = input.agentId ?? "default";
  const taskId = input.taskId ?? null;
  const conversationId = input.conversationId ?? null;

  appendProfileSyncEvent(input.database, {
    agent_id: agentId,
    task_id: taskId,
    conversation_id: conversationId,
    type: "profile.sync.started",
    payload: {
      source: input.source,
      memoryIds: input.memories.map((memory) => memory.id),
    },
  });

  try {
    const classified = classifyProfileUpdates(input.memories);
    if (classified.userUpdates.length === 0 && classified.soulUpdates.length === 0) {
      const skippedReason = classified.skippedReason ?? "没有适合沉淀到 user.md 或 soul.md 的稳定认知";
      appendProfileSyncEvent(input.database, {
        agent_id: agentId,
        task_id: taskId,
        conversation_id: conversationId,
        type: "profile.sync.skipped",
        payload: {
          source: input.source,
          reason: skippedReason,
          memoryIds: input.memories.map((memory) => memory.id),
        },
      });
      return { status: "skipped", applied: [], skippedReason };
    }

    // applyProfileFileUpdates 会按固定 section 更新，尽量保留用户手写内容，只改受控条目。
    const applied = applyProfileFileUpdates({
      agentId,
      userId: input.userId ?? "default",
      profileRootDir: input.profileRootDir,
      rootDir: input.rootDir,
      soulUpdates: classified.soulUpdates,
      userUpdates: classified.userUpdates,
    });

    if (applied.length === 0) {
      const skippedReason = "profile 文件已有等价内容，无需更新";
      appendProfileSyncEvent(input.database, {
        agent_id: agentId,
        task_id: taskId,
        conversation_id: conversationId,
        type: "profile.sync.skipped",
        payload: {
          source: input.source,
          reason: skippedReason,
          memoryIds: input.memories.map((memory) => memory.id),
        },
      });
      return { status: "skipped", applied: [], skippedReason };
    }

    appendProfileSyncEvent(input.database, {
      agent_id: agentId,
      task_id: taskId,
      conversation_id: conversationId,
      type: "profile.sync.completed",
      payload: {
        source: input.source,
        memoryIds: input.memories.map((memory) => memory.id),
        updates: applied.map((update) => ({
          file: update.kind === "soul" ? "soul.md" : "user.md",
          section: update.section,
          bullet: update.bullet,
        })),
        reason: input.reason ?? "",
        sourceEventIds: input.sourceEventIds ?? [],
      },
    });

    return { status: "completed", applied };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendProfileSyncEvent(input.database, {
      agent_id: agentId,
      task_id: taskId,
      conversation_id: conversationId,
      type: "profile.sync.failed",
      payload: {
        source: input.source,
        memoryIds: input.memories.map((memory) => memory.id),
        error: message,
      },
    });
    return { status: "failed", applied: [], error: message };
  }
}
