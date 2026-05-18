import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { getEpisode, searchEpisodes, type EpisodeRecord } from "../memory/episode-store";
import {
  createReviewItem,
  listReviewItems,
  type MemoryReviewItem,
} from "../memory/review-store";
import {
  createSkillCandidate,
  findPendingSkillCandidateByEpisode,
  type SkillCandidateRecord,
} from "./candidate-store";
import type { SkillRecord } from "./skill-types";
import { defaultSkillService } from "./service";

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

export interface SkillCandidateModelInput {
  agentId: string;
  episodes: EpisodeRecord[];
  existingSkills: SkillRecord[];
}

export interface SkillCandidateModelOutput {
  shouldCreate: boolean;
  reason: string;
  candidate?: {
    name: string;
    description: string;
    category: string;
    content: string;
    sourceEpisodeIds: string[];
  };
}

interface SkillCandidateDraft {
  name: string;
  description: string;
  category: string;
  content: string;
  sourceEpisodeIds: string[];
}

export function createSkillCandidateFromEpisode(
  input: SkillCandidateInput,
  context: SkillCandidateContext = {},
): MemoryReviewItem | null {
  const database = context.database ?? getDb();
  const episode = getEpisode(input.episodeId, database);
  if (!episode || !isReusableEpisode(episode)) return null;

  const existingCandidate = findPendingSkillCandidateByEpisode(episode.agent_id, episode.id, database);
  if (existingCandidate) {
    return findLegacyReviewItem(episode, database);
  }

  const existingSkills = defaultSkillService.listSkills({ agentId: episode.agent_id, database }, "all").skills;
  if (hasSimilarSkill(episode, existingSkills)) return null;

  const candidateDraft = buildCandidateDraft([episode]);
  createSkillCandidate({
    agentId: context.agentId ?? episode.agent_id,
    name: candidateDraft.name,
    description: candidateDraft.description,
    category: candidateDraft.category,
    content: candidateDraft.content,
    sourceEpisodeIds: candidateDraft.sourceEpisodeIds,
  }, database);

  return upsertLegacyReviewItem(episode, database, input.reason);
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
  }, database).filter(isReusableEpisode);

  const grouped = groupReusableEpisodes(episodes);
  const created: MemoryReviewItem[] = [];
  for (const group of grouped) {
    if (group.length < 2) continue;
    const agentId = input.agentId ?? group[0]!.agent_id;
    const existingSkills = defaultSkillService.listSkills({ agentId, database }, "all").skills;
    const evaluation = evaluateSkillCandidate({
      agentId,
      episodes: group,
      existingSkills,
    });
    if (!evaluation.shouldCreate || !evaluation.candidate) continue;
    if (evaluation.candidate.sourceEpisodeIds.some((episodeId) => findPendingSkillCandidateByEpisode(agentId, episodeId, database))) {
      continue;
    }

    createSkillCandidate({
      agentId,
      name: evaluation.candidate.name,
      description: evaluation.candidate.description,
      category: evaluation.candidate.category,
      content: evaluation.candidate.content,
      sourceEpisodeIds: evaluation.candidate.sourceEpisodeIds,
    }, database);

    const legacy = upsertLegacyReviewItem(group[0]!, database, evaluation.reason);
    if (legacy) created.push(legacy);
  }
  return created;
}

export function evaluateSkillCandidate(input: SkillCandidateModelInput): SkillCandidateModelOutput {
  const reusable = input.episodes.filter(isReusableEpisode);
  if (reusable.length < 2) {
    return { shouldCreate: false, reason: "需要至少两条相似且高质量的 episode 才值得沉淀为 Skill。" };
  }
  const draft = buildCandidateDraft(reusable);
  if (hasSimilarSkillContent(draft, input.existingSkills)) {
    return { shouldCreate: false, reason: "已有相似 Skill，跳过重复候选。" };
  }
  return {
    shouldCreate: true,
    reason: "同类高质量 episode 已重复出现，值得进入 Skill 审查流程。",
    candidate: draft,
  };
}

function isReusableEpisode(episode: EpisodeRecord): boolean {
  if (episode.task_status !== "completed") return false;
  if (episode.problems.length > 0) return false;
  if (episode.importance < 0.5) return false;
  if (episode.key_steps.length >= 2) return true;
  return /流程|步骤|复用|验证|测试|调试|实现/.test(`${episode.title}\n${episode.summary}\n${episode.outcome}`);
}

