import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { createSession, appendMessage } from "../sessions/service";
import { createSessionRoutes } from "./sessions";

function withSessionApp<T>(run: (app: Hono, db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const app = new Hono();
  app.route("/sessions", createSessionRoutes(db));

  return Promise.resolve()
    .then(() => run(app, db))
    .finally(() => db.close());
}

describe("session routes", () => {
  test("POST /sessions persists agent binding", async () => {
    await withSessionApp(async (app) => {
      const res = await app.request("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "researcher", title: "研究会话" }),
      });
      const body = await res.json() as { agent_id: string; title: string };

      expect(res.status).toBe(201);
      expect(body.agent_id).toBe("researcher");
      expect(body.title).toBe("研究会话");
    });
  });

  test("GET /sessions/:id/messages returns the session and messages", async () => {
    await withSessionApp(async (app, db) => {
      const session = createSession({ agentId: "researcher" }, db);
      appendMessage(session.id, "user", "你好", db);

      const res = await app.request(`/sessions/${session.id}/messages`);
      const body = await res.json() as {
        session: { id: string; agent_id: string };
        messages: Array<{ role: string; content: string }>;
      };

      expect(res.status).toBe(200);
      expect(body.session.agent_id).toBe("researcher");
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]).toMatchObject({
        session_id: session.id,
        role: "user",
        content: "你好",
      });
    });
  });
});
