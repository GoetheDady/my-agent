export interface DisplayBlock {
  type: "text" | "thinking" | "tool_use";
  content: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  collapsed?: boolean;
  memoryStatus?: "loading" | "success" | "error";
  memoryCount?: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  blocks: DisplayBlock[];
}

export interface SSETextDelta {
  content: string;
}

export interface SSEThinking {
  content: string;
}

export interface SSEToolStart {
  name: string;
}

export interface SSEToolDone {
  name: string;
  input: Record<string, unknown>;
}

export interface SSEDone {
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

export interface SSEError {
  message: string;
}

export type SSEEventData =
  | SSETextDelta
  | SSEThinking
  | SSEToolStart
  | SSEToolDone
  | SSEDone
  | SSEError;

export interface Session {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}
