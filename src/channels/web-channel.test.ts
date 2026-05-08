import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listConversationEvents } from "../events/event-log";
import { getTask } from "../tasks/task-store";
import { WebChannelAdapter } from "./web-channel";

async function withWebChannelDb<T>(
  run: (db: Database, adapter: WebChannelAdapter) => T | Promise<T>,
): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const adapter = new WebChannelAdapter(db);

  try {
    return await run(db, adapter);
  } finally {
    db.close();
  }
}

describe("web channel adapter", () => {
  test("web message maps to conversation_id", async () => {
    await withWebChannelDb(async (_db, adapter) => {
      const result = await adapter.receive({
        externalConversationId: "session-1",
        text: "hello",
      });

      expect(result.conversationId).toBe("session-1");
      expect(result.task.conversation_id).toBe("session-1");
    });
  });

  test("same web session maps to the same conversation", async () => {
    await withWebChannelDb(async (db, adapter) => {
      const first = await adapter.receive({ externalConversationId: "session-1", text: "one" });
      const second = await adapter.receive({ externalConversationId: "session-1", text: "two" });
      const count = db
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM conversations")
        .get();

      expect(second.conversationId).toBe(first.conversationId);
      expect(count?.count).toBe(1);
    });
  });

  test("channel input creates a queued task for default agent", async () => {
    await withWebChannelDb(async (db, adapter) => {
      const result = await adapter.receive({
        externalConversationId: "session-1",
        externalUserId: "user-1",
        text: "run this",
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

  test("web receive writes task and user events", async () => {
    await withWebChannelDb(async (db, adapter) => {
      await adapter.receive({
        externalConversationId: "session-1",
        externalUserId: "user-1",
        text: "run this",
      });

      expect(listConversationEvents("session-1", db).map((event) => event.type)).toEqual([
        "task.created",
        "user.message",
      ]);
    });
  });
});
