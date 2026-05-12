import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listConversationEvents } from "../events/event-log";
import { getTask } from "../tasks/task-store";
import { FeishuChannelAdapter } from "./feishu-channel";
import { ChannelService } from "./service";
import { WebChannelAdapter } from "./web-channel";
import { WeChatChannelAdapter } from "./wechat-channel";

function createChannelDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return db;
}

async function withChannelService<T>(
  run: (db: Database, service: ChannelService) => T | Promise<T>,
): Promise<T> {
  const db = createChannelDb();
  const service = new ChannelService({
    database: db,
    adapters: [
      new WebChannelAdapter(),
      new FeishuChannelAdapter(),
      new WeChatChannelAdapter(),
    ],
  });

  try {
    return await run(db, service);
  } finally {
    db.close();
  }
}

describe("ChannelService", () => {
  test("web message maps to conversation_id and creates a queued task", async () => {
    await withChannelService(async (db, service) => {
      const result = service.receiveMessage({
        channel: "web",
        externalConversationId: "session-1",
        externalUserId: "user-1",
        text: "run this",
      }, db);

      expect(result).toMatchObject({
        channel: "web",
        agentId: "default",
        userId: "user-1",
        conversationId: "session-1",
      });
      expect(getTask(result.task.id, db)).toMatchObject({
        agent_id: "default",
        conversation_id: "session-1",
        source_channel: "web",
        source_user_id: "user-1",
        status: "queued",
        input: "run this",
      });
    });
  });

  test("same channel conversation is reused", async () => {
    await withChannelService(async (db, service) => {
      const first = service.receiveMessage({ channel: "web", externalConversationId: "session-1", text: "one" }, db);
      const second = service.receiveMessage({ channel: "web", externalConversationId: "session-1", text: "two" }, db);
      const count = db
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM conversations")
        .get();

      expect(second.conversationId).toBe(first.conversationId);
      expect(count?.count).toBe(1);
    });
  });

  test("same channel user identity is reused and missing external user falls back to default", async () => {
    await withChannelService(async (db, service) => {
      const first = service.receiveMessage({
        channel: "web",
        externalConversationId: "session-1",
        externalUserId: "user-1",
        text: "one",
      }, db);
      const second = service.receiveMessage({
        channel: "web",
        externalConversationId: "session-2",
        externalUserId: "user-1",
        text: "two",
      }, db);
      const fallback = service.receiveMessage({
        channel: "web",
        externalConversationId: "session-3",
        text: "three",
      }, db);
      const count = db
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM channel_identities")
        .get();

      expect(second.userId).toBe(first.userId);
      expect(fallback.userId).toBe("default");
      expect(count?.count).toBe(2);
    });
  });

  test("receiveMessage writes task and user events with channel context", async () => {
    await withChannelService(async (db, service) => {
      const result = service.receiveMessage({
        channel: "web",
        externalConversationId: "session-1",
        externalUserId: "user-1",
        text: "run this",
      }, db);

      const events = listConversationEvents(result.conversationId, db);
      expect(events.map((event) => event.type)).toEqual(["task.created", "user.message"]);
      expect(JSON.parse(events[1].payload)).toMatchObject({
        channel: "web",
        externalConversationId: "session-1",
        externalUserId: "user-1",
        userId: "user-1",
      });
    });
  });

  test("adapter registry lists default channels and rejects unknown channel", async () => {
    await withChannelService(async (_db, service) => {
      expect(service.listChannels()).toEqual(["feishu", "web", "wechat"]);
      expect(service.getAdapter("web")).toBeInstanceOf(WebChannelAdapter);
      expect(() => service.receiveMessage({
        channel: "unknown",
        externalConversationId: "session-1",
        text: "hello",
      })).toThrow("Channel adapter not registered");
    });
  });

  test("stub channels are registered but delivery is not implemented", async () => {
    await withChannelService(async (_db, service) => {
      await expect(service.deliverMessage({
        channel: "feishu",
        conversationId: "conversation-1",
        text: "hello",
      })).rejects.toThrow("Feishu channel delivery is not implemented");
    });
  });
});
