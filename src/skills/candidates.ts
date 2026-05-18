import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { getEpisode, searchEpisodes, type EpisodeRecord } from "../memory/episode-store";
import {
  createReviewItem,
  listReviewItems,
  type MemoryReviewItem,
} from "../memory/review-store";

export interface SkillCandidateInput {
  episodeId: string;
  reason?: string;
}

export interface SkillCandidateContext {
  agentId?: string;
  database?: Database;
}

export interface SkillCandidateBatchInput {
  agentId?: string;
  from: number;
  to: number;
  limit?: number;
}

export function createSkillCandidateFromEpisode(
  input: SkillCandidateInput,
  context: SkillCandidateContext = {},
): MemoryReviewItem | null {
  const database = context.database ?? getDb();
  const episode = getEpisode(input.episodeId, database);
  if (!episode || !isReusableEpisode(episode)) return null;
  const existing = findExistingCandidate(episode, database);
  if (existing) return existing;

  return createReviewItem({
    agentId: context.agentId ?? episode.agent_id,
    type: "skill_candidate",
    title: `Skill 候选：${episode.title}`,
    proposedContent: buildCandidateContent(episode),
    sourceEventIds: episode.source_event_ids,
    confidence: Math.min(0.9, Math.max(0.55, episode.importance + 0.15)),
    reason: input.reason ?? "completed_episode_reusable_steps",
  }, database);
}

export function createSkillCandidatesFromEpisodes(
  input: SkillCandidateBatchInput,
  database: Database = getDb(),
): MemoryReviewItem[] {
  const episodes = searchEpisodes({
    agentId: input.agentId ?? "default",
    from: input.from,
    to: input.to,
    limit: input.limit ?? 20,
  }, database);
  return episodes
    .map((episode) => createSkillCandidateFromEpisode({
      episodeId: episode.id,
      reason: "dream_worker_skill_candidate",
    }, { agentId: input.agentId ?? episode.agent_id, database }))
    .filter((item): item is MemoryReviewItem => Boolean(item));
}

function isReusableEpisode(episode: EpisodeRecord): boolean {
  if (episode.task_status !== "completed") return false;
  if (episode.problems.length > 0) return false;
  if (episode.importance < 0.5) return false;
  if (episode.key_steps.length >= 2) return true;
  return /流程|步骤|复用|验证|测试|调试|实现/.test(`${episode.title}\n${episode.summary}\n${episode.outcome}`);
}

function findExistingCandidate(episode: EpisodeRecord, database: Database): MemoryReviewItem | null {
  return listReviewItems({ agentId: episode.agent_id, status: "pending", limit: 1000 }, database)
    .find((item) =>
      item.type === "skill_candidate" &&
      item.proposed_content.includes(`来源 episode：${episode.id}`),
    ) ?? null;
}

function buildCandidateContent(episode: EpisodeRecord): string {
  const keySteps = episode.key_steps.length > 0
    ? episode.key_steps.map((step) => `- ${step}`).join("\n")
    : "- 这次任务完成了可复用流程，但 episode 中没有更细步骤。";
  return [
    `来源 episode：${episode.id}`,
    `来源任务：${episode.task_id}`,
    `任务标题：${episode.title}`,
    "",
    "为什么值得沉淀：",
    "这是一条已完成且没有记录问题的经历，可能包含可复用的方法。先作为 Skill 候选供用户审查，不直接创建或改写 Skill。",
    "",
    "关键步骤：",
    keySteps,
    "",
    "经历摘要：",
    episode.summary,
    "",
    "结果：",
    episode.outcome,
  ].join("\n");
}
