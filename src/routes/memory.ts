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
import { listDailySummaries, listDreamRuns, runDreamWorker } from "../memory/dream-worker";
import { listMemoryDecisions, undoMemoryDecision } from "../memory/decision-store";
import { searchEpisodes } from "../memory/episode-store";
import { listReviewItems, updateReviewStatus } from "../memory/review-store";
import { appendEvent } from "../events/event-log";

const app = new Hono();

/**
 * 记忆 API 分两类：
 * - 前端管理/观察接口：stats、episodes、daily-summaries、dream/runs、decisions。
 * - 记忆 CRUD/调试接口：list/search/add/update/delete/dedupe/dream run。
 *
 * 主聊天流程不会从前端调用 /extract；记忆提取由 assistant.message.persisted hook 触发。
 */

// GET /api/memory/stats
app.get("/stats", async (c) => {
  const stats = await getMemoryStats();
  return c.json(stats);
});

// GET /api/memory/episodes
app.get("/episodes", (c) => {
  const agentId = c.req.query("agentId") ?? "default";
  const query = c.req.query("query") ?? undefined;
  const limit = parseInt(c.req.query("limit") ?? "10", 10);
  const from = c.req.query("from") ? parseInt(c.req.query("from")!, 10) : undefined;
  const to = c.req.query("to") ? parseInt(c.req.query("to")!, 10) : undefined;
  return c.json({ episodes: searchEpisodes({ agentId, query, from, to, limit }) });
});

// GET /api/memory/daily-summaries
app.get("/daily-summaries", (c) => {
  const agentId = c.req.query("agentId") ?? "default";
  const limit = parseInt(c.req.query("limit") ?? "7", 10);
  return c.json({ summaries: listDailySummaries({ agentId, limit }) });
});

// GET /api/memory/dream/runs
app.get("/dream/runs", (c) => {
  const agentId = c.req.query("agentId") ?? "default";
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  return c.json({ runs: listDreamRuns({ agentId, limit }) });
});

// GET /api/memory/decisions
app.get("/decisions", (c) => {
  const agentId = c.req.query("agentId") ?? "default";
  const status = c.req.query("status") as "applied" | "skipped" | "failed" | "undone" | undefined;
  const limit = parseInt(c.req.query("limit") ?? "30", 10);
  return c.json({ decisions: listMemoryDecisions({ agentId, status, limit }) });
});

// POST /api/memory/decisions/:id/undo
app.post("/decisions/:id/undo", async (c) => {
  try {
    const result = await undoMemoryDecision(c.req.param("id"));
    if (!result.decision) return c.json({ error: "memory decision 不存在" }, 404);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 409);
  }
});

// GET /api/memory/reviews
app.get("/reviews", (c) => {
  const agentId = c.req.query("agentId") ?? "default";
  const status = c.req.query("status") as "pending" | "accepted" | "rejected" | undefined;
  const limit = parseInt(c.req.query("limit") ?? "20", 10);
  return c.json({ items: listReviewItems({ agentId, status, limit }) });
});

// POST /api/memory/reviews/:id/accept
app.post("/reviews/:id/accept", (c) => {
  const item = updateReviewStatus(c.req.param("id"), "accepted");
  if (!item) return c.json({ error: "review item 不存在" }, 404);
  return c.json({ item });
});

// POST /api/memory/reviews/:id/reject
app.post("/reviews/:id/reject", (c) => {
  const item = updateReviewStatus(c.req.param("id"), "rejected");
  if (!item) return c.json({ error: "review item 不存在" }, 404);
  return c.json({ item });
});

// POST /api/memory/dream/run
app.post("/dream/run", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    agentId?: string;
    date?: string;
    dryRun?: boolean;
    trigger?: "manual" | "scheduled";
  };
  try {
    // dryRun 默认为 true，避免用户打开调试入口时误改长期记忆。
    const result = await runDreamWorker({
      agentId: body.agentId ?? "default",
      date: body.date,
      dryRun: body.dryRun ?? true,
      trigger: body.trigger ?? "manual",
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 500);
  }
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
    // dedupe 可用于手动调试；Dream Worker real-run 会把去重结果转成 memory_decisions。
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
  // 当前 store 层的 deleteMemory 实际表示停用/删除由实现决定；高风险自动整理不走这个接口。
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
    // 兼容旧前端手动触发方式。新流程请看 src/memory/lifecycle-hooks.ts。
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
