import { registerLifecycleHook } from "../lifecycle/hooks";
import { enqueueMemoryExtraction } from "./extraction-worker";

let registered = false;

export function registerMemoryLifecycleHooks(): void {
  if (registered) return;
  registered = true;

  registerLifecycleHook("assistant.message.persisted", (event) => {
    void enqueueMemoryExtraction({
      agentId: event.agentId,
      taskId: event.taskId,
      conversationId: event.conversationId,
      sessionId: event.sessionId,
      assistantMessageId: event.assistantMessageId,
      userText: event.userText,
      assistantText: event.assistantText,
      database: event.database,
    }).catch((error) => {
      console.error("[memory-worker] extraction failed:", error);
    });
  });
}
