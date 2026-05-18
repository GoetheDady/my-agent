import { getDb } from "../../core/database";
import { syncProfileFromMemories } from "../../profiles/sync";
import { appendEvent } from "../../events/event-log";
import { dedupeActiveMemories } from "../dedupe";
import {
  listMemoryDecisions,
} from "../decision-store";
import {
  completeDreamRun,
  createDreamRun,
  failDreamRun,
  listDreamRuns,
} from "../dream-run-store";
import { listReviewItems } from "../review-store";
import { createSkillCandidatesFromEpisodes } from "../../skills/candidates";
import { listSkillCandidates } from "../../skills/candidate-store";
import {
  addMemory,
  getMemory,
  listMemories,
  restoreMemorySnapshot,
  setMemoryStatus,
  updateMemory,
} from "../storage/store";
import {
  applyConflictUpdateDecisions,
  applyEpisodeDerivedMemoryDecisions,
  applyExactDedupeDecisions,
} from "./decisions";
import {
  updateDailySummaryMemoryChanges,
  upsertDailySummary,
} from "./summary";
import { dateKey } from "./time";
import {
  DEFAULT_TIMEZONE,
  type DreamMemoryStore,
  type DreamRunResult,
  type DreamWorkerOptions,
} from "./types";

export { listDreamRuns };
export { getDailySummary, listDailySummaries } from "./summary";
export type { DailySummaryRecord, DreamMemoryStore, DreamRunResult } from "./types";

const defaultMemoryStore: DreamMemoryStore = {
  listMemories,
  getMemory,
  addMemory,
  updateMemory,
  setMemoryStatus,
  restoreMemorySnapshot,
};

let running = false;

/**
 * Dream Worker：后台“睡眠整理”流程。
 *
 * 与每轮对话后的 MemoryExtractionWorker 不同，Dream Worker 面向一整天/一批 episodes：
 * - dry-run：只预览 summary、去重和决策，不修改 active memory。
 * - real-run：自动执行高置信、可审计、可撤销的整理决策。
 *
 * 安全原则：
 * - 不硬删除记忆，只把旧记忆改成 inactive/superseded。
 * - 每次应用都写 memory_decisions，保存 before/after 快照。
 * - profile_sync 失败不回滚 dream decisions，只记录事件。
 *
 * @param options Dream Worker 运行配置，包括日期、是否 dry-run、数据库和可注入存储端口。
 * @returns 本次整理的 summary、去重预览、决策列表和运行记录。
 * @throws 当已有 Dream Worker 正在运行时抛出错误，保证整理串行执行。
 */
export async function runDreamWorker(
  options: DreamWorkerOptions = {},
): Promise<DreamRunResult> {
  if (running) throw new Error("Dream worker is already running");
  running = true;

  const database = options.database ?? getDb();
  const agentId = options.agentId ?? "default";
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const date = options.date ?? dateKey(Date.now(), timezone);
  const dryRun = options.dryRun ?? false;
  const trigger = options.trigger ?? "manual";
  const memoryStore = options.memoryStore ?? defaultMemoryStore;
  const profileSync = options.profileSync ?? syncProfileFromMemories;
  const dreamRun = createDreamRun({ agentId, date, timezone, trigger, dryRun }, database);

  appendEvent({
    agent_id: agentId,
    type: "dream.started",
    payload: { date, dryRun, timezone, trigger, dreamRunId: dreamRun.id },
  }, database);

  try {
    // 每次 dream 都先产生日总结；dry-run 返回临时 summary，real-run 才写入 daily_summaries。
    const summary = upsertDailySummary({ agentId, date, timezone, dryRun }, database);
    // 先用 dry-run 去重获得候选组，real-run 再把候选组转成可审计 decision。
    const dedupePreview = await dedupeActiveMemories({
      dryRun: true,
      store: options.dedupeStore ?? memoryStore,
    });
    const decisions = dryRun
      ? []
      : [
        ...await applyExactDedupeDecisions({
          agentId,
          dreamRunId: dreamRun.id,
          groups: dedupePreview.duplicateGroups,
          database,
          store: memoryStore,
        }),
        ...await applyConflictUpdateDecisions({
          agentId,
          dreamRunId: dreamRun.id,
          database,
          store: memoryStore,
          profileSync,
        }),
        ...await applyEpisodeDerivedMemoryDecisions({
          agentId,
          dreamRunId: dreamRun.id,
          date,
          timezone,
          database,
          store: memoryStore,
          profileSync,
        }),
      ];
    // dedupe 输出要体现 real-run 已经实际停用/替代了哪些记忆，供前端展示。
    const inactiveMemoryIds = decisions
      .filter((decision) => decision.status === "applied")
      .flatMap((decision) =>
        decision.after_snapshot
          .filter((snapshot) => snapshot.status === "inactive" || snapshot.status === "superseded")
          .map((snapshot) => snapshot.id),
      );
    const dedupe = {
      ...dedupePreview,
      dryRun,
      inactiveMemoryIds,
    };
    if (!dryRun && decisions.length > 0) {
      summary.memory_change_ids = decisions.map((decision) => decision.id);
      updateDailySummaryMemoryChanges(summary.id, summary.memory_change_ids, database);
    }
    const skillReviewItems = dryRun
      ? []
      : createSkillCandidatesFromEpisodes({
        agentId,
        from: summary.created_at - 24 * 60 * 60 * 1000,
        to: summary.updated_at + 1,
        limit: 50,
      }, database);
    const skillCandidates = listSkillCandidates({ agentId, status: "pending", limit: 1000 }, database);
    const pendingReviewCount = listReviewItems({ agentId, status: "pending", limit: 1000 }, database).length;
    const completedRun = completeDreamRun(dreamRun.id, database) ?? dreamRun;
    const persistedDecisions = dryRun
      ? []
      : listMemoryDecisions({ agentId, limit: Math.max(decisions.length, 1) }, database)
        .filter((decision) => decision.dream_run_id === dreamRun.id);
    const result: DreamRunResult = {
      dryRun,
      date,
      dreamRun: completedRun,
      summary,
      dedupe,
      decisions: persistedDecisions,
      decisionCount: persistedDecisions.length,
      skillCandidates,
      skillCandidateCount: skillReviewItems.length,
      pendingReviewCount,
    };

    appendEvent({
      agent_id: agentId,
      type: "dream.completed",
      payload: {
        date,
        dryRun,
        trigger,
        dreamRunId: dreamRun.id,
        episodeCount: summary.episode_ids.length,
        duplicateGroupCount: dedupe.duplicateGroups.length,
        decisionCount: persistedDecisions.length,
        appliedDecisionCount: persistedDecisions.filter((decision) => decision.status === "applied").length,
        skippedDecisionCount: persistedDecisions.filter((decision) => decision.status === "skipped").length,
        skillCandidateCount: skillReviewItems.length,
      },
    }, database);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failDreamRun(dreamRun.id, message, database);
    appendEvent({
      agent_id: agentId,
      type: "dream.failed",
      payload: { date, dryRun, trigger, dreamRunId: dreamRun.id, error: message },
    }, database);
    throw error;
  } finally {
    running = false;
  }
}
