import type { TaskRecord } from "../tasks/task-types";

export interface ChannelMessageInput {
  channel: string;
  externalConversationId: string;
  externalUserId?: string;
  text: string;
  agentId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelReceiveResult {
  channel: string;
  agentId: string;
  userId: string;
  conversationId: string;
  task: TaskRecord;
}

export interface ChannelMessageOutput {
  channel: string;
  conversationId: string;
  text: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelAdapter {
  readonly channel: string;
  deliver(output: ChannelMessageOutput): Promise<void>;
}

export interface ChannelIdentityRecord {
  id: string;
  user_id: string;
  channel: string;
  external_user_id: string;
  display_name: string;
  created_at: number;
  updated_at: number;
}

export interface ChannelConversationRecord {
  id: string;
  agent_id: string;
  channel: string;
  external_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}
