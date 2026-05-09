import { Hono } from "hono";
import {
  listMemories,
  getMemory,
  addMemory,
  updateMemory,
  deleteMemory,
  getMemoryStats,
  searchMemories,
} from "../memory/store";
import { extractMemories } from "../memory/memory";
import { dedupeActiveMemories } from "../memory/dedupe";
import { appendEvent } from "../events/event-log";

const app = new Hono();

// GET /api/memory/stats
app.get("/stats", async (c) => {
  const stats = await getMemoryStats();
  return c.json(stats);
});

// POST /api/memory/search
app.post("/search", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { query?: string; limit?: number };
  if (!body.query) return c.json({ error: "缺少 query" }, 400);
  const results = await searchMemories(body.query, body.limit ?? 10);
  return c.json(results.map(m => ({
    id: m.id,
    memory_type: m.memory_type,
    content: m.content,
    confidence: m.confidence,
    created_at: m.created_at,
    access_count: m.access_count,
  })));
});

// POST /api/memory/dedupe
app.post("/dedupe", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { dryRun?: boolean };
  const dryRun = body.dryRun ?? false;

  appendEvent({
    type: "memory.dedupe.started",
    payload: { dryRun },
  });

  try {
    const result = await dedupeActiveMemories({ dryRun });
    appendEvent({
      type: "memory.dedupe.completed",
      payload: {
        dryRun,
        scannedCount: result.scannedCount,
        duplicateGroupCount: result.duplicateGroups.length,
        inactiveMemoryIds: result.inactiveMemoryIds,
      },
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendEvent({
      type: "memory.dedupe.failed",
      payload: { dryRun, error: message },
    });
    return c.json({ error: message }, 500);
  }
});

// GET /api/memory
app.get("/", (c) => {
  const params = {
    page: parseInt(c.req.query("page") ?? "1"),
    pageSize: parseInt(c.req.query("pageSize") ?? "20"),
    type: c.req.query("type") ?? undefined,
    status: c.req.query("status") ?? "active",
    search: c.req.query("search") ?? undefined,
  };
  return listMemories(params).then(r => c.json(r));
});

// POST /api/memory
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    content?: string;
    memory_type?: string;
  };
  if (!body.content) return c.json({ error: "缺少 content" }, 400);
  const memory = await addMemory({
    content: body.content,
    memory_type: body.memory_type,
  });
  if (!memory) return c.json({ error: "添加失败" }, 500);
  return c.json(memory, 201);
});

// GET /api/memory/:id
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const memory = await getMemory(id);
  if (!memory) return c.json({ error: "记忆不存在" }, 404);
  return c.json(memory);
});

// PATCH /api/memory/:id
app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as { content?: string };
  if (!body.content) return c.json({ error: "缺少 content" }, 400);
  const memory = await updateMemory(id, body.content);
  if (!memory) return c.json({ error: "记忆不存在或更新失败" }, 404);
  return c.json(memory);
});

// DELETE /api/memory/:id
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await deleteMemory(id);
  return c.json({ ok: true });
});

// POST /api/memory/extract
app.post("/extract", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    sessionId?: string;
    userText?: string;
    assistantText?: string;
  };
  if (!body.sessionId || !body.userText) {
    return c.json({ error: "缺少 sessionId 或 userText" }, 400);
  }
  try {
    const count = await extractMemories(
      [body.userText],
      [body.assistantText ?? ""],
      body.sessionId,
    );
    return c.json({ count });
  } catch (err) {
    const message = err instanceof Error ? err.message : "记忆提取失败";
    return c.json({ error: message }, 500);
  }
});

export default app;
