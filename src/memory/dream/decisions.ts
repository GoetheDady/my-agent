import type { Database } from "bun:sqlite";
import type { ProfileSyncPort } from "../../agents/profile/profile-sync";
import { appendEvent } from "../../events/event-log";
import type { MemoryDedupeGroup } from "../dedupe";
import {
  captureMemorySnapshots,
  createMemoryDecision,
  type MemoryDecisionRecord,
} from "../decision-store";
import { findDuplicateMemoryContent } from "../duplicate";
import { searchEpisodes } from "../episode-store";
import type { Memory } from "../storage/store";
import { dayRange, uniqueStrings } from "./time";
import type { DreamMemoryStore } from "./types";

export async function applyExactDedupeDecisions(input: {
  agentId: string;
  dreamRunId: string;
  groups: MemoryDedupeGroup[];
  database: Database;
  store: DreamMemoryStore;
}): Promise<MemoryDecisionRecord[]> {
  const decisions: MemoryDecisionRecord[] = [];

  for (const group of input.groups) {
    const targetMemoryIds = [group.keptMemoryId, ...group.duplicateMemoryIds];
    const beforeSnapshot = await captureMemorySnapshots(targetMemoryIds, input.store);
    if (beforeSnapshot.length !== targetMemoryIds.length) {
      // 目标记忆缺失时跳过，避免一半应用一半失败造成不可解释状态。
      decisions.push(createMemoryDecision({
        agentId: input.agentId,
        dreamRunId: input.dreamRunId,
        type: "exact_dedupe",
        status: "skipped",
        title: "跳过重复记忆整理",
        reason: "部分目标记忆不存在，无法安全应用去重。",
        confidence: 0.6,
        targetMemoryIds,
        beforeSnapshot,
      }, input.database));
      continue;
    }

    // 确定重复：保留质量最高/置信更高的一条，其余只标 inactive，不删除。
    for (const duplicateId of group.duplicateMemoryIds) {
      await input.store.setMemoryStatus(duplicateId, "inactive");
    }
    const afterSnapshot = await captureMemorySnapshots(targetMemoryIds, input.store);
    decisions.push(createMemoryDecision({
      agentId: input.agentId,
      dreamRunId: input.dreamRunId,
      type: "exact_dedupe",
      status: "applied",
      title: "停用重复记忆",
      reason: `确定为重复记忆，保留 ${group.keptMemoryId}，停用 ${group.duplicateMemoryIds.join("、")}。`,
      confidence: 0.95,
      targetMemoryIds,
      beforeSnapshot,
      afterSnapshot,
    }, input.database));
  }

  return decisions;
}

