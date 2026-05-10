import type { Database } from "bun:sqlite";
import type { ProfileSyncPort } from "../../agents/profile/profile-sync";
import type { MemoryDedupeResult, MemoryDedupeStore } from "../dedupe";
import type { MemoryDecisionMemoryStore, MemoryDecisionRecord } from "../decision-store";
import type { DreamRunRecord, DreamRunTrigger } from "../dream-run-store";
import type {
  addMemory,
  listMemories,
  updateMemory,
} from "../storage/store";

export const DEFAULT_TIMEZONE = "Asia/Shanghai";

export interface DailySummaryRecord {
  id: string;
  agent_id: string;
  date: string;
  timezone: string;
  summary: string;
  highlights: string[];
  episode_ids: string[];
  memory_change_ids: string[];
  open_questions: string[];
  created_at: number;
  updated_at: number;
}

export interface DailySummaryRow {
  id: string;
  agent_id: string;
  date: string;
  timezone: string;
  summary: string;
  highlights: string;
  episode_ids: string;
  memory_change_ids: string;
  open_questions: string;
  created_at: number;
  updated_at: number;
}

export interface DreamRunResult {
  dryRun: boolean;
  date: string;
  dreamRun: DreamRunRecord;
  summary: DailySummaryRecord;
  dedupe: MemoryDedupeResult;
  decisions: MemoryDecisionRecord[];
  decisionCount: number;
  pendingReviewCount: number;
}

export interface DreamMemoryStore extends MemoryDedupeStore, MemoryDecisionMemoryStore {
  listMemories: typeof listMemories;
  addMemory: typeof addMemory;
  updateMemory: typeof updateMemory;
}

export interface DreamWorkerOptions {
  agentId?: string;
  date?: string;
  dryRun?: boolean;
  timezone?: string;
  trigger?: DreamRunTrigger;
  database?: Database;
  dedupeStore?: MemoryDedupeStore;
  memoryStore?: DreamMemoryStore;
  profileSync?: ProfileSyncPort;
}
