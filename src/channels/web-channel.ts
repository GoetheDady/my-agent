import type { Database } from "bun:sqlite";
import { appendEvent } from "../events/event-log";
import { getDb } from "../core/database";
import { createTask } from "../tasks/task-store";
import type {
  ChannelAdapter,
  ChannelInput,
  ChannelOutput,
  ChannelReceiveResult,
} from "./channel-adapter";

type ConversationRow = {
  id: string;
  agent_id: string;
  channel: string;
  external_id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

/**
 * Web 渠道适配器。
 *
 * 负责把浏览器 session 消息转换为内部 conversation 和 task，
 * 让后端 runtime 可以用统一方式处理 Web、微信、飞书等不同渠道。
 */
export class WebChannelAdapter implements ChannelAdapter {
  readonly channel = "web";

  /**
   * 创建 Web 渠道适配器。
   *
   * @param database 可选数据库连接。
   */
  constructor(private readonly database: Database = getDb()) {}

  /**
   * 接收 Web 前端的一条用户消息，并转换成内部任务。
   *
   * 这里不调用模型，只做三件事：确保 conversation 存在、创建 queued task、
   * 写 task.created 和 user.message 事件，作为后续记忆证据链。
   *
   * @param input Web 渠道输入，包括 session id、用户 id 和文本。
   * @returns 内部 conversation id、目标 Agent 和新建 task。
   */
  async receive(input: ChannelInput): Promise<ChannelReceiveResult> {
    const agentId = input.agentId ?? "default";
    const externalUserId = input.externalUserId ?? "default";
    const conversation = this.ensureConversation(agentId, input.externalConversationId);
    const task = createTask(
      {
        agent_id: agentId,
        conversation_id: conversation.id,
        source_channel: this.channel,
        source_user_id: externalUserId,
        input: input.text,
      },
      this.database,
    );
    const eventBaseTime = Date.now();

    appendEvent({
      agent_id: agentId,
      task_id: task.id,
      conversation_id: conversation.id,
      type: "task.created",
      payload: { input: input.text, source_channel: this.channel },
      created_at: eventBaseTime + 1,
    }, this.database);
    appendEvent({
      agent_id: agentId,
      task_id: task.id,
      conversation_id: conversation.id,
      type: "user.message",
      payload: { text: input.text, externalUserId },
      created_at: eventBaseTime + 2,
    }, this.database);

    return { agentId, conversationId: conversation.id, task };
  }

  /**
   * 向 Web 渠道投递输出。
   *
   * Web 当前通过 HTTP stream 直接返回模型输出，因此这里是空实现。
   *
   * @param _output 渠道输出，占位参数。
   */
  async deliver(_output: ChannelOutput): Promise<void> {
    // Web 场景下模型输出通过 HTTP stream 直接回到前端，不需要额外投递。
    return Promise.resolve();
  }

  private ensureConversation(agentId: string, externalConversationId: string): ConversationRow {
    const existing = this.getConversation(externalConversationId);
    if (existing) {
      // 同一个 sessionId 复用同一个 conversation，只刷新 updated_at。
      this.database
        .query("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(Date.now(), existing.id);
      return this.getConversation(externalConversationId) ?? existing;
    }

    const now = Date.now();
    this.database
      .query(
        `INSERT INTO conversations (id, agent_id, channel, external_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, '新对话', ?, ?)`,
      )
      .run(externalConversationId, agentId, this.channel, externalConversationId, now, now);

    const created = this.getConversation(externalConversationId);
    if (!created) {
      throw new Error(`Failed to create web conversation: ${externalConversationId}`);
    }
    return created;
  }

  private getConversation(externalConversationId: string): ConversationRow | null {
    return this.database
      .query<ConversationRow, [string, string]>(
        `SELECT id, agent_id, channel, external_id, title, created_at, updated_at
         FROM conversations
         WHERE channel = ? AND external_id = ?`,
      )
      .get(this.channel, externalConversationId) ?? null;
  }
}
