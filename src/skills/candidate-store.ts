import type { Database } from "bun:sqlite";
import { appendEvent } from "../events/event-log";
import { getDb } from "../core/database";

export type SkillCandidateStatus = "pending" | "accepted" | "rejected";

export interface SkillCandidateRecord {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  source_episode_ids: string[];
  status: SkillCandidateStatus;
  created_at: number;
  reviewed_at: number | null;
  review_note: string | null;
}

interface SkillCandidateRow {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  category: string;
  content: string;
  source_episode_ids: string;
  status: SkillCandidateStatus;
  created_at: number;
  reviewed_at: number | null;
  review_note: string | null;
}

export function createSkillCandidate(input: {
  agentId?: string;
  name: string;
  description: string;
  category?: string;
  content: string;
  sourceEpisodeIds?: string[];
}, database: Database = getDb()): SkillCandidateRecord {
  const now = Date.now();
  const candidate: SkillCandidateRecord = {
    id: crypto.randomUUID(),
    agent_id: input.agentId ?? "default",
    name: input.name.trim(),
    description: input.description.trim(),
    category: input.category?.trim() || "general",
    content: input.content.trim(),
    source_episode_ids: input.sourceEpisodeIds ?? [],
    status: "pending",
    created_at: now,
    reviewed_at: null,
    review_note: null,
  };

  database
    .query(
      `INSERT INTO skill_candidates (
        id, agent_id, name, description, category, content, source_episode_ids,
        status, created_at, reviewed_at, review_note
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      candidate.id,
      candidate.agent_id,
      candidate.name,
      candidate.description,
      candidate.category,
      candidate.content,
      JSON.stringify(candidate.source_episode_ids),
      candidate.status,
      candidate.created_at,
      candidate.reviewed_at,
      candidate.review_note,
    );

  appendEvent({
    agent_id: candidate.agent_id,
    type: "skill.candidate.created",
    payload: {
      candidateId: candidate.id,
      name: candidate.name,
      category: candidate.category,
      sourceEpisodeIds: candidate.source_episode_ids,
    },
  }, database);

  return candidate;
}

export function listSkillCandidates(
  params: { agentId?: string; status?: SkillCandidateStatus; limit?: number } = {},
  database: Database = getDb(),
): SkillCandidateRecord[] {
  const agentId = params.agentId ?? "default";
  const limit = params.limit ?? 100;
  if (params.status) {
    return database
      .query<SkillCandidateRow, [string, SkillCandidateStatus, number]>(
        `SELECT * FROM skill_candidates
         WHERE agent_id = ? AND status = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(agentId, params.status, limit)
      .map(toSkillCandidate);
  }
  return database
    .query<SkillCandidateRow, [string, number]>(
      `SELECT * FROM skill_candidates
       WHERE agent_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(agentId, limit)
    .map(toSkillCandidate);
}

export function getSkillCandidate(id: string, database: Database = getDb()): SkillCandidateRecord | null {
  const row = database
    .query<SkillCandidateRow, [string]>("SELECT * FROM skill_candidates WHERE id = ?")
    .get(id);
  return row ? toSkillCandidate(row) : null;
}

export function findPendingSkillCandidateByEpisode(
  agentId: string,
  episodeId: string,
  database: Database = getDb(),
): SkillCandidateRecord | null {
  return listSkillCandidates({ agentId, status: "pending", limit: 1000 }, database)
    .find((candidate) => candidate.source_episode_ids.includes(episodeId)) ?? null;
}

export function markSkillCandidateAccepted(
  id: string,
  options: { note?: string; skillId?: string } = {},
  database: Database = getDb(),
): SkillCandidateRecord | null {
  return markSkillCandidateReviewed(id, "accepted", options.note, { skillId: options.skillId }, database);
}

export function markSkillCandidateRejected(
  id: string,
  note = "",
  database: Database = getDb(),
): SkillCandidateRecord | null {
  return markSkillCandidateReviewed(id, "rejected", note, {}, database);
}

function markSkillCandidateReviewed(
  id: string,
  status: Exclude<SkillCandidateStatus, "pending">,
  note: string | undefined,
  eventPayload: Record<string, unknown>,
  database: Database,
): SkillCandidateRecord | null {
  const existing = getSkillCandidate(id, database);
  if (!existing) return null;
  if (existing.status !== "pending") return existing;
  const reviewedAt = Date.now();
  database
    .query("UPDATE skill_candidates SET status = ?, reviewed_at = ?, review_note = ? WHERE id = ?")
    .run(status, reviewedAt, note ?? "", id);
  const updated = getSkillCandidate(id, database);
  if (updated) {
    appendEvent({
      agent_id: updated.agent_id,
      type: status === "accepted" ? "skill.candidate.accepted" : "skill.candidate.rejected",
      payload: {
        candidateId: updated.id,
        name: updated.name,
        reviewNote: updated.review_note,
        ...eventPayload,
      },
    }, database);
  }
  return updated;
}

function toSkillCandidate(row: SkillCandidateRow): SkillCandidateRecord {
  return {
    ...row,
    source_episode_ids: parseStringArray(row.source_episode_ids),
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
