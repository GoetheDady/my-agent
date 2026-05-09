import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { completeDreamRun, createDreamRun } from "./dream-run-store";
import { maybeRunScheduledDream } from "./dream-scheduler";
import { runDreamWorker } from "./dream-worker";

function withSchedulerDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return Promise.resolve(run(db)).finally(() => db.close());
}

describe("dream scheduler", () => {
  test("does not run before the daily schedule time", async () => {
    await withSchedulerDb(async (db) => {
      let runs = 0;
      const didRun = await maybeRunScheduledDream({
        database: db,
        now: new Date("2026-05-09T19:29:00.000Z").getTime(),
        runWorker: (async () => {
          runs += 1;
          return {} as Awaited<ReturnType<typeof runDreamWorker>>;
        }) as typeof runDreamWorker,
      });

      expect(didRun).toBe(false);
      expect(runs).toBe(0);
    });
  });

  test("runs once after 03:30 Asia/Shanghai and skips the completed same-day run", async () => {
    await withSchedulerDb(async (db) => {
      let runs = 0;
      const runWorker: typeof runDreamWorker = async (options) => {
        runs += 1;
        const workerOptions = options ?? {};
        const run = createDreamRun({
          agentId: workerOptions.agentId,
          date: workerOptions.date ?? "2026-05-10",
          timezone: workerOptions.timezone ?? "Asia/Shanghai",
          trigger: "scheduled",
          dryRun: false,
        }, db);
        completeDreamRun(run.id, db);
        return {} as Awaited<ReturnType<typeof runDreamWorker>>;
      };
      const now = new Date("2026-05-09T19:31:00.000Z").getTime();

      expect(await maybeRunScheduledDream({ database: db, now, runWorker })).toBe(true);
      expect(await maybeRunScheduledDream({ database: db, now, runWorker })).toBe(false);
      expect(runs).toBe(1);
    });
  });
});
