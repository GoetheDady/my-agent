export interface NormalizedToolPart {
  toolName: string;
  args: Record<string, unknown>;
  state: string;
  toolCallId?: string;
  approvalId?: string;
  errorText?: string;
  output?: unknown;
}

interface UnknownToolPart {
  type?: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id?: string };
  toolInvocation?: {
    toolName?: string;
    args?: Record<string, unknown>;
    state?: string;
    toolCallId?: string;
  };
}

const legacyStateMap: Record<string, string> = {
  call: "input-available",
  result: "output-available",
  "partial-result": "output-available",
  error: "output-error",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeState(state: string | undefined): string {
  if (!state) return "input-available";
  return legacyStateMap[state] ?? state;
}

function outputProperty(output: unknown): Pick<NormalizedToolPart, "output"> | Record<string, never> {
  return output === undefined ? {} : { output };
}

export function getNormalizedToolPart(part: unknown): NormalizedToolPart | null {
  const candidate = part as UnknownToolPart;

  if (candidate.type === "tool-invocation" && candidate.toolInvocation) {
    return {
      toolName: candidate.toolInvocation.toolName ?? "",
      args: candidate.toolInvocation.args ?? {},
      state: normalizeState(candidate.toolInvocation.state),
      toolCallId: candidate.toolInvocation.toolCallId,
      approvalId: candidate.toolInvocation.toolCallId,
      ...outputProperty((candidate.toolInvocation as { output?: unknown }).output),
    };
  }

  if (candidate.type?.startsWith("tool-")) {
    return {
      toolName: candidate.type.slice("tool-".length),
      args: asRecord(candidate.input),
      state: normalizeState(candidate.state),
      toolCallId: candidate.toolCallId,
      approvalId: candidate.approval?.id ?? candidate.toolCallId,
      errorText: candidate.errorText,
      ...outputProperty(candidate.output),
    };
  }

  if (candidate.type === "dynamic-tool") {
    return {
      toolName: candidate.toolName ?? "",
      args: asRecord(candidate.input),
      state: normalizeState(candidate.state),
      toolCallId: candidate.toolCallId,
      approvalId: candidate.approval?.id ?? candidate.toolCallId,
      errorText: candidate.errorText,
      ...outputProperty(candidate.output),
    };
  }

  return null;
}
