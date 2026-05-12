import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getDb } from "../core/database";
import {
  createSession,
  getSession,
  listSessions,
  getSessionMessages,
  updateSessionTitle,
  deleteSession,
} from "../sessions/service";

/**
 * Session API 面向 Web UI 的会话列表和历史消息。
 *
 * 注意：内部 Agent Runtime 使用 conversations/tasks/events；
 * sessions/messages 是前端展示层，两者通过 WebChannelAdapter 的 externalConversationId 关联。
 */
export function createSessionRoutes(database: Database = getDb()): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json(listSessions(database)));

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { title?: string; agentId?: string };
    const session = createSession({ title: body.title, agentId: body.agentId }, database);
    return c.json(session, 201);
  });

  app.get("/:id/messages", (c) => {
    const id = c.req.param("id");
    const session = getSession(id, database);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    const messages = getSessionMessages(id, database);
    return c.json({ session, messages });
  });

  app.patch("/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({})) as { title?: string };
    if (body.title) updateSessionTitle(id, body.title, database);
    return c.json({ ok: true });
  });

  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    deleteSession(id, database);
    return c.json({ ok: true });
  });

  return app;
}
