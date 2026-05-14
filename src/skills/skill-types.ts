export type SkillStatus = "enabled" | "disabled";
export type SkillOriginType = "builtin" | "agent_created" | "remote_installed";

export type SkillOrigin =
  | {
    type: "builtin";
    source: "builtin";
    builtinPath?: string;
  }
  | {
    type: "agent_created";
    source: "agent-created";
    legacySource?: string;
    createdAt?: number;
  }
  | {
    type: "remote_installed";
    source: "github";
    provider: "github";
    url: string;
    repo: string;
    branch: string;
    subdir: string;
    commit: string;
    installedAt: number;
    updatedAt: number;
    legacySource?: string;
  };

export interface SkillMetadata {
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
  source: string;
  origin: SkillOrigin;
  status: SkillStatus;
  createdAt: number;
  updatedAt: number;
}

export interface SkillRecord extends SkillMetadata {
  id: string;
  agentId: string;
  directory: string;
  filePath: string;
  readonly: boolean;
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
  status?: SkillStatus;
}

export interface SkillInstallInput {
  url: string;
  skillId?: string;
  branch?: string;
  subdir?: string;
  status?: SkillStatus;
}

export interface SkillInstallResult {
  skill: SkillRecord;
  changed: boolean;
  previousCommit?: string | null;
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
