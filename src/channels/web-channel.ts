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

export class WebChannelAdapter implements ChannelAdapter {
  readonly channel = "web";

  constructor(private readonly database: Database = getDb()) {}

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

  async deliver(_output: ChannelOutput): Promise<void> {
    return Promise.resolve();
  }

  private ensureConversation(agentId: string, externalConversationId: string): ConversationRow {
    const existing = this.getConversation(externalConversationId);
    if (existing) {
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
