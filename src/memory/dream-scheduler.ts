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

/**
 * 启动进程内 Dream Worker 调度器。
 *
 * 调度器默认每分钟检查一次，到每天 03:30 Asia/Shanghai 后触发 scheduled real-run。
 *
 * @param options 调度配置、数据库连接、当前时间函数和 worker 实现。
 * @returns 调度器句柄，可用于手动 tick 或停止调度器。
 */
export function startDreamScheduler(options: DreamSchedulerOptions = {}): DreamSchedulerHandle {
  // 进程内调度器：服务启动后每分钟检查一次是否该做“梦整理”。
  // 这里不引入外部 cron，MVP 部署更简单；未来如果多实例运行，需要换成分布式锁。
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
    // 防止一次 tick 尚未结束时下一分钟又触发，导致两个 Dream Worker 并发整理同一批记忆。
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

/**
 * 判断并执行一次 scheduled Dream Worker。
 *
 * 如果当前时间未到计划时间、当天已完成、或存在未超时 running 记录，则不会执行。
 *
 * @param input Agent、时区、计划时间、数据库、当前时间和 worker 实现。
 * @returns 本次是否实际触发了 Dream Worker。
 */
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

  // 如果当前本地时间还没到 03:30，就不跑；如果服务在 03:30 后启动，
  // 只要今天没完成过 scheduled real-run，就会补跑一次。
  if (!isAtOrAfterSchedule(now, timezone, runHour, runMinute)) return false;
  if (hasCompletedScheduledDreamRun({ agentId, date: today }, database)) return false;

  // running 状态超过 2 小时视为 stale（陈旧任务），通常表示进程崩溃或被杀。
  // 标记失败后允许当天重新跑一次，避免永远卡住。
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

  // scheduled real-run 会实际改写记忆；dry-run 只在手动 API 里使用。
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
