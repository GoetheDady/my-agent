import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listTaskEvents } from "../events/event-log";
import { createTask, getTask } from "../tasks/task-store";
import { runInternalAgentTask } from "./internal-runner";

function createDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return db;
}

describe("internal runner", () => {
  test("turns empty model output with tool errors into visible task result", async () => {
    const db = createDb();
    const task = createTask({
      id: "task-empty-tool-error",
      source_channel: "delegation",
      source_user_id: "default",
      input: "读取代码并总结",
    }, db);

    await runInternalAgentTask({
      task,
      messages: [{ role: "user", content: [{ type: "text", text: task.input }] }],
      database: db,
      memorySearcher: async () => [],
      generateTextRunner: (async () => ({
        text: "",
        steps: [{
          toolResults: [{
            toolName: "read_file",
            output: {
              success: false,
              error: {
                message: "Path \"src/missing.ts\" is not readable",
                suggestion: "Ask the user to grant access",
              },
            },
          }],
        }],
      })) as never,
    });

    const updated = getTask(task.id, db);
    expect(updated?.status).toBe("completed");
    expect(updated?.result).toContain("模型执行了工具，但没有生成最终文本回复");
    expect(updated?.result).toContain("read_file");
    expect(updated?.result).toContain("src/missing.ts");
    expect(listTaskEvents(task.id, db).find((event) => event.type === "assistant.message")?.payload)
      .toContain("src/missing.ts");
    db.close();
  });

  test("uses explicit fallback when empty model output has no tool results", async () => {
    const db = createDb();
    const task = createTask({
      id: "task-empty-no-tools",
      source_channel: "delegation",
      source_user_id: "default",
      input: "总结",
    }, db);

    const result = await runInternalAgentTask({
      task,
      messages: [{ role: "user", content: [{ type: "text", text: task.input }] }],
      database: db,
      memorySearcher: async () => [],
      emptyResultMessage: "没有可用输出，请说明失败原因。",
      generateTextRunner: (async () => ({
        text: "   ",
        steps: [],
      })) as never,
    });

    expect(result.text).toBe("没有可用输出，请说明失败原因。");
    expect(getTask(task.id, db)?.result).toBe("没有可用输出，请说明失败原因。");
    db.close();
  });
});
