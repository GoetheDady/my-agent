import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import type { ChannelIdentityRecord } from "./types";

const DEFAULT_USER_ID = "default";

function normalizeChannel(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeExternalUserId(value?: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : DEFAULT_USER_ID;
}

/**
 * ChannelIdentityStore 封装外部用户到内部 userId 的映射。
 *
 * 这里不做账号体系，只保证不同渠道的 external_user_id 能稳定映射到内部 user_id。
 */
export class ChannelIdentityStore {
  constructor(private readonly database: Database = getDb()) {}

  ensureIdentity(input: {
    channel: string;
    externalUserId?: string;
    displayName?: string;
    userId?: string;
  }): ChannelIdentityRecord {
    const channel = normalizeChannel(input.channel);
    const externalUserId = normalizeExternalUserId(input.externalUserId);
    const existing = this.getIdentity(channel, externalUserId);
    if (existing) {
      this.database
        .query("UPDATE channel_identities SET updated_at = ? WHERE id = ?")
        .run(Date.now(), existing.id);
      return this.getIdentity(channel, externalUserId) ?? existing;
    }

    const now = Date.now();
    const record: ChannelIdentityRecord = {
      id: crypto.randomUUID(),
      user_id: input.userId?.trim() || externalUserId,
      channel,
      external_user_id: externalUserId,
      display_name: input.displayName?.trim() ?? "",
      created_at: now,
      updated_at: now,
    };

    this.database
      .query(
        `INSERT INTO channel_identities (id, user_id, channel, external_user_id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.user_id,
        record.channel,
        record.external_user_id,
        record.display_name,
        record.created_at,
        record.updated_at,
      );

    return record;
  }

  getIdentity(channel: string, externalUserId?: string): ChannelIdentityRecord | null {
    return this.database
      .query<ChannelIdentityRecord, [string, string]>(
        `SELECT id, user_id, channel, external_user_id, display_name, created_at, updated_at
         FROM channel_identities
         WHERE channel = ? AND external_user_id = ?`,
      )
      .get(normalizeChannel(channel), normalizeExternalUserId(externalUserId)) ?? null;
  }
}
