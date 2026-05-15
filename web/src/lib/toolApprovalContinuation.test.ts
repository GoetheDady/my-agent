import { describe, expect, mock, test } from "bun:test";
import { continueToolApprovalOnce } from "./toolApprovalContinuation";

describe("continueToolApprovalOnce", () => {
  test("records approval response and submits the current chat once", async () => {
    const continued = new Set<string>();
    const addToolApprovalResponse = mock(async () => {});
    const sendMessage = mock(async () => {});

    await continueToolApprovalOnce({
      continued,
      toolCallId: "approval-1",
      approved: true,
      getBody: () => ({ sessionId: "session-1", agentId: "default", thinkingEnabled: false }),
      addToolApprovalResponse,
      sendMessage,
    });
    await continueToolApprovalOnce({
      continued,
      toolCallId: "approval-1",
      approved: true,
      getBody: () => ({ sessionId: "session-1", agentId: "default", thinkingEnabled: false }),
      addToolApprovalResponse,
      sendMessage,
    });

    expect(addToolApprovalResponse).toHaveBeenCalledTimes(1);
    expect(addToolApprovalResponse).toHaveBeenCalledWith({
      id: "approval-1",
      approved: true,
      reason: undefined,
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(undefined, {
      body: { sessionId: "session-1", agentId: "default", thinkingEnabled: false },
    });
  });
});
