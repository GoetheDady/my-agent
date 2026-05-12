export type SkillStatus = "enabled" | "disabled";

export interface SkillMetadata {
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
  source: string;
  status: SkillStatus;
  createdAt: number;
  updatedAt: number;
}

export interface SkillRecord extends SkillMetadata {
  id: string;
  agentId: string;
  directory: string;
  filePath: string;
}

export interface SkillIndexItem {
  id: string;
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
}

export interface SkillListResult {
  agentId: string;
  skills: SkillRecord[];
  enabledCount: number;
  disabledCount: number;
}

export interface SkillViewResult {
  agentId: string;
  skill: SkillRecord | null;
  content: string | null;
  filePath: string | null;
  error?: string;
}

export interface SkillCreateInput {
  skillId: string;
  name: string;
  description: string;
  content: string;
  category?: string;
  allowedTools?: string[];
  source?: string;
  status?: SkillStatus;
}

export interface SkillStatusUpdateResult {
  agentId: string;
  skill: SkillRecord | null;
  changed: boolean;
}

export interface SkillServiceContext {
  agentId?: string;
  taskId?: string | null;
  conversationId?: string | null;
  database?: import("bun:sqlite").Database;
}
