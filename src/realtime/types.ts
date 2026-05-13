export interface RealtimeSubscribeMessage {
  type: "subscribe";
  agentIds?: string[];
  sessionIds?: string[];
}

export interface RealtimePingMessage {
  type: "ping";
}

export type RealtimeClientMessage = RealtimeSubscribeMessage | RealtimePingMessage;

export interface RealtimeServerMessage {
  type: string;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  eventId?: string;
  delegationId?: string;
  payload?: unknown;
  createdAt: number;
}

export interface RealtimeSubscription {
  agentIds: Set<string>;
  sessionIds: Set<string>;
}

export interface RealtimeSocketData {
  id: string;
  subscription: RealtimeSubscription;
}
