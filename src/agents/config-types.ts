import type { Database } from "bun:sqlite";

export type AgentConfigSkillStatus = "enabled" | "disabled";

export interface AgentConfigSkill {
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
  source: string;
  status: AgentConfigSkillStatus;
  createdAt: number;
  updatedAt: number;
}

export interface AgentModelConfig {
  provider: string;
  model: string;
}

export interface AgentToolConfig {
  enabledToolsets: string[];
  requiresApproval: string[];
  allowedPaths: string[];
}

export interface AgentMemoryConfig {
  enabled: boolean;
  autoExtract: boolean;
  dreamEnabled: boolean;
}

export interface AgentSkillConfig {
  enabled: boolean;
  indexEnabled: boolean;
  items: Record<string, AgentConfigSkill>;
}

export interface AgentConfig {
  version: 1;
  agentId: string;
  name: string;
  description: string;
  model: AgentModelConfig;
  tools: AgentToolConfig;
  memory: AgentMemoryConfig;
  skills: AgentSkillConfig;
  createdAt: number;
  updatedAt: number;
}

export interface AgentConfigPatch {
  name?: string;
  description?: string;
  model?: Partial<AgentModelConfig>;
  tools?: Partial<AgentToolConfig> & {
    addEnabledToolsets?: string[];
    removeEnabledToolsets?: string[];
    addRequiresApproval?: string[];
    removeRequiresApproval?: string[];
    addAllowedPaths?: string[];
    removeAllowedPaths?: string[];
  };
  memory?: Partial<AgentMemoryConfig>;
  skills?: Partial<Pick<AgentSkillConfig, "enabled" | "indexEnabled">> & {
    enableSkillIds?: string[];
    disableSkillIds?: string[];
    removeSkillIds?: string[];
    items?: Record<string, (Partial<AgentConfigSkill> & {
      addAllowedTools?: string[];
      removeAllowedTools?: string[];
    }) | null>;
  };
}

export interface AgentConfigContext {
  agentId?: string;
  taskId?: string | null;
  conversationId?: string | null;
  database?: Database;
}

export interface AgentConfigResetResult {
  agentId: string;
  config: AgentConfig;
}