export async function applyConflictUpdateDecisions(input: {
  agentId: string;
  dreamRunId: string;
  database: Database;
  store: DreamMemoryStore;
}): Promise<MemoryDecisionRecord[]> {
  const { memories } = await input.store.listMemories({ status: "active", pageSize: 1000 });
  const byObject = new Map<string, { memory: Memory; polarity: "positive" | "negative"; object: string }[]>();
  // v1 使用确定性规则识别“喜欢/不喜欢 X”这类偏好冲突，不依赖模型自由判断。
  for (const memory of memories) {
    const fact = extractPreferenceFact(memory.content);
    if (!fact) continue;
    const group = byObject.get(fact.object) ?? [];
    group.push({ memory, ...fact });
    byObject.set(fact.object, group);
  }

  const decisions: MemoryDecisionRecord[] = [];
  const usedMemoryIds = new Set<string>();
  for (const facts of byObject.values()) {
    const positives = facts.filter((fact) => fact.polarity === "positive");
    const negatives = facts.filter((fact) => fact.polarity === "negative");
    if (positives.length === 0 || negatives.length === 0) continue;

    const sorted = [...facts].sort((a, b) =>
      b.memory.updated_at - a.memory.updated_at
      || b.memory.created_at - a.memory.created_at
      || a.memory.id.localeCompare(b.memory.id),
    );
    const newest = sorted[0];
    const previous = sorted.find((fact) => fact.polarity !== newest?.polarity);
    if (!newest || !previous) continue;
    if (usedMemoryIds.has(newest.memory.id) || usedMemoryIds.has(previous.memory.id)) continue;
    usedMemoryIds.add(newest.memory.id);
    usedMemoryIds.add(previous.memory.id);

    const targetMemoryIds = [newest.memory.id, previous.memory.id];
    const beforeSnapshot = await captureMemorySnapshots(targetMemoryIds, input.store);
    // 冲突处理保留变化轨迹，而不是只留下最新偏好；这能回答“以前有没有改过主意”。
    const nextContent = hasChangeTrace(newest.memory.content)
      ? newest.memory.content
      : `用户曾经${formatPreferenceFact(previous)}；现在明确表示${formatPreferenceFact(newest)}。`;
    await input.store.updateMemory(newest.memory.id, nextContent);
    await input.store.setMemoryStatus(previous.memory.id, "superseded");
    const afterSnapshot = await captureMemorySnapshots(targetMemoryIds, input.store);

    decisions.push(createMemoryDecision({
      agentId: input.agentId,
      dreamRunId: input.dreamRunId,
      type: "conflict_update",
      status: "applied",
      title: "合并偏好变化轨迹",
      reason: "检测到同一对象的正反偏好冲突，自动保留变化轨迹并停用被覆盖的旧记忆。",
      confidence: 0.85,
      targetMemoryIds,
      beforeSnapshot,
      afterSnapshot,
    }, input.database));
  }

  return decisions;
}

export async function applyEpisodeDerivedMemoryDecisions(input: {
  agentId: string;
  dreamRunId: string;
  date: string;
  timezone: string;
  database: Database;
  store: DreamMemoryStore;
}): Promise<MemoryDecisionRecord[]> {
  const range = dayRange(input.date, input.timezone);
  const episodes = searchEpisodes({
    agentId: input.agentId,
    from: range.from,
    to: range.to,
    limit: 100,
  }, input.database);
  const joined = episodes.map((episode) => `${episode.title}\n${episode.summary}\n${episode.outcome}`).join("\n");
  if (episodes.length < 2 || joined.length === 0) return [];

  // v1 先做少量确定性候选：多次 episode 反复出现的流程/风险才自动沉淀。
  // 后续如果接入模型提炼，也必须保留 confidence 阈值和 decision 快照。
  const active = await input.store.listMemories({ status: "active", pageSize: 1000 });
  const candidates = [
    {
      type: "procedural_extract" as const,
      memoryType: "procedural",
      content: "修改记忆系统时，应同步更新计划文档，并运行 bun test、bun run typecheck、bun run lint 做验证。",
      matches: [/记忆系统/, /计划文档|文档/, /bun test|typecheck|lint|验证/],
      title: "沉淀记忆系统修改流程",
      reason: "多个 episode 反复出现记忆系统修改、计划文档同步和验证命令。",
    },
    {
      type: "reflective_extract" as const,
      memoryType: "reflective",
      content: "记忆系统出现重复记忆时，不能只做整条文本去重；还要处理事实里包含偏好的拆分重复。",
      matches: [/重复记忆|去重/, /偏好/, /事实/],
      title: "沉淀重复记忆风险",
      reason: "多个 episode 提到重复记忆、事实和偏好拆分问题。",
    },
  ];

  const decisions: MemoryDecisionRecord[] = [];
  for (const candidate of candidates) {
    if (!candidate.matches.every((pattern) => pattern.test(joined))) continue;
    if (findDuplicateMemoryContent(candidate.content, active.memories)) continue;

    const saved = await input.store.addMemory({
      content: candidate.content,
      memory_type: candidate.memoryType,
      status: "active",
      confidence: 0.78,
      source_text: JSON.stringify({
        source: "dream_worker",
        episodeIds: episodes.map((episode) => episode.id),
      }),
    });
    if (!saved) continue;
    active.memories.push(saved);
    const afterSnapshot = await captureMemorySnapshots([saved.id], input.store);
    decisions.push(createMemoryDecision({
      agentId: input.agentId,
      dreamRunId: input.dreamRunId,
      type: candidate.type,
      status: "applied",
      title: candidate.title,
      reason: candidate.reason,
      confidence: 0.78,
      createdMemoryIds: [saved.id],
      sourceEventIds: episodes.flatMap((episode) => episode.source_event_ids),
      afterSnapshot,
    }, input.database));
  }

  return decisions;
}

