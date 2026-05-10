import type { EpisodeRecord } from "../episode-store";
import type { Memory } from "../storage/store";

export function mapKindToMemoryType(kind: string): string {
  if (kind === "semantic") return "fact";
  if (kind === "social") return "preference";
  return kind;
}

export function toRecallMemory(memory: Memory) {
  return {
    id: memory.id,
    kind: mapMemoryTypeToKind(memory.memory_type),
    memory_type: memory.memory_type,
    content: memory.content,
    status: memory.status,
    confidence: memory.confidence,
    created_at: memory.created_at,
    updated_at: memory.updated_at,
  };
}

export function toRecallEpisode(episode: EpisodeRecord) {
  return {
    id: episode.id,
    kind: "episodic",
    title: episode.title,
    summary: episode.summary,
    outcome: episode.outcome,
    task_id: episode.task_id,
    time_range_start: episode.time_range_start,
    time_range_end: episode.time_range_end,
    tools_used: episode.tools_used,
    files_touched: episode.files_touched,
    importance: episode.importance,
  };
}

export function parseSourceText(sourceText: string): unknown {
  try {
    return JSON.parse(sourceText) as unknown;
  } catch {
    return sourceText;
  }
}

function mapMemoryTypeToKind(memoryType: string): string {
  if (memoryType === "fact" || memoryType === "project") return "semantic";
  if (memoryType === "preference") return "social";
  return memoryType;
}
