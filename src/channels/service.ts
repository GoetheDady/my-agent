import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { createTask } from "../tasks/task-store";
import { getAgent } from "../agents/agent-registry";
import { FeishuChannelAdapter } from "./feishu-channel";
import { WebChannelAdapter } from "./web-channel";
import { WeChatChannelAdapter } from "./wechat-channel";
import { ChannelConversationStore } from "./conversation-store";
import { ChannelIdentityStore } from "./identity-store";
import type {
  ChannelAdapter,
  ChannelMessageInput,
  ChannelMessageOutput,
  ChannelReceiveResult,
} from "./types";

function normalizeChannel(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * ChannelService 是所有外部消息入口的统一服务层。
 *
 * 它不关心某个渠道的 SDK 细节，只负责把标准化后的输入转换为内部
 * identity、conversation、task 和 runtime events。
 */
export class ChannelService {
  private readonly adapters = new Map<string, ChannelAdapter>();
  private readonly identityStore: ChannelIdentityStore;
  private readonly conversationStore: ChannelConversationStore;

  constructor(options: {
    database?: Database;
    identityStore?: ChannelIdentityStore;
    conversationStore?: ChannelConversationStore;
    adapters?: ChannelAdapter[];
  } = {}) {
    const database = options.database ?? getDb();
    this.identityStore = options.identityStore ?? new ChannelIdentityStore(database);
    this.conversationStore = options.conversationStore ?? new ChannelConversationStore(database);
    for (const adapter of options.adapters ?? []) {
      this.registerAdapter(adapter);
    }
  }

  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(normalizeChannel(adapter.channel), adapter);
  }

  getAdapter(channel: string): ChannelAdapter | null {
    return this.adapters.get(normalizeChannel(channel)) ?? null;
  }

  listChannels(): string[] {
    return Array.from(this.adapters.keys()).sort();
  }

  receiveMessage(input: ChannelMessageInput, database: Database = getDb()): ChannelReceiveResult {
    const channel = normalizeChannel(input.channel);
    const adapter = this.getAdapter(channel);
    if (!adapter) {
      throw new Error(`Channel adapter not registered: ${channel}`);
    }
    if (!input.externalConversationId.trim()) {
      throw new Error("externalConversationId 不能为空");
    }
    if (!input.text.trim()) {
      throw new Error("text 不能为空");
    }

    const agentId = input.agentId?.trim() || "default";
    if (!getAgent(agentId, database)) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const identity = this.identityStore.ensureIdentity({
      channel,
      externalUserId: input.externalUserId,
    });
    const conversation = this.conversationStore.ensureConversation({
      agentId,
      channel,
      externalConversationId: input.externalConversationId,
    });
    const task = createTask(
      {
        agent_id: agentId,
        conversation_id: conversation.id,
        source_channel: channel,
        source_user_id: identity.user_id,
        input: input.text,
        idempotency_key: input.idempotency_key,
      },
      database,
    );
    const eventBaseTime = Date.now();

    appendEvent({
      agent_id: agentId,
      task_id: task.id,
      conversation_id: conversation.id,
      type: "task.created",
      payload: {
        input: input.text,
        source_channel: channel,
        channel,
        externalConversationId: input.externalConversationId,
        externalUserId: identity.external_user_id,
        metadata: input.metadata ?? {},
      },
      created_at: eventBaseTime + 1,
    }, database);
    appendEvent({
      agent_id: agentId,
      task_id: task.id,
      conversation_id: conversation.id,
      type: "user.message",
      payload: {
        text: input.text,
        channel,
        externalConversationId: input.externalConversationId,
        externalUserId: identity.external_user_id,
        userId: identity.user_id,
        metadata: input.metadata ?? {},
      },
      created_at: eventBaseTime + 2,
    }, database);

    return {
      channel,
      agentId,
      userId: identity.user_id,
      conversationId: conversation.id,
      task,
    };
  }

  async deliverMessage(output: ChannelMessageOutput): Promise<void> {
    const channel = normalizeChannel(output.channel);
    const adapter = this.getAdapter(channel);
    if (!adapter) {
      throw new Error(`Channel adapter not registered: ${channel}`);
    }
    await adapter.deliver({ ...output, channel });
  }
}

export function createDefaultChannelService(database: Database = getDb()): ChannelService {
  return new ChannelService({
    database,
    adapters: [
      new WebChannelAdapter(),
      new FeishuChannelAdapter(),
      new WeChatChannelAdapter(),
    ],
  });
}

export const defaultChannelService = createDefaultChannelService();