export async function syncProfilesForDreamDecisions(input: {
  agentId: string;
  database: Database;
  profileSync: ProfileSyncPort;
  decisions: MemoryDecisionRecord[];
  store: DreamMemoryStore;
}): Promise<void> {
  // 只同步仍处于 active 的记忆；inactive/superseded 是历史证据，不应进入当前画像文件。
  const memoryIds = uniqueStrings(input.decisions
    .filter((decision) => decision.status === "applied")
    .flatMap((decision) => [
      ...decision.created_memory_ids,
      ...decision.target_memory_ids,
    ]));
  if (memoryIds.length === 0) return;

  const memories: Memory[] = [];
  for (const id of memoryIds) {
    const memory = await input.store.getMemory(id);
    if (memory?.status === "active") memories.push(memory);
  }
  if (memories.length === 0) return;

  try {
    await input.profileSync({
      agentId: input.agentId,
      userId: "default",
      database: input.database,
      source: "dream_worker",
      memories,
      reason: "dream worker memory decisions",
      sourceEventIds: uniqueStrings(input.decisions.flatMap((decision) => decision.source_event_ids)),
    });
  } catch (error) {
    appendEvent({
      agent_id: input.agentId,
      type: "profile.sync.failed",
      payload: {
        source: "dream_worker",
        memoryIds: memories.map((memory) => memory.id),
        error: error instanceof Error ? error.message : String(error),
      },
    }, input.database);
  }
}

function extractPreferenceFact(content: string): { polarity: "positive" | "negative"; object: string } | null {
  // 用简单中文偏好句式抽取冲突对象，例如“喜欢西红柿”和“不喜欢西红柿”。
  // 这是保守规则：识别不了就不自动合并，避免误改复杂偏好。
  const normalized = content
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。,.；;：:"“”'‘’、！!？?（）()【】[\]《》<>]/g, "");
  const negativeMarkers = ["不喜欢", "不偏好", "不需要", "不想要", "讨厌"];
  for (const marker of negativeMarkers) {
    const index = normalized.lastIndexOf(marker);
    if (index < 0) continue;
    const object = cleanupPreferenceObject(normalized.slice(index + marker.length));
    return object.length >= 2 ? { polarity: "negative", object } : null;
  }

  const positiveMarkers = ["喜欢", "偏好", "需要", "想要", "希望", "倾向"];
  for (const marker of positiveMarkers) {
    const index = normalized.lastIndexOf(marker);
    if (index < 0) continue;
    const previous = normalized[index - 1];
    if (previous === "不" || previous === "没" || previous === "无" || previous === "無") continue;
    const object = cleanupPreferenceObject(normalized.slice(index + marker.length));
    return object.length >= 2 ? { polarity: "positive", object } : null;
  }

  return null;
}

function cleanupPreferenceObject(object: string): string {
  return object
    .replace(/^(用户|本人|我|现在|已经|明确表示|改为|变成|了)+/g, "")
    .replace(/(了|。|\.|；|;)+$/g, "")
    .slice(0, 40);
}

function hasChangeTrace(content: string): boolean {
  return /(曾经|曾表示|以前).*(现在|改为|不再|不喜欢|变化)/.test(content);
}

function formatPreferenceFact(fact: { polarity: "positive" | "negative"; object: string }): string {
  return `${fact.polarity === "positive" ? "喜欢" : "不喜欢"}${fact.object}`;
}
