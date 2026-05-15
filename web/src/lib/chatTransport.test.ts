import { describe, expect, mock, test } from "bun:test";
import { createChatTransport } from "./chatTransport";

function emptyStreamResponse(): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.close();
    },
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("createChatTransport", () => {
  test("adds current chat context to automatic approval continuation requests", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return emptyStreamResponse();
    });
    const transport = createChatTransport({
      fetch: fetchMock as unknown as typeof fetch,
      getSessionId: () => "session-1",
      getAgentId: () => "agent-1",
      getThinkingEnabled: () => true,
    });

    await transport.sendMessages({
      chatId: "chat-1",
      messages: [{ id: "assistant-1", role: "assistant", parts: [] }],
      trigger: "submit-message",
      messageId: "assistant-1",
    });

    expect(requestBody).toMatchObject({
      id: "chat-1",
      sessionId: "session-1",
      agentId: "agent-1",
      thinkingEnabled: true,
      trigger: "submit-message",
      messageId: "assistant-1",
    });
  });
});
