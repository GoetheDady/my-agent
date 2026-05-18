import { Hono } from "hono";
import { cors } from "hono/cors";
import { resolve, extname, relative } from "path";
import { readFile, stat } from "fs/promises";
import { initializeRuntime } from "./core/runtime";
import { getDb } from "./core/database";
import { backupDatabaseIfStale } from "./core/backup";
import chatRoutes from "./routes/chat";
import { createSessionRoutes } from "./routes/sessions";
import { createAgentRoutes } from "./routes/agents";
import { createChannelRoutes } from "./routes/channels";
import { createDelegationRoutes } from "./routes/delegations";
import { startFeishuWebSocketService } from "./channels/feishu-websocket-service";
import memoryRoutes from "./routes/memory";
import toolRoutes from "./routes/tools";
import skillRoutes from "./routes/skills";
import { createRuntimeRoutes } from "./routes/runtime";
import { registerMemoryLifecycleHooks } from "./memory/lifecycle-hooks";
import { retryFailedExtractions } from "./memory/extraction-worker";
import { startDreamScheduler } from "./memory/dream-scheduler";
import { defaultRealtimeService } from "./realtime/service";
import { startTaskWatchdogScheduler } from "./tasks/watchdog";
import type { RealtimeSocketData } from "./realtime/types";

/**
 * 后端启动顺序：
 * 1. initializeRuntime() 初始化数据库、默认 Agent、工具注册等运行时基础设施。
 * 2. registerMemoryLifecycleHooks() 注册“助手消息已持久化”后的记忆提取 hook。
 * 3. startDreamScheduler() 启动进程内梦整理调度器。
 *
 * 注意：记忆提取和梦整理都属于后台认知流程，不应该阻塞 HTTP 服务启动。
 */
initializeRuntime();
void backupDatabaseIfStale()
  .then((result) => {
    if (result.created && result.backup) {
      console.log(`[backup] 已创建启动备份: ${result.backup.path}`);
    }
  })
  .catch((error) => {
    console.warn("[backup] 启动备份失败", error);
  });
registerMemoryLifecycleHooks();
startDreamScheduler();
setInterval(() => {
  void retryFailedExtractions(getDb()).catch((error) => {
    console.error("[memory-worker] retry scan failed:", error);
  });
}, 60_000);
startTaskWatchdogScheduler();
void startFeishuWebSocketService();

const app = new Hono();

app.use("*", cors());

app.route("/api/chat", chatRoutes);
app.route("/api/agents", createAgentRoutes());
app.route("/api/channels", createChannelRoutes());
app.route("/api/delegations", createDelegationRoutes());
app.route("/api/sessions", createSessionRoutes());
app.route("/api/memories", memoryRoutes);
app.route("/api/memory", memoryRoutes);
app.route("/api/tools", toolRoutes);
app.route("/api/skills", skillRoutes);
app.route("/api/runtime", createRuntimeRoutes());

app.get("/api/health", (c) => c.json({ status: "ok" }));

const DIST_DIR = resolve(import.meta.dir, "../web/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

app.get("*", async (c) => {
  const pathname = c.req.path;
  const safePath = resolve(DIST_DIR, pathname.slice(1) || "index.html");
  const rel = relative(DIST_DIR, safePath);
  // 防止通过 ../../ 访问 web/dist 之外的本地文件。
  if (rel.startsWith("..") || rel.startsWith("/") || rel.startsWith("\\")) {
    return c.text("Forbidden", 403);
  }

  try {
    const fileStat = await stat(safePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const data = await readFile(safePath);
    const mime = MIME_TYPES[extname(safePath)] ?? "application/octet-stream";
    return new Response(data, {
      headers: { "content-type": mime, "cache-control": "public, max-age=3600" },
    });
  } catch {
    // 前端使用 React Router，刷新 /memory、/sessions/:id 等路径时需要回退到 index.html。
    const indexPath = resolve(DIST_DIR, "index.html");
    try {
      const data = await readFile(indexPath);
      return new Response(data, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch {
      return c.text("Not Found", 404);
    }
  }
});

app.onError((err, c) => {
  console.error("[server]", err);
  return c.json({ error: err instanceof Error ? err.message : "内部错误" }, 500);
});

const PORT = parseInt(process.env.PORT ?? "3100", 10);

Bun.serve<RealtimeSocketData>({
  port: PORT,
  idleTimeout: 120,
  fetch: (request, server) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/ws") {
      const upgraded = server.upgrade(request, {
        data: defaultRealtimeService.createSocketData(),
      });
      return upgraded
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(request);
  },
  websocket: {
    open(socket) {
      defaultRealtimeService.addSocket(socket);
    },
    message(socket, message) {
      defaultRealtimeService.handleMessage(socket, message);
    },
    close(socket) {
      defaultRealtimeService.removeSocket(socket);
    },
  },
});

console.log(`[server] 服务已启动: http://localhost:${PORT}`);
