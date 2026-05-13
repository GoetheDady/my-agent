import type { ServerWebSocket } from "bun";
import type {
  RealtimeClientMessage,
  RealtimeServerMessage,
  RealtimeSocketData,
  RealtimeSubscription,
} from "./types";

function createSubscription(input?: Partial<{ agentIds: string[]; sessionIds: string[] }>): RealtimeSubscription {
  return {
    agentIds: new Set((input?.agentIds ?? []).map((id) => id.trim()).filter(Boolean)),
    sessionIds: new Set((input?.sessionIds ?? []).map((id) => id.trim()).filter(Boolean)),
  };
}

function parseClientMessage(raw: string | Buffer): RealtimeClientMessage | null {
  try {
    const text = typeof raw === "string" ? raw : raw.toString("utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const message = parsed as Record<string, unknown>;
    if (message.type === "ping") return { type: "ping" };
    if (message.type === "subscribe") {
      return {
        type: "subscribe",
        agentIds: Array.isArray(message.agentIds) ? message.agentIds.map(String) : undefined,
        sessionIds: Array.isArray(message.sessionIds) ? message.sessionIds.map(String) : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function matchesSubscription(event: RealtimeServerMessage, subscription: RealtimeSubscription): boolean {
  const agentRestricted = subscription.agentIds.size > 0;
  const sessionRestricted = subscription.sessionIds.size > 0;
  if (!agentRestricted && !sessionRestricted) return true;

  const agentMatched = Boolean(event.agentId && subscription.agentIds.has(event.agentId));
  const sessionMatched = Boolean(event.sessionId && subscription.sessionIds.has(event.sessionId));
  return agentMatched || sessionMatched;
}

/**
 * RealtimeService 管理浏览器 WebSocket 长连接。
 *
 * WebSocket 是浏览器和后端之间的实时通道；这里推送的是“数据变化通知”，
 * 不是事实数据本身。前端收到通知后再用 HTTP API 拉取最新事实状态。
 */
export class RealtimeService {
  private readonly sockets = new Set<ServerWebSocket<RealtimeSocketData>>();

  createSocketData(): RealtimeSocketData {
    return {
      id: crypto.randomUUID(),
      subscription: createSubscription(),
    };
  }

  addSocket(socket: ServerWebSocket<RealtimeSocketData>): void {
    this.sockets.add(socket);
    this.send(socket, {
      type: "realtime.connected",
      payload: { socketId: socket.data.id },
      createdAt: Date.now(),
    });
  }

  removeSocket(socket: ServerWebSocket<RealtimeSocketData>): void {
    this.sockets.delete(socket);
  }

  handleMessage(socket: ServerWebSocket<RealtimeSocketData>, raw: string | Buffer): void {
    const message = parseClientMessage(raw);
    if (!message) {
      this.send(socket, {
        type: "realtime.error",
        payload: { error: "invalid_message" },
        createdAt: Date.now(),
      });
      return;
    }

    if (message.type === "ping") {
      this.send(socket, { type: "pong", createdAt: Date.now() });
      return;
    }

    socket.data.subscription = createSubscription({
      agentIds: message.agentIds,
      sessionIds: message.sessionIds,
    });
    this.send(socket, {
      type: "realtime.subscribed",
      payload: {
        agentIds: Array.from(socket.data.subscription.agentIds),
        sessionIds: Array.from(socket.data.subscription.sessionIds),
      },
      createdAt: Date.now(),
    });
  }

  broadcast(event: Omit<RealtimeServerMessage, "createdAt"> & { createdAt?: number }): void {
    const message: RealtimeServerMessage = {
      ...event,
      createdAt: event.createdAt ?? Date.now(),
    };
    for (const socket of this.sockets) {
      if (!matchesSubscription(message, socket.data.subscription)) continue;
      this.send(socket, message);
    }
  }

  private send(socket: ServerWebSocket<RealtimeSocketData>, message: RealtimeServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      this.removeSocket(socket);
    }
  }
}

export const defaultRealtimeService = new RealtimeService();
