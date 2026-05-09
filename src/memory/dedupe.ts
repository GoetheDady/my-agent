import {
  listMemories,
  setMemoryStatus,
  type Memory,
} from "./store";
import {
  isDuplicateMemoryContent,
  normalizeMemoryContent,
} from "./duplicate";

export interface MemoryDedupeStore {
  listMemories: typeof listMemories;
  setMemoryStatus: typeof setMemoryStatus;
}

export interface MemoryDedupeGroup {
  content: string;
  keptMemoryId: string;
  duplicateMemoryIds: string[];
}

export interface MemoryDedupeResult {
  scannedCount: number;
  duplicateGroups: MemoryDedupeGroup[];
  inactiveMemoryIds: string[];
  dryRun: boolean;
}

export interface DedupeActiveMemoriesOptions {
  dryRun?: boolean;
  store?: MemoryDedupeStore;
}

const defaultStore: MemoryDedupeStore = {
  listMemories,
  setMemoryStatus,
};

export async function dedupeActiveMemories(
  options: DedupeActiveMemoriesOptions = {},
): Promise<MemoryDedupeResult> {
  const store = options.store ?? defaultStore;
  const dryRun = options.dryRun ?? false;
  const { memories } = await store.listMemories({ status: "active", pageSize: 1000 });
  const grouped = groupDuplicateMemories(memories);
  const duplicateGroups: MemoryDedupeGroup[] = [];
  const inactiveMemoryIds: string[] = [];

  for (const group of grouped) {
    const sorted = [...group].sort(compareMemoryForRetention);
    const kept = sorted[0];
    if (!kept) continue;

    const duplicates = sorted.slice(1);
    if (duplicates.length === 0) continue;

    const duplicateMemoryIds = duplicates.map((memory) => memory.id);
    duplicateGroups.push({
      content: kept.content,
      keptMemoryId: kept.id,
      duplicateMemoryIds,
    });

    if (dryRun) continue;

    for (const duplicate of duplicates) {
      const updated = await store.setMemoryStatus(duplicate.id, "inactive");
      if (updated) inactiveMemoryIds.push(updated.id);
    }
  }

  return {
    scannedCount: memories.length,
    duplicateGroups,
    inactiveMemoryIds,
    dryRun,
  };
}

function groupDuplicateMemories(memories: Memory[]): Memory[][] {
  const groups: Memory[][] = [];
  const visited = new Set<string>();

  for (const memory of memories) {
    if (visited.has(memory.id)) continue;
    const group = [memory];
    visited.add(memory.id);

    for (let index = 0; index < group.length; index += 1) {
      const current = group[index];
      if (!current) continue;

      for (const candidate of memories) {
        if (visited.has(candidate.id)) continue;
        if (!isDuplicateMemoryContent(current.content, candidate.content)) continue;
        group.push(candidate);
        visited.add(candidate.id);
      }
    }

    if (group.length > 1) groups.push(group);
  }

  return groups;
}

function compareMemoryForRetention(a: Memory, b: Memory): number {
  const aLength = normalizeMemoryContent(a.content).length;
  const bLength = normalizeMemoryContent(b.content).length;
  if (Math.abs(aLength - bLength) >= 8) return bLength - aLength;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  if (b.access_count !== a.access_count) return b.access_count - a.access_count;
  return a.id.localeCompare(b.id);
}
