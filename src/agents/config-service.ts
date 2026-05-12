import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getConfig, getRuntimeDataDir } from "../core/config";
import { appendEvent } from "../events/event-log";
import type {
  AgentConfig,
  AgentConfigContext,
  AgentConfigPatch,
  AgentConfigResetResult,
  AgentConfigSkill,
  AgentConfigSkillStatus,
} from "./config-types";

const DEFAULT_AGENT_ID = "default";
const AGENT_CONFIG_FILENAME = "agent.json";
const LEGACY_SKILLS_REGISTRY_FILENAME = "skills.json";
const DEFAULT_MODEL = "deepseek-v4-flash";

function now(): number {
  return Date.now();
}

function safeAgentSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return normalized.length > 0 ? normalized : DEFAULT_AGENT_ID;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
}

function addStrings(current: string[], added: unknown): string[] {
  return uniqueStrings([...current, ...asStringArray(added)]);
}

function removeStrings(current: string[], removed: unknown): string[] {
  const removedSet = new Set(asStringArray(removed));
  return current.filter((value) => !removedSet.has(value));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createDefaultConfig(agentId: string): AgentConfig {
  const timestamp = now();
  const model = (() => {
    try {
      return getConfig().provider.model;
    } catch {
      return DEFAULT_MODEL;
    }
  })();
  return {
    version: 1,
    agentId,
    name: agentId === DEFAULT_AGENT_ID ? "Default Agent" : agentId,
    description: "默认个人 Agent",
    model: {
      provider: "deepseek",
      model,
    },
    tools: {
      enabledToolsets: ["memory", "file", "runtime", "core", "skill", "agent_config"],
      requiresApproval: ["write_file", "skill_create", "skill_disable", "agent_config_patch", "agent_config_reset"],
      allowedPaths: [],
    },
    memory: {
      enabled: true,
      autoExtract: true,
      dreamEnabled: true,
    },
    skills: {
      enabled: true,
      indexEnabled: true,
      items: {},
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeSkillEntry(skillId: string, value: unknown): AgentConfigSkill | null {
  if (!isRecord(value)) return null;
  const timestamp = now();
  const status: AgentConfigSkillStatus = value.status === "disabled" ? "disabled" : "enabled";
  return {
    name: String(value.name ?? skillId),
    description: String(value.description ?? ""),
    category: String(value.category ?? "general"),
    allowedTools: asStringArray(value.allowedTools),
    source: String(value.source ?? "agent-created"),
    status,
    createdAt: Number(value.createdAt ?? timestamp),
    updatedAt: Number(value.updatedAt ?? timestamp),
  };
}

function normalizeConfig(agentId: string, raw: unknown): AgentConfig {
  const defaults = createDefaultConfig(agentId);
  if (!isRecord(raw)) return defaults;

  const skillsRaw = isRecord(raw.skills) ? raw.skills : {};
  const skillItemsRaw = isRecord(skillsRaw.items) ? skillsRaw.items : {};
  const skillItems: Record<string, AgentConfigSkill> = {};
  for (const [skillId, value] of Object.entries(skillItemsRaw)) {
    const normalizedSkillId = safeAgentSegment(skillId);
    const normalized = normalizeSkillEntry(normalizedSkillId, value);
    if (normalized) skillItems[normalizedSkillId] = normalized;
  }

  const modelRaw = isRecord(raw.model) ? raw.model : {};
  const toolsRaw = isRecord(raw.tools) ? raw.tools : {};
  const memoryRaw = isRecord(raw.memory) ? raw.memory : {};

  return {
    version: 1,
    agentId: safeAgentSegment(String(raw.agentId ?? agentId)),
    name: String(raw.name ?? defaults.name),
    description: String(raw.description ?? defaults.description),
    model: {
      provider: String(modelRaw.provider ?? defaults.model.provider),
      model: String(modelRaw.model ?? defaults.model.model),
    },
    tools: {
      enabledToolsets: asStringArray(toolsRaw.enabledToolsets).length > 0
        ? asStringArray(toolsRaw.enabledToolsets)
        : defaults.tools.enabledToolsets,
      requiresApproval: asStringArray(toolsRaw.requiresApproval).length > 0
        ? asStringArray(toolsRaw.requiresApproval)
        : defaults.tools.requiresApproval,
      allowedPaths: asStringArray(toolsRaw.allowedPaths),
    },
    memory: {
      enabled: asBoolean(memoryRaw.enabled, defaults.memory.enabled),
      autoExtract: asBoolean(memoryRaw.autoExtract, defaults.memory.autoExtract),
      dreamEnabled: asBoolean(memoryRaw.dreamEnabled, defaults.memory.dreamEnabled),
    },
    skills: {
      enabled: asBoolean(skillsRaw.enabled, defaults.skills.enabled),
      indexEnabled: asBoolean(skillsRaw.indexEnabled, defaults.skills.indexEnabled),
      items: skillItems,
    },
    createdAt: Number(raw.createdAt ?? defaults.createdAt),
    updatedAt: Number(raw.updatedAt ?? defaults.updatedAt),
  };
}

function validateConfig(config: AgentConfig): void {
  if (!config.agentId.trim()) throw new Error("agentId 不能为空");
  if (!config.name.trim()) throw new Error("name 不能为空");
  if (!config.model.provider.trim()) throw new Error("model.provider 不能为空");
  if (!config.model.model.trim()) throw new Error("model.model 不能为空");
  for (const [skillId, skill] of Object.entries(config.skills.items)) {
    if (!skill.name.trim()) throw new Error(`skill ${skillId} name 不能为空`);
    if (skill.status !== "enabled" && skill.status !== "disabled") {
      throw new Error(`skill ${skillId} status 非法`);
    }
  }
}

function mergePatch(current: AgentConfig, patch: AgentConfigPatch): AgentConfig {
  const next: AgentConfig = structuredClone(current);
  if (patch.name !== undefined) next.name = patch.name.trim();
  if (patch.description !== undefined) next.description = patch.description.trim();
  if (patch.model) {
    if (patch.model.provider !== undefined) next.model.provider = patch.model.provider.trim();
    if (patch.model.model !== undefined) next.model.model = patch.model.model.trim();
  }
  if (patch.tools) {
    if (patch.tools.enabledToolsets) next.tools.enabledToolsets = asStringArray(patch.tools.enabledToolsets);
    if (patch.tools.requiresApproval) next.tools.requiresApproval = asStringArray(patch.tools.requiresApproval);
    if (patch.tools.allowedPaths) next.tools.allowedPaths = asStringArray(patch.tools.allowedPaths);
    next.tools.enabledToolsets = addStrings(next.tools.enabledToolsets, patch.tools.addEnabledToolsets);
    next.tools.enabledToolsets = removeStrings(next.tools.enabledToolsets, patch.tools.removeEnabledToolsets);
    next.tools.requiresApproval = addStrings(next.tools.requiresApproval, patch.tools.addRequiresApproval);
    next.tools.requiresApproval = removeStrings(next.tools.requiresApproval, patch.tools.removeRequiresApproval);
    next.tools.allowedPaths = addStrings(next.tools.allowedPaths, patch.tools.addAllowedPaths);
    next.tools.allowedPaths = removeStrings(next.tools.allowedPaths, patch.tools.removeAllowedPaths);
  }
  if (patch.memory) {
    if (patch.memory.enabled !== undefined) next.memory.enabled = Boolean(patch.memory.enabled);
    if (patch.memory.autoExtract !== undefined) next.memory.autoExtract = Boolean(patch.memory.autoExtract);
    if (patch.memory.dreamEnabled !== undefined) next.memory.dreamEnabled = Boolean(patch.memory.dreamEnabled);
  }
  if (patch.skills) {
    if (patch.skills.enabled !== undefined) next.skills.enabled = Boolean(patch.skills.enabled);
    if (patch.skills.indexEnabled !== undefined) next.skills.indexEnabled = Boolean(patch.skills.indexEnabled);
    for (const rawSkillId of asStringArray(patch.skills.enableSkillIds)) {
      const skillId = safeAgentSegment(rawSkillId);
      const existing = next.skills.items[skillId];
      if (existing) {
        next.skills.items[skillId] = { ...existing, status: "enabled", updatedAt: now() };
      }
    }
    for (const rawSkillId of asStringArray(patch.skills.disableSkillIds)) {
      const skillId = safeAgentSegment(rawSkillId);
      const existing = next.skills.items[skillId];
      if (existing) {
        next.skills.items[skillId] = { ...existing, status: "disabled", updatedAt: now() };
      }
    }
    for (const rawSkillId of asStringArray(patch.skills.removeSkillIds)) {
      delete next.skills.items[safeAgentSegment(rawSkillId)];
    }
    if (patch.skills.items) {
      for (const [rawSkillId, rawSkillPatch] of Object.entries(patch.skills.items)) {
        const skillId = safeAgentSegment(rawSkillId);
        if (rawSkillPatch === null) {
          delete next.skills.items[skillId];
          continue;
        }
        const existing = next.skills.items[skillId];
        const timestamp = now();
        next.skills.items[skillId] = {
          name: rawSkillPatch.name?.trim() ?? existing?.name ?? skillId,
          description: rawSkillPatch.description?.trim() ?? existing?.description ?? "",
          category: rawSkillPatch.category?.trim() ?? existing?.category ?? "general",
          allowedTools: rawSkillPatch.allowedTools ? asStringArray(rawSkillPatch.allowedTools) : existing?.allowedTools ?? [],
          source: rawSkillPatch.source?.trim() ?? existing?.source ?? "agent-created",
          status: rawSkillPatch.status === "disabled" ? "disabled" : rawSkillPatch.status === "enabled" ? "enabled" : existing?.status ?? "enabled",
          createdAt: existing?.createdAt ?? rawSkillPatch.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        next.skills.items[skillId].allowedTools = addStrings(next.skills.items[skillId].allowedTools, rawSkillPatch.addAllowedTools);
        next.skills.items[skillId].allowedTools = removeStrings(next.skills.items[skillId].allowedTools, rawSkillPatch.removeAllowedTools);
      }
    }
  }
  next.updatedAt = now();
  return next;
}

function emitConfigEvent(
  database: Database | undefined,
  context: AgentConfigContext,
  type: "agent.config.updated" | "agent.config.reset" | "agent.config.validation_failed" | "agent.config.migrated",
  payload: Record<string, unknown>,
): void {
  appendEvent({
    agent_id: context.agentId ?? DEFAULT_AGENT_ID,
    task_id: context.taskId ?? null,
    conversation_id: context.conversationId ?? null,
    type,
    payload,
  }, database);
}

function safeStructuredClone<T>(value: T): T {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

export class AgentConfigService {
  private readonly rootDir: string;
  private readonly cache = new Map<string, AgentConfig>();

  constructor(options: { rootDir?: string } = {}) {
    this.rootDir = options.rootDir ?? getRuntimeDataDir();
  }

  getConfigPath(agentId = DEFAULT_AGENT_ID): string {
    return resolve(this.rootDir, "agents", safeAgentSegment(agentId), AGENT_CONFIG_FILENAME);
  }

  getLegacySkillsRegistryPath(agentId = DEFAULT_AGENT_ID): string {
    return resolve(this.rootDir, "agents", safeAgentSegment(agentId), "skills", LEGACY_SKILLS_REGISTRY_FILENAME);
  }

  getAgentConfig(agentId = DEFAULT_AGENT_ID, context: AgentConfigContext = {}): AgentConfig {
    const normalizedAgentId = safeAgentSegment(agentId);
    const cached = this.cache.get(normalizedAgentId);
    if (cached) return safeStructuredClone(cached);

    const configPath = this.getConfigPath(normalizedAgentId);
    let config: AgentConfig;
    try {
      if (!existsSync(configPath)) {
        config = createDefaultConfig(normalizedAgentId);
        config = this.mergeLegacySkillRegistry(normalizedAgentId, config, context);
        this.writeAgentConfig(normalizedAgentId, config);
      } else {
        config = normalizeConfig(normalizedAgentId, JSON.parse(readFileSync(configPath, "utf8")));
        config = this.mergeLegacySkillRegistry(normalizedAgentId, config, context);
        validateConfig(config);
        this.writeAgentConfig(normalizedAgentId, config);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      config = createDefaultConfig(normalizedAgentId);
      emitConfigEvent(context.database, { ...context, agentId: normalizedAgentId }, "agent.config.validation_failed", {
        error: message,
        configPath,
      });
      this.writeAgentConfig(normalizedAgentId, config);
    }

    this.cache.set(normalizedAgentId, config);
    return safeStructuredClone(config);
  }

  patchAgentConfig(agentId: string, patch: AgentConfigPatch, context: AgentConfigContext = {}): AgentConfig {
    const normalizedAgentId = safeAgentSegment(agentId);
    const current = this.getAgentConfig(normalizedAgentId, context);
    const next = mergePatch(current, patch);
    try {
      validateConfig(next);
    } catch (error) {
      emitConfigEvent(context.database, { ...context, agentId: normalizedAgentId }, "agent.config.validation_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    this.writeAgentConfig(normalizedAgentId, next);
    this.cache.set(normalizedAgentId, next);
    emitConfigEvent(context.database, { ...context, agentId: normalizedAgentId }, "agent.config.updated", {
      changedKeys: Object.keys(patch),
    });
    return safeStructuredClone(next);
  }

  resetAgentConfig(agentId: string, context: AgentConfigContext = {}): AgentConfigResetResult {
    const normalizedAgentId = safeAgentSegment(agentId);
    const config = createDefaultConfig(normalizedAgentId);
    this.writeAgentConfig(normalizedAgentId, config);
    this.cache.set(normalizedAgentId, config);
    emitConfigEvent(context.database, { ...context, agentId: normalizedAgentId }, "agent.config.reset", {});
    return { agentId: normalizedAgentId, config: safeStructuredClone(config) };
  }

  validateAgentConfig(config: AgentConfig): void {
    validateConfig(config);
  }

  private writeAgentConfig(agentId: string, config: AgentConfig): void {
    const configPath = this.getConfigPath(agentId);
    ensureDirectory(dirname(configPath));
    const tempPath = `${configPath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    renameSync(tempPath, configPath);
  }

  private mergeLegacySkillRegistry(agentId: string, config: AgentConfig, context: AgentConfigContext): AgentConfig {
    const legacyPath = this.getLegacySkillsRegistryPath(agentId);
    if (!existsSync(legacyPath)) return config;

    try {
      const legacy = JSON.parse(readFileSync(legacyPath, "utf8")) as { skills?: Record<string, unknown> };
      if (!isRecord(legacy.skills)) return config;
      const next = safeStructuredClone(config);
      let migratedCount = 0;
      for (const [skillId, value] of Object.entries(legacy.skills)) {
        const normalizedSkillId = safeAgentSegment(skillId);
        if (next.skills.items[normalizedSkillId]) continue;
        const skill = normalizeSkillEntry(normalizedSkillId, value);
        if (!skill) continue;
        next.skills.items[normalizedSkillId] = skill;
        migratedCount += 1;
      }
      if (migratedCount > 0) {
        next.updatedAt = now();
        emitConfigEvent(context.database, { ...context, agentId }, "agent.config.migrated", {
          source: legacyPath,
          migratedCount,
        });
      }
      unlinkSync(legacyPath);
      return next;
    } catch (error) {
      emitConfigEvent(context.database, { ...context, agentId }, "agent.config.validation_failed", {
        source: legacyPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return config;
    }
  }
}

export const defaultAgentConfigService = new AgentConfigService();
