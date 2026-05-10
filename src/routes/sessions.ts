import { Hono } from "hono";
import {
  createSession,
  listSessions,
  getSessionMessages,
  updateSessionTitle,
  deleteSession,
} from "../channels/session-api";

const app = new Hono();

/**
 * Session API 面向 Web UI 的会话列表和历史消息。
 *
 * 注意：内部 Agent Runtime 使用 conversations/tasks/events；
 * sessions/messages 是前端展示层，两者通过 WebChannelAdapter 的 externalConversationId 关联。
 */
app.get("/", (c) => c.json(listSessions()));

app.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { title?: string };
  const session = createSession(body.title);
  return c.json(session, 201);
});

app.get("/:id/messages", (c) => {
  const id = c.req.param("id");
  const messages = getSessionMessages(id);
  return c.json(messages);
});

app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as { title?: string };
  if (body.title) updateSessionTitle(id, body.title);
  return c.json({ ok: true });
});

app.delete("/:id", (c) => {
  const id = c.req.param("id");
  deleteSession(id);
  return c.json({ ok: true });
});

export default app;
