import { DefaultChatTransport, type UIMessage } from "ai";

interface CreateChatTransportOptions {
  fetch?: typeof fetch;
  getSessionId: () => string | null;
  getAgentId: () => string;
  getThinkingEnabled: () => boolean;
}

function stringFromBody(body: Record<string, unknown> | undefined, key: string): string | null {
  const value = body?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function booleanFromBody(body: Record<string, unknown> | undefined, key: string): boolean | null {
  const value = body?.[key];
  return typeof value === "boolean" ? value : null;
}

export function createChatTransport(options: CreateChatTransportOptions): DefaultChatTransport<UIMessage> {
  return new DefaultChatTransport({
    api: "/api/chat",
    fetch: options.fetch,
    prepareSendMessagesRequest: ({
      api,
      id,
      messages,
      body,
      headers,
      credentials,
      trigger,
      messageId,
    }) => ({
      api,
      headers,
      credentials,
      body: {
        ...body,
        id,
        messages,
        trigger,
        messageId,
        sessionId: stringFromBody(body, "sessionId") ?? options.getSessionId(),
        agentId: stringFromBody(body, "agentId") ?? options.getAgentId(),
        thinkingEnabled: booleanFromBody(body, "thinkingEnabled") ?? options.getThinkingEnabled(),
      },
    }),
  });
}
