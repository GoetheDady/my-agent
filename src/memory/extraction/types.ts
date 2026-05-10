import type { Database } from "bun:sqlite";
import type { ProfileSyncPort } from "../../agents/profile/profile-sync";
import type {
  addMemory,
  getMemory,
  listMemories,
  searchMemories,
  updateMemory,
} from "../storage/store";
import type { Memory } from "../storage/store";

export interface MemoryExtractionJob {
  agentId: string;
  userId?: string;
  taskId: string;
  conversationId: string | null;
  sessionId: string;
  assistantMessageId: string;
  userText: string;
  assistantText: string;
  database?: Database;
}

export interface PlannedNewMemory {
  content: string;
  memory_type?: string;
  confidence?: number;
  reason?: string;
}

export interface PlannedMemoryUpdate {
  memory_id: string;
  content: string;
  reason?: string;
  confidence?: number;
}

export interface MemoryChangePlan {
  new_memories: PlannedNewMemory[];
  updates: PlannedMemoryUpdate[];
  summary?: string;
}

export interface MemoryWorkerResult {
  addedMemoryIds: string[];
  updatedMemoryIds: string[];
  retrievedMemoryIds: string[];
  summary: string;
}

export interface MemoryWorkerStore {
  addMemory: typeof addMemory;
  getMemory: typeof getMemory;
  listMemories: typeof listMemories;
  searchMemories: typeof searchMemories;
  updateMemory: typeof updateMemory;
}

export type MemoryChangePlanner = (input: {
  job: MemoryExtractionJob;
  retrievedMemories: Memory[];
  evidenceEventIds: string[];
}) => Promise<MemoryChangePlan>;

export interface MemoryExtractionWorkerOptions {
  planner?: MemoryChangePlanner;
  store?: MemoryWorkerStore;
  profileSync?: ProfileSyncPort;
}
