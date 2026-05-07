import {
  listMemories,
  getMemory,
  addMemory,
  updateMemory,
  deleteMemory,
  getMemoryStats,
  searchMemories,
} from "../memory/store";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(message: string, status: number): Response {
  return json({ error: message }, status);
}

export async function handleMemoryRequest(
  method: string,
  pathname: string,
  req: Request,
): Promise<Response | null> {
  if (method === "GET" && pathname === "/api/memories/stats") {
    const stats = await getMemoryStats();
    return json(stats);
  }

  if (method === "POST" && pathname === "/api/memories/search") {
    const body = await req.json().catch(() => ({})) as { query?: string; limit?: number };
    if (!body.query) return jsonError("缺少 query", 400);
    const results = await searchMemories(body.query, body.limit ?? 10);
    return json(results.map(m => ({
      id: m.id,
      memory_type: m.memory_type,
      content: m.content,
      confidence: m.confidence,
      created_at: m.created_at,
      access_count: m.access_count,
    })));
  }

  if (method === "GET" && pathname === "/api/memories") {
    const url = new URL(req.url);
    const params = {
      page: parseInt(url.searchParams.get("page") ?? "1"),
      pageSize: parseInt(url.searchParams.get("pageSize") ?? "20"),
      type: url.searchParams.get("type") ?? undefined,
      status: url.searchParams.get("status") ?? "active",
      search: url.searchParams.get("search") ?? undefined,
    };
    const result = await listMemories(params);
    return json(result);
  }

  const idMatch = pathname.match(/^\/api\/memories\/([a-f0-9-]+)$/);
  if (!idMatch) return null;

  const id = idMatch[1];

  if (method === "GET") {
    const memory = await getMemory(id);
    if (!memory) return jsonError("记忆不存在", 404);
    return json(memory);
  }

  if (method === "POST" && pathname.startsWith("/api/memories/") === false) {
    const body = await req.json().catch(() => ({})) as {
      content?: string;
      memory_type?: string;
    };
    if (!body.content) return jsonError("缺少 content", 400);
    const memory = await addMemory({
      content: body.content,
      memory_type: body.memory_type,
    });
    if (!memory) return jsonError("添加失败", 500);
    return json(memory, 201);
  }

  if (method === "PATCH") {
    const body = await req.json().catch(() => ({})) as { content?: string };
    if (!body.content) return jsonError("缺少 content", 400);
    const memory = await updateMemory(id, body.content);
    if (!memory) return jsonError("记忆不存在或更新失败", 404);
    return json(memory);
  }

  if (method === "DELETE") {
    await deleteMemory(id);
    return json({ ok: true });
  }

  return null;
}
