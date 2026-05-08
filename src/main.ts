import { Hono } from "hono";
import { cors } from "hono/cors";
import { resolve, extname, relative } from "path";
import { readFile, stat } from "fs/promises";
import { initializeRuntime } from "./core/runtime";
import chatRoutes from "./routes/chat";
import sessionRoutes from "./routes/sessions";
import memoryRoutes from "./routes/memory";
import toolRoutes from "./routes/tools";
import { createRuntimeRoutes } from "./routes/runtime";

initializeRuntime();

const app = new Hono();

app.use("*", cors());

app.route("/api/chat", chatRoutes);
app.route("/api/sessions", sessionRoutes);
app.route("/api/memories", memoryRoutes);
app.route("/api/memory", memoryRoutes);
app.route("/api/tools", toolRoutes);
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

const PORT = parseInt(process.env.PORT ?? "3000", 10);

Bun.serve({
  port: PORT,
  idleTimeout: 120,
  fetch: app.fetch,
});

console.log(`[server] 服务已启动: http://localhost:${PORT}`);