function groupReusableEpisodes(episodes: EpisodeRecord[]): EpisodeRecord[][] {
  const groups = new Map<string, EpisodeRecord[]>();
  for (const episode of episodes) {
    const key = normalizeGroupKey(episode);
    const group = groups.get(key) ?? [];
    group.push(episode);
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.length - a.length);
}

function normalizeGroupKey(episode: EpisodeRecord): string {
  const tools = [...episode.tools_used].sort().join("|");
  const steps = episode.key_steps
    .slice(0, 3)
    .map((step) => step.replace(/[0-9]+/g, "").replace(/\s+/g, " ").trim())
    .join("|");
  return `${tools}::${steps}`;
}

function buildCandidateDraft(episodes: EpisodeRecord[]): SkillCandidateDraft {
  const first = episodes[0]!;
  const sourceEpisodeIds = episodes.map((episode) => episode.id);
  const uniqueSteps = Array.from(new Set(episodes.flatMap((episode) => episode.key_steps))).filter(Boolean);
  const content = [
    `来源 episode：${sourceEpisodeIds.join(", ")}`,
    `来源任务：${episodes.map((episode) => episode.task_id).join(", ")}`,
    `任务模式：${first.title}`,
    "",
    "为什么值得沉淀：",
    `类似流程在最近经历中重复出现 ${episodes.length} 次，并且这些任务都完成且没有明显问题。`,
    "",
    "关键步骤：",
    uniqueSteps.length > 0
      ? uniqueSteps.map((step) => `- ${step}`).join("\n")
      : "- 暂无稳定步骤，需要进一步人工补充。",
    "",
    "代表性经历摘要：",
    episodes.map((episode) => `- ${episode.summary}`).join("\n"),
    "",
    "结果：",
    episodes.map((episode) => `- ${episode.outcome}`).join("\n"),
  ].join("\n");

  return {
    name: deriveCandidateName(first),
    description: deriveCandidateDescription(first, episodes.length),
    category: inferCandidateCategory(first),
    content,
    sourceEpisodeIds,
  };
}

function deriveCandidateName(episode: EpisodeRecord): string {
  const base = episode.title.replace(/^Skill 候选[:：]\s*/, "").trim();
  return base.length > 0 ? base : "可复用工作流";
}

function deriveCandidateDescription(episode: EpisodeRecord, count: number): string {
  return `从 ${count} 条相似高质量 episode 提炼的可复用方法：${episode.title}`;
}

function inferCandidateCategory(episode: EpisodeRecord): string {
  if (/测试|调试|修复/.test(`${episode.title}\n${episode.summary}`)) return "engineering";
  if (/研究|分析|调研/.test(`${episode.title}\n${episode.summary}`)) return "research";
  return "general";
}

function hasSimilarSkill(episode: EpisodeRecord, existingSkills: SkillRecord[]): boolean {
  const draft = buildCandidateDraft([episode, episode]);
  return hasSimilarSkillContent(draft, existingSkills);
}

function hasSimilarSkillContent(
  draft: SkillCandidateDraft,
  existingSkills: SkillRecord[],
): boolean {
  const draftTokens = new Set(tokenize(`${draft.name} ${draft.description} ${draft.content}`));
  for (const skill of existingSkills) {
    const skillTokens = new Set(tokenize(`${skill.name} ${skill.description}`));
    const overlap = intersectionSize(draftTokens, skillTokens);
    const ratio = draftTokens.size === 0 ? 0 : overlap / draftTokens.size;
    if (ratio > 0.85) return true;
  }
  return false;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) count += 1;
  }
  return count;
}

function upsertLegacyReviewItem(
  episode: EpisodeRecord,
  database: Database,
  reason = "dream_worker_skill_candidate",
): MemoryReviewItem | null {
  const existing = findLegacyReviewItem(episode, database);
  if (existing) return existing;
  return createReviewItem({
    agentId: episode.agent_id,
    type: "skill_candidate",
    title: `Skill 候选：${episode.title}`,
    proposedContent: buildLegacyReviewContent(episode),
    sourceEventIds: episode.source_event_ids,
    confidence: Math.min(0.9, Math.max(0.55, episode.importance + 0.15)),
    reason,
  }, database);
}

function findLegacyReviewItem(episode: EpisodeRecord, database: Database): MemoryReviewItem | null {
  return listReviewItems({ agentId: episode.agent_id, status: "pending", limit: 1000 }, database)
    .find((item) =>
      item.type === "skill_candidate" &&
      item.proposed_content.includes(`来源 episode：${episode.id}`),
    ) ?? null;
}

function buildLegacyReviewContent(episode: EpisodeRecord): string {
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

export type { SkillCandidateRecord };
