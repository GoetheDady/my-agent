import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import type { ChannelConversationRecord } from "./types";

function normalizeChannel(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * ChannelConversationStore 封装外部会话到内部 conversation 的映射。
 *
 * Web 的 sessionId、飞书 thread id、微信群/单聊 id 都会在这里映射成内部 conversationId。
 */
export class ChannelConversationStore {
  constructor(private readonly database: Database = getDb()) {}

  ensureConversation(input: {
    agentId: string;
    channel: string;
    externalConversationId: string;
    title?: string;
  }): ChannelConversationRecord {
    const channel = normalizeChannel(input.channel);
    const externalConversationId = input.externalConversationId.trim();
    const existing = this.getConversation(channel, externalConversationId);
    if (existing) {
      this.database
        .query("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(Date.now(), existing.id);
      return this.getConversation(channel, externalConversationId) ?? existing;
    }

    const now = Date.now();
    const record: ChannelConversationRecord = {
      id: channel === "web" ? externalConversationId : crypto.randomUUID(),
      agent_id: input.agentId,
      channel,
      external_id: externalConversationId,
      title: input.title?.trim() || "新对话",
      created_at: now,
      updated_at: now,
    };

    this.database
      .query(
        `INSERT INTO conversations (id, agent_id, channel, external_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.agent_id,
        record.channel,
        record.external_id,
        record.title,
        record.created_at,
        record.updated_at,
      );

    return record;
  }

  getConversation(channel: string, externalConversationId: string): ChannelConversationRecord | null {
    return this.database
      .query<ChannelConversationRecord, [string, string]>(
        `SELECT id, agent_id, channel, external_id, title, created_at, updated_at
         FROM conversations
         WHERE channel = ? AND external_id = ?`,
      )
      .get(normalizeChannel(channel), externalConversationId.trim()) ?? null;
  }
}
