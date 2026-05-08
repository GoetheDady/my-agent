import type { TaskRecord } from "../tasks/task-types";

export interface ChannelInput {
  agentId?: string;
  externalConversationId: string;
  externalUserId?: string;
  text: string;
}

export interface ChannelReceiveResult {
  agentId: string;
  conversationId: string;
  task: TaskRecord;
}

export interface ChannelOutput {
  conversationId: string;
  text: string;
}

export interface ChannelAdapter {
  readonly channel: string;
  receive(input: ChannelInput): Promise<ChannelReceiveResult>;
  deliver(output: ChannelOutput): Promise<void>;
}
