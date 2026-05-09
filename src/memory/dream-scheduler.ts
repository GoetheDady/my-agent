import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import {
  hasCompletedScheduledDreamRun,
  hasFreshRunningScheduledDreamRun,
  markStaleScheduledDreamRunsFailed,
} from "./dream-run-store";
import { runDreamWorker } from "./dream-worker";

const DEFAULT_AGENT_ID = "default";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_RUN_HOUR = 3;
const DEFAULT_RUN_MINUTE = 30;
const DEFAULT_INTERVAL_MS = 60_000;
const STALE_RUNNING_MS = 2 * 60 * 60 * 1000;

export interface DreamSchedulerHandle {
  stop: () => void;
  tick: () => Promise<void>;
}

export interface DreamSchedulerOptions {
  agentId?: string;
  timezone?: string;
  runHour?: number;
  runMinute?: number;
  intervalMs?: number;
  database?: Database;
  now?: () => number;
  runWorker?: typeof runDreamWorker;
}

let schedulerHandle: DreamSchedulerHandle | null = null;

export function startDreamScheduler(options: DreamSchedulerOptions = {}): DreamSchedulerHandle {
  if (process.env.DREAM_SCHEDULER_ENABLED === "false") {
    return { stop: () => undefined, tick: () => Promise.resolve() };
  }
  if (schedulerHandle) return schedulerHandle;

  const database = options.database ?? getDb();
  const agentId = options.agentId ?? DEFAULT_AGENT_ID;
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const runHour = options.runHour ?? DEFAULT_RUN_HOUR;
  const runMinute = options.runMinute ?? DEFAULT_RUN_MINUTE;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const runWorker = options.runWorker ?? runDreamWorker;
  let ticking = false;

  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await maybeRunScheduledDream({
        agentId,
        timezone,
        runHour,
        runMinute,
        database,
        now: now(),
        runWorker,
      });
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => {
    void tick().catch((error) => {
      appendEvent({
        agent_id: agentId,
        type: "dream.failed",
        payload: {
          trigger: "scheduled",
          scheduler: true,
          error: error instanceof Error ? error.message : String(error),
        },
      }, database);
    });
  }, intervalMs);
  const maybeUnref = timer as ReturnType<typeof setInterval> & { unref?: () => void };
  maybeUnref.unref?.();

  schedulerHandle = {
    stop: () => {
      clearInterval(timer);
      if (schedulerHandle?.tick === tick) schedulerHandle = null;
    },
    tick,
  };

  void tick();
  return schedulerHandle;
}

export async function maybeRunScheduledDream(input: {
  agentId?: string;
  timezone?: string;
  runHour?: number;
  runMinute?: number;
  database?: Database;
  now?: number;
  runWorker?: typeof runDreamWorker;
}): Promise<boolean> {
  const database = input.database ?? getDb();
  const agentId = input.agentId ?? DEFAULT_AGENT_ID;
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const now = input.now ?? Date.now();
  const runHour = input.runHour ?? DEFAULT_RUN_HOUR;
  const runMinute = input.runMinute ?? DEFAULT_RUN_MINUTE;
  const runWorker = input.runWorker ?? runDreamWorker;
  const today = dateKey(now, timezone);

  if (!isAtOrAfterSchedule(now, timezone, runHour, runMinute)) return false;
  if (hasCompletedScheduledDreamRun({ agentId, date: today }, database)) return false;

  const staleBefore = now - STALE_RUNNING_MS;
  const staleCount = markStaleScheduledDreamRunsFailed({
    agentId,
    staleBefore,
    error: "scheduled dream run stale for more than 2 hours",
  }, database);
  if (staleCount > 0) {
    appendEvent({
      agent_id: agentId,
      type: "dream.failed",
      payload: { trigger: "scheduled", staleCount, reason: "stale running dream runs" },
    }, database);
  }

  if (hasFreshRunningScheduledDreamRun({ agentId, date: today, staleBefore }, database)) {
    return false;
  }

  await runWorker({
    agentId,
    date: today,
    timezone,
    dryRun: false,
    trigger: "scheduled",
    database,
  });
  return true;
}

function isAtOrAfterSchedule(
  timestamp: number,
  timezone: string,
  runHour: number,
  runMinute: number,
): boolean {
  const parts = localDateParts(timestamp, timezone);
  if (parts.hour > runHour) return true;
  return parts.hour === runHour && parts.minute >= runMinute;
}

function dateKey(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function localDateParts(
  timestamp: number,
  timezone: string,
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const rawHour = Number(values.hour ?? "0");
  return {
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(values.minute ?? "0"),
  };
}
