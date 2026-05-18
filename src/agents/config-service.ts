import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getRuntimeDataDir } from "../core/config";
import { appendEvent } from "../events/event-log";
import type {
  AgentConfig,
  AgentConfigContext,
  AgentConfigPatch,
  AgentConfigResetResult,
  PublicAgentConfig,
} from "./config-types";
import {
  createDefaultConfig,
  isRecord,
  mergePatch,
  normalizeConfig,
  normalizeSkillEntry,
  safeAgentSegment,
  validateConfig,
} from "./config-normalizer";

const DEFAULT_AGENT_ID = "default";
const AGENT_CONFIG_FILENAME = "agent.json";
const LEGACY_SKILLS_REGISTRY_FILENAME = "skills.json";

function now(): number {
  return Date.now();
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function emitConfigEvent(
  database: Database | undefined,
  context: AgentConfigContext,
  type: "agent.config.updated" | "agent.config.reset" | "agent.config.validation_failed" | "agent.config.migrated",
  payload: Record<string, unknown>,
): void {
  if (!database) return;
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

function redactAgentConfig(config: AgentConfig): PublicAgentConfig {
  const redacted = safeStructuredClone(config) as unknown as PublicAgentConfig;
  redacted.channels.feishu.bindings = Object.fromEntries(
    Object.entries(config.channels.feishu.bindings).map(([appId, binding]) => {
      const { appSecret: _appSecret, verificationToken: _verificationToken, encryptKey: _encryptKey, ...publicBinding } = binding;
      return [appId, {
        ...publicBinding,
        hasAppSecret: Boolean(binding.appSecret),
        hasVerificationToken: Boolean(binding.verificationToken),
        hasEncryptKey: Boolean(binding.encryptKey),
      }];
    }),
  );
  return redacted;
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

  listConfiguredAgentIds(): string[] {
    const agentsDir = resolve(this.rootDir, "agents");
    if (!existsSync(agentsDir)) return [DEFAULT_AGENT_ID];
    const ids = readdirSync(agentsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => safeAgentSegment(entry.name))
      .filter((agentId) => existsSync(this.getConfigPath(agentId)));
    return Array.from(new Set([DEFAULT_AGENT_ID, ...ids]));
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

  getPublicAgentConfig(agentId = DEFAULT_AGENT_ID, context: AgentConfigContext = {}): PublicAgentConfig {
    return redactAgentConfig(this.getAgentConfig(agentId, context));
  }

  initializeAgentConfig(agentId: string, patch: AgentConfigPatch = {}, _context: AgentConfigContext = {}): AgentConfig {
    const normalizedAgentId = safeAgentSegment(agentId);
    const config = mergePatch(createDefaultConfig(normalizedAgentId), patch);
    validateConfig(config);
    this.writeAgentConfig(normalizedAgentId, config);
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
