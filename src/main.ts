import { Hono } from "hono";
import { cors } from "hono/cors";
import { getDb } from "./core/database";
import chatRoutes from "./routes/chat";
import sessionRoutes from "./routes/sessions";
import memoryRoutes from "./routes/memory";
import staticRoutes from "./routes/static";

getDb();

const app = new Hono();

app.use("*", cors());

app.route("/api/chat", chatRoutes);
app.route("/api/sessions", sessionRoutes);
app.route("/api/memory", memoryRoutes);
app.route("/*", staticRoutes);

const PORT = parseInt(process.env.PORT ?? "3000", 10);

Bun.serve({
  port: PORT,
  idleTimeout: 120,
  fetch: app.fetch,
});

console.log(`[server] 服务已启动: http://localhost:${PORT}`);
