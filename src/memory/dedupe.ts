import {
  listMemories,
  setMemoryStatus,
  type Memory,
} from "./store";

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
  const grouped = groupExactDuplicates(memories);
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

function groupExactDuplicates(memories: Memory[]): Memory[][] {
  const byContent = new Map<string, Memory[]>();

  for (const memory of memories) {
    const normalized = normalizeMemoryContent(memory.content);
    if (!normalized) continue;
    const existing = byContent.get(normalized) ?? [];
    existing.push(memory);
    byContent.set(normalized, existing);
  }

  return Array.from(byContent.values()).filter((group) => group.length > 1);
}

function compareMemoryForRetention(a: Memory, b: Memory): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  if (b.access_count !== a.access_count) return b.access_count - a.access_count;
  return a.id.localeCompare(b.id);
}

function normalizeMemoryContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。,.；;：:"“”'‘’]/g, "")
    .trim();
}
