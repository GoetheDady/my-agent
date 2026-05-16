import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent, getAgent, updateAgentStatus } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listTaskEvents } from "../events/event-log";
import { ApprovalService } from "../tools/approval-service";
import { claimTask } from "./task-queue";
import { createTask, getTask } from "./task-store";
import { runTaskWatchdogOnce } from "./watchdog";

function withWatchdogDb<T>(run: (db: Database) => T): T {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

describe("task watchdog", () => {
  test("cancels stale web queued tasks as system canceled", () => {
    withWatchdogDb((db) => {
      const now = 10_000;
      createTask({
        id: "stale-web",
        source_channel: "web",
        input: "stale",
        created_at: now - 61_000,
      }, db);

      const result = runTaskWatchdogOnce(db, { now, webQueuedTimeoutMs: 60_000 });

      expect(result).toMatchObject({ scanned: 1, canceled: 1, recovered: 0, alerted: 0, repaired: 0 });
      expect(getTask("stale-web", db)).toMatchObject({
        status: "canceled",
        failure_type: "system_canceled",
        failure_stage: "cancel",
        retriable: false,
      });
      expect(listTaskEvents("stale-web", db).map((event) => event.type)).toContain("task.watchdog.canceled");
    });
  });

  test("does not cancel fresh web queued tasks", () => {
    withWatchdogDb((db) => {
      const now = 10_000;
      createTask({
        id: "fresh-web",
        source_channel: "web",
        input: "fresh",
        created_at: now - 10_000,
      }, db);

      const result = runTaskWatchdogOnce(db, { now, webQueuedTimeoutMs: 60_000 });

      expect(result).toMatchObject({ scanned: 1, canceled: 0 });
      expect(getTask("fresh-web", db)).toMatchObject({ status: "queued" });
      expect(listTaskEvents("fresh-web", db).map((event) => event.type)).not.toContain("task.watchdog.canceled");
    });
  });

  test("emits a console alert when canceling stale web tasks in bulk", () => {
    withWatchdogDb((db) => {
      const now = 10_000;
      for (let index = 1; index <= 4; index += 1) {
        createTask({
          id: `stale-web-${index}`,
          source_channel: "web",
          input: `stale ${index}`,
          created_at: now - 61_000,
        }, db);
      }

      const result = runTaskWatchdogOnce(db, { now, webQueuedTimeoutMs: 60_000 });

      expect(result).toMatchObject({ scanned: 4, canceled: 4, alerted: 1 });
      const alert = db
        .query<{ payload: string }, []>(
          "SELECT payload FROM events WHERE type = 'task.watchdog.alerted' AND task_id IS NULL",
        )
        .get();
      expect(alert ? JSON.parse(alert.payload) : null).toMatchObject({
        reason: "web_queued_stale_batch",
        count: 4,
        notificationLevel: "P1",
      });
    });
  });

  test("alerts and drains stale external queued tasks without canceling them", () => {
    withWatchdogDb((db) => {
      const drainedAgents: string[] = [];
      const now = 10_000;
      createTask({
        id: "stale-feishu",
        source_channel: "feishu",
        input: "external",
        created_at: now - 61_000,
      }, db);

      const result = runTaskWatchdogOnce(db, {
        now,
        externalQueuedTimeoutMs: 60_000,
        drainExternalQueue: (agentId) => {
          drainedAgents.push(agentId);
        },
      });

      expect(result).toMatchObject({ scanned: 1, canceled: 0, alerted: 1 });
      expect(drainedAgents).toEqual(["default"]);
      expect(getTask("stale-feishu", db)).toMatchObject({ status: "queued" });
      expect(listTaskEvents("stale-feishu", db).map((event) => event.type)).toContain("task.watchdog.alerted");
    });
  });

  test("recovers expired running tasks through the existing recovery flow", () => {
    withWatchdogDb((db) => {
      const now = 10_000;
      createTask({ id: "expired-running", source_channel: "web", input: "running", created_at: 1 }, db);
      claimTask("expired-running", db);
      db.query("UPDATE tasks SET lease_expires_at = ? WHERE id = ?").run(now - 1, "expired-running");

      const result = runTaskWatchdogOnce(db, { now });

      expect(result).toMatchObject({ scanned: 1, recovered: 1 });
      expect(getTask("expired-running", db)).toMatchObject({ status: "queued", progress_status: "waiting" });
      expect(listTaskEvents("expired-running", db).map((event) => event.type)).toContain("task.watchdog.recovered");
    });
  });

  test("repairs agents stuck in running without a running task", () => {
    withWatchdogDb((db) => {
      updateAgentStatus("default", "running", "missing-task", db);

      const result = runTaskWatchdogOnce(db, { now: 10_000 });

      expect(result).toMatchObject({ repaired: 1 });
      expect(getAgent("default", db)).toMatchObject({ status: "idle", current_task_id: null });
    });
  });

  test("alerts stale pending approvals without resolving them", () => {
    withWatchdogDb((db) => {
      const now = 2_000_000;
      const approvalService = new ApprovalService(db);
      const approval = approvalService.createApproval({
        agentId: "default",
        sessionId: "session-1",
        toolCallId: "tool-call-1",
        toolName: "write_file",
        args: { path: "/tmp/file.txt" },
      });
      db.query("UPDATE tool_approvals SET created_at = ? WHERE id = ?").run(now - 1_900_000, approval.id);

      const result = runTaskWatchdogOnce(db, { now, approvalTimeoutMs: 1_800_000 });

      expect(result).toMatchObject({ alerted: 1 });
      expect(approvalService.getApproval(approval.id)).toMatchObject({ status: "pending" });
      const approvalEvents = db
        .query<{ type: string }, []>("SELECT type FROM events WHERE type = 'task.watchdog.alerted'")
        .all();
      expect(approvalEvents).toHaveLength(1);
    });
  });
});
