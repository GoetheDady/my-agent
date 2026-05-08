import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { createTask } from "../tasks/task-store";
import {
  appendEvent,
  listAgentEvents,
  listConversationEvents,
  listTaskEvents,
} from "./event-log";

function withEventDb<T>(run: (db: Database) => T): T {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);

  try {
    return run(db);
  } finally {
    db.close();
  }
}

describe("event log", () => {
  test("appendEvent stores an event", () => {
    withEventDb((db) => {
      const event = appendEvent(
        { id: "event-1", type: "user.message", payload: { text: "hello" }, created_at: 1 },
        db,
      );

      expect(event).toMatchObject({
        id: "event-1",
        agent_id: "default",
        type: "user.message",
        payload: "{\"text\":\"hello\"}",
        created_at: 1,
      });
    });
  });

  test("listTaskEvents returns events for one task in chronological order", () => {
    withEventDb((db) => {
      createTask({ id: "task-1", source_channel: "web", input: "one" }, db);
      createTask({ id: "task-2", source_channel: "web", input: "two" }, db);
      appendEvent({ id: "late", task_id: "task-1", type: "task.completed", created_at: 3 }, db);
      appendEvent({ id: "other", task_id: "task-2", type: "task.started", created_at: 1 }, db);
      appendEvent({ id: "early", task_id: "task-1", type: "task.started", created_at: 2 }, db);

      expect(listTaskEvents("task-1", db).map((event) => event.id)).toEqual(["early", "late"]);
    });
  });

  test("listConversationEvents returns events for one conversation", () => {
    withEventDb((db) => {
      appendEvent(
        {
          id: "conversation-event",
          conversation_id: "conversation-1",
          type: "assistant.message",
          created_at: 1,
        },
        db,
      );
      appendEvent(
        { id: "other-event", conversation_id: "conversation-2", type: "assistant.message" },
        db,
      );

      expect(listConversationEvents("conversation-1", db).map((event) => event.id)).toEqual([
        "conversation-event",
      ]);
    });
  });

  test("payload round-trips JSON safely", () => {
    withEventDb((db) => {
      const payload = {
        text: "hello",
        nested: { ok: true },
        array: [1, "two", null],
      };

      appendEvent({ id: "json-event", type: "tool.result", payload }, db);
      const [event] = listAgentEvents("default", 1, db);

      expect(JSON.parse(event.payload)).toEqual(payload);
    });
  });

  test("listAgentEvents applies descending order and limit", () => {
    withEventDb((db) => {
      appendEvent({ id: "old", type: "user.message", created_at: 1 }, db);
      appendEvent({ id: "middle", type: "user.message", created_at: 2 }, db);
      appendEvent({ id: "new", type: "user.message", created_at: 3 }, db);

      expect(listAgentEvents("default", 2, db).map((event) => event.id)).toEqual([
        "new",
        "middle",
      ]);
    });
  });
});
