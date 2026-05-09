import type { Database } from "bun:sqlite";

export type LifecycleHookType = "assistant.message.persisted";

export interface AssistantMessagePersistedEvent {
  type: "assistant.message.persisted";
  agentId: string;
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

export function emitLifecycleHook(event: LifecycleHookEvent): void {
  const matchedHandlers = handlers.get(event.type);
  if (!matchedHandlers || matchedHandlers.size === 0) return;

  for (const handler of matchedHandlers) {
    Promise.resolve()
      .then(() => handler(event))
      .catch((error) => {
        console.error("[lifecycle] hook failed:", event.type, error);
      });
  }
}

export function clearLifecycleHooksForTest(): void {
  handlers.clear();
}
