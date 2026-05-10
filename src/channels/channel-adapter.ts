import type { TaskRecord } from "../tasks/task-types";

// Channel Adapter 是渠道适配器：把 Web、微信、飞书等外部输入统一转换成内部 task。
// receive 负责“外部消息进入系统”，deliver 负责“系统结果回到外部渠道”。
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
