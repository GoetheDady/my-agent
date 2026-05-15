interface ContinueToolApprovalInput {
  continued: Set<string>;
  toolCallId: string;
  approved: boolean;
  reason?: string;
  getBody: () => Record<string, unknown>;
  addToolApprovalResponse: (input: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => PromiseLike<void> | void;
  sendMessage: (
    message: undefined,
    options: { body: Record<string, unknown> },
  ) => PromiseLike<void> | void;
}

export async function continueToolApprovalOnce(input: ContinueToolApprovalInput): Promise<void> {
  if (!input.toolCallId || input.continued.has(input.toolCallId)) return;
  input.continued.add(input.toolCallId);
  try {
    await input.addToolApprovalResponse({
      id: input.toolCallId,
      approved: input.approved,
      reason: input.reason,
    });
    await input.sendMessage(undefined, {
      body: input.getBody(),
    });
  } catch (error) {
    input.continued.delete(input.toolCallId);
    throw error;
  }
}
