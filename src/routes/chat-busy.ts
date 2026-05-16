import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { finalizeEpisodeForTask } from "../memory/episode-store";
import { markTaskCanceled } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/task-types";

export function handleBusyWebTask(task: TaskRecord, database: Database = getDb()): Response {
  markTaskCanceled(task.id, {
    failureType: "system_canceled",
    requestedBy: "runtime",
  }, database);
  finalizeEpisodeForTask(task.id, database);
  return Response.json({
    error: "当前 Agent 正在处理其他任务，请稍后再试。",
    taskId: task.id,
  }, { status: 409 });
}
