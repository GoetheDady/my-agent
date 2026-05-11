import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { loadProfileContext } from "./files";
import { classifyProfileUpdates, syncProfileFromMemories } from "./sync";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";
import type { Memory } from "../memory/store";

function createMemory(overrides: Partial<Memory>): Memory {
  return {
    id: "memory-1",
    user_id: "default",
    agent_id: "",
    memory_type: "fact",
    content: "用户正在开发 my-agent 项目",
    embedding: [],
    source_session_id: "",
    source_text: "",
    status: "active",
    confidence: 0.9,
    created_at: 1,
    updated_at: 1,
    last_accessed_at: 1,
    access_count: 0,
    embedding_model: "test",
    embedding_dim: 0,
    ...overrides,
  };
}

function withTempDir<T>(run: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "my-agent-profile-sync-"));
  return Promise.resolve(run(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function withProfileSyncDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return Promise.resolve(run(db)).finally(() => db.close());
}

describe("profile sync", () => {
  test("syncs user identity and stable project context to user.md", async () => {
    await withTempDir(async (dir) => {
      loadProfileContext({ profileRootDir: dir, agentId: "default", userId: "default" });

      const result = await syncProfileFromMemories({
        profileRootDir: dir,
        source: "memory_worker",
        memories: [
          createMemory({ id: "name", content: "用户名字叫张三", memory_type: "identity" }),
          createMemory({ id: "project", content: "用户正在长期开发 my-agent 项目", memory_type: "project" }),
        ],
      });

      const user = readFileSync(join(dir, "users", "default", "user.md"), "utf8");
      const soul = readFileSync(join(dir, "agents", "default", "soul.md"), "utf8");
      expect(result.status).toBe("completed");
      expect(user).toContain("- name: 张三");
      expect(user).toContain("- what_to_call_them: 张三");
      expect(user).toContain("- 正在长期开发 my-agent 项目");
      expect(soul).not.toContain("张三");
    });
  });

  test("syncs agent self-rules to soul.md without duplicate bullets", async () => {
    await withTempDir(async (dir) => {
      loadProfileContext({ profileRootDir: dir, agentId: "default", userId: "default" });

      await syncProfileFromMemories({
        profileRootDir: dir,
        source: "memory_tool",
        memories: [
          createMemory({
            id: "voice",
            content: "以后你回复要更直接，专业术语要解释",
            memory_type: "preference",
          }),
        ],
      });
      await syncProfileFromMemories({
        profileRootDir: dir,
        source: "memory_tool",
        memories: [
          createMemory({
            id: "voice-duplicate",
            content: "以后你回复要更直接，专业术语要解释",
            memory_type: "preference",
          }),
        ],
      });

      const soul = readFileSync(join(dir, "agents", "default", "soul.md"), "utf8");
      const matches = soul.match(/回复要更直接/g) ?? [];
      expect(soul).toContain("- 回复要更直接，专业术语要解释");
      expect(matches).toHaveLength(1);
    });
  });

  test("records completed and skipped profile sync events", async () => {
    await withProfileSyncDb(async (db) => {
      await withTempDir(async (dir) => {
        const completed = await syncProfileFromMemories({
          profileRootDir: dir,
          database: db,
          source: "memory_worker",
          memories: [createMemory({ id: "name", content: "用户名字叫李四", memory_type: "identity" })],
        });
        const skipped = await syncProfileFromMemories({
          profileRootDir: dir,
          database: db,
          source: "memory_worker",
          memories: [createMemory({ id: "event", content: "今天读取了 eslint.config.js", memory_type: "episodic" })],
        });

        expect(completed.status).toBe("completed");
        expect(skipped.status).toBe("skipped");
        const eventTypes = listAgentEvents("default", 20, db).map((event) => event.type);
        expect(eventTypes).toContain("profile.sync.completed");
        expect(eventTypes).toContain("profile.sync.skipped");
      });
    });
  });

  test("classifies procedural and reflective memories as soul operating principles", () => {
    const result = classifyProfileUpdates([
      createMemory({
        content: "修改记忆系统时，应同步更新计划文档，并运行 bun test、bun run typecheck、bun run lint 做验证。",
        memory_type: "procedural",
      }),
      createMemory({
        content: "记忆系统出现重复记忆时，不能只做整条文本去重；还要处理事实里包含偏好的拆分重复。",
        memory_type: "reflective",
      }),
    ]);

    expect(result.soulUpdates.map((update) => update.section)).toEqual([
      "Operating Principles",
      "Operating Principles",
    ]);
    expect(result.userUpdates).toEqual([]);
  });
});
