import { registerLifecycleHook } from "../lifecycle/hooks";
import { getDb } from "../core/database";
import { enqueueMemoryExtraction, persistExtractionFailure } from "./extraction-worker";

let registered = false;

/**
 * 注册记忆系统需要的生命周期 hook。
 *
 * 这个时机比 assistant.message.completed 更晚，但能拿到 assistantMessageId，
 * 因此后台 worker 可以把“记忆提取/再巩固”的合成工具卡写回同一条助手消息。
 */
export function registerMemoryLifecycleHooks(): void {
  if (registered) return;
  registered = true;

  registerLifecycleHook("assistant.message.persisted", (event) => {
    const job = {
      agentId: event.agentId,
      userId: event.userId,
      taskId: event.taskId,
      conversationId: event.conversationId,
      sessionId: event.sessionId,
      assistantMessageId: event.assistantMessageId,
      userText: event.userText,
      assistantText: event.assistantText,
      database: event.database,
    };
    void enqueueMemoryExtraction(job).catch((error) => {
      const database = event.database ?? getDb();
      persistExtractionFailure(database, event.assistantMessageId, event.agentId, error, job);
      console.error("[memory-worker] extraction failed:", error);
    });
  });
}
