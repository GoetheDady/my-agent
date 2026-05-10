import type { Database } from "bun:sqlite";

export type LifecycleHookType = "assistant.message.persisted";

export interface AssistantMessagePersistedEvent {
  type: "assistant.message.persisted";
  agentId: string;
  userId?: string;
  taskId: string;
  conversationId: string | null;
  sessionId: string;
  assistantMessageId: string;
  userText: string;
  assistantText: string;
  createdAt: number;
  database?: Database;
}

export type LifecycleHookEvent = AssistantMessagePersistedEvent;

export type LifecycleHookHandler<T extends LifecycleHookEvent = LifecycleHookEvent> = (
  event: T,
) => void | Promise<void>;

const handlers = new Map<LifecycleHookType, Set<LifecycleHookHandler>>();

/**
 * 注册生命周期 hook 处理器。
 *
 * 设计目的：把“主聊天回复”与“回复完成后的后台工作”解耦。
 * 例如 assistant.message.persisted 触发后，记忆 worker 可以异步提取记忆；
 * hook 失败只会记录日志，不会影响已经保存的聊天消息。
 *
 * @param type 生命周期事件类型。
 * @param handler 事件处理器。
 * @returns 取消注册函数。
 */
export function registerLifecycleHook<T extends LifecycleHookEvent>(
  type: T["type"],
  handler: LifecycleHookHandler<T>,
): () => void {
  const existing = handlers.get(type) ?? new Set<LifecycleHookHandler>();
  existing.add(handler as LifecycleHookHandler);
  handlers.set(type, existing);

  return () => {
    existing.delete(handler as LifecycleHookHandler);
  };
}

/**
 * 触发生命周期事件。
 *
 * 所有处理器会以微任务异步执行，避免阻塞当前 HTTP 响应或 stream 完成回调。
 *
 * @param event 生命周期事件 payload。
 */
export function emitLifecycleHook(event: LifecycleHookEvent): void {
  const matchedHandlers = handlers.get(event.type);
  if (!matchedHandlers || matchedHandlers.size === 0) return;

  for (const handler of matchedHandlers) {
    // 使用微任务异步执行，避免 hook handler 阻塞 HTTP 响应或 stream 完成回调。
    Promise.resolve()
      .then(() => handler(event))
      .catch((error) => {
        console.error("[lifecycle] hook failed:", event.type, error);
      });
  }
}

/**
 * 清空已注册的生命周期 hook。
 *
 * 仅供测试使用，避免测试之间残留 handler。
 */
export function clearLifecycleHooksForTest(): void {
  handlers.clear();
}
