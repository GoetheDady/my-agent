import { getConfig } from "../core/config";
import type {
  AgentConfig,
  AgentConfigBuiltinSkillOverride,
  AgentConfigPatch,
  AgentConfigSkill,
  AgentConfigSkillStatus,
  AgentFeishuBindingConfig,
} from "./config-types";
import type { SkillOrigin } from "../skills/skill-types";

const DEFAULT_AGENT_ID = "default";
const DEFAULT_MODEL = "deepseek-v4-flash";

export function safeAgentSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return normalized.length > 0 ? normalized : DEFAULT_AGENT_ID;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)));
}

export function addStrings(current: string[], added: unknown): string[] {
  return uniqueStrings([...current, ...asStringArray(added)]);
}

export function removeStrings(current: string[], removed: unknown): string[] {
  const removedSet = new Set(asStringArray(removed));
  return current.filter((v) => !removedSet.has(v));
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSecret(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeDomain(value: unknown): "feishu" | "lark" {
  return value === "lark" ? "lark" : "feishu";
}

export function normalizeSkillOrigin(
  skillId: string,
  origin: unknown,
  source: string,
  timestamp: number,
): SkillOrigin {
  if (isRecord(origin)) {
    if (origin.type === "remote_installed") {
      const url = String(origin.url ?? "").trim();
      const repo = String(origin.repo ?? skillId).trim();
      return {
        type: "remote_installed",
        source: "github",
        provider: "github",
        url,
        repo,
        branch: String(origin.branch ?? "main").trim() || "main",
        subdir: String(origin.subdir ?? "").trim(),
        commit: String(origin.commit ?? "").trim(),
        ...(typeof origin.contentHash === "string" ? { contentHash: origin.contentHash } : {}),
        installedAt: Number(origin.installedAt ?? timestamp),
        updatedAt: Number(origin.updatedAt ?? timestamp),
        ...(typeof origin.legacySource === "string" ? { legacySource: origin.legacySource } : {}),
      };
    }
    if (origin.type === "builtin") {
      return {
        type: "builtin",
        source: "builtin",
        ...(typeof origin.builtinPath === "string" ? { builtinPath: origin.builtinPath } : {}),
      };
    }
    if (origin.type === "agent_created") {
      return {
        type: "agent_created",
        source: "agent-created",
        createdAt: Number(origin.createdAt ?? timestamp),
        ...(typeof origin.legacySource === "string" ? { legacySource: origin.legacySource } : {}),
      };
    }
  }
  return {
    type: "agent_created",
    source: "agent-created",
    createdAt: timestamp,
    ...(source !== "agent-created" ? { legacySource: source } : {}),
  };
}

export function normalizeBuiltinOverride(value: unknown): AgentConfigBuiltinSkillOverride | null {
  if (!isRecord(value)) return null;
  return {
    status: value.status === "disabled" ? "disabled" : "enabled",
    updatedAt: Number(value.updatedAt ?? Date.now()),
  };
}

export function normalizeFeishuBinding(appId: string, value: unknown): AgentFeishuBindingConfig | null {
  if (!isRecord(value)) return null;
  const timestamp = Date.now();
  const normalizedAppId = String(value.appId ?? appId).trim();
  const appSecret = String(value.appSecret ?? "").trim();
  if (!normalizedAppId || !appSecret) return null;
  return {
    appId: normalizedAppId,
    appSecret,
    domain: normalizeDomain(value.domain),
    enabled: asBoolean(value.enabled, true),
    verificationToken: normalizeSecret(value.verificationToken),
    encryptKey: normalizeSecret(value.encryptKey),
    openId: normalizeSecret(value.openId),
    botName: normalizeSecret(value.botName),
    botOpenId: normalizeSecret(value.botOpenId),
    createdAt: Number(value.createdAt ?? timestamp),
    updatedAt: Number(value.updatedAt ?? timestamp),
  };
}

export function normalizeSkillEntry(skillId: string, value: unknown): AgentConfigSkill | null {
  if (!isRecord(value)) return null;
  const timestamp = Date.now();
  const status: AgentConfigSkillStatus = value.status === "disabled" ? "disabled" : "enabled";
  const source = String(value.source ?? "agent-created");
  return {
    name: String(value.name ?? skillId),
    description: String(value.description ?? ""),
    category: String(value.category ?? "general"),
    allowedTools: asStringArray(value.allowedTools),
    source,
    origin: normalizeSkillOrigin(skillId, value.origin, source, timestamp),
    status,
    createdAt: Number(value.createdAt ?? timestamp),
    updatedAt: Number(value.updatedAt ?? timestamp),
  };
}

export function createDefaultConfig(agentId: string): AgentConfig {
  const timestamp = Date.now();
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
    model: { provider: "deepseek", model },
    tools: {
      enabledToolsets: ["memory", "file", "runtime", "core", "skill", "agent_config"],
      requiresApproval: [
        "write_file", "skill_create", "skill_disable", "skill_install",
        "skill_update", "agent_create", "agent_config_patch", "agent_config_reset",
      ],
      allowedPaths: [],
    },
    memory: { enabled: true, autoExtract: true, dreamEnabled: true },
    skills: { enabled: true, indexEnabled: true, items: {}, builtinOverrides: {} },
    channels: { feishu: { enabled: true, bindings: {} } },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeConfig(agentId: string, raw: unknown): AgentConfig {
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
  const builtinOverridesRaw = isRecord(skillsRaw.builtinOverrides) ? skillsRaw.builtinOverrides : {};
  const builtinOverrides: Record<string, AgentConfigBuiltinSkillOverride> = {};
  for (const [skillId, value] of Object.entries(builtinOverridesRaw)) {
    const normalizedSkillId = safeAgentSegment(skillId);
    const normalized = normalizeBuiltinOverride(value);
    if (normalized) builtinOverrides[normalizedSkillId] = normalized;
  }

  const modelRaw = isRecord(raw.model) ? raw.model : {};
  const toolsRaw = isRecord(raw.tools) ? raw.tools : {};
  const memoryRaw = isRecord(raw.memory) ? raw.memory : {};
  const channelsRaw = isRecord(raw.channels) ? raw.channels : {};
  const feishuRaw = isRecord(channelsRaw.feishu) ? channelsRaw.feishu : {};
  const feishuBindingsRaw = isRecord(feishuRaw.bindings) ? feishuRaw.bindings : {};
  const feishuBindings: Record<string, AgentFeishuBindingConfig> = {};
  for (const [appId, value] of Object.entries(feishuBindingsRaw)) {
    const normalized = normalizeFeishuBinding(appId, value);
    if (normalized) feishuBindings[normalized.appId] = normalized;
  }

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
      builtinOverrides,
    },
    channels: {
      feishu: {
        enabled: asBoolean(feishuRaw.enabled, defaults.channels.feishu.enabled),
        bindings: feishuBindings,
      },
    },
    createdAt: Number(raw.createdAt ?? defaults.createdAt),
    updatedAt: Number(raw.updatedAt ?? defaults.updatedAt),
  };
}

export function validateConfig(config: AgentConfig): void {
  if (!config.agentId.trim()) throw new Error("agentId 不能为空");
  if (!config.name.trim()) throw new Error("name 不能为空");
  if (!config.model.provider.trim()) throw new Error("model.provider 不能为空");
  if (!config.model.model.trim()) throw new Error("model.model 不能为空");
  for (const [skillId, skill] of Object.entries(config.skills.items)) {
    if (!skill.name.trim()) throw new Error(`skill ${skillId} name 不能为空`);
    if (skill.status !== "enabled" && skill.status !== "disabled") {
      throw new Error(`skill ${skillId} status 非法`);
    }
    if (!skill.origin?.type) throw new Error(`skill ${skillId} origin 不能为空`);
    if (skill.origin.type === "builtin") throw new Error(`skill ${skillId} 不能作为私有 skill 保存 builtin origin`);
  }
  for (const [skillId, override] of Object.entries(config.skills.builtinOverrides)) {
    if (override.status !== "enabled" && override.status !== "disabled") {
      throw new Error(`builtin skill ${skillId} status 非法`);
    }
  }
  for (const [appId, binding] of Object.entries(config.channels.feishu.bindings)) {
    if (!appId.trim() || !binding.appId.trim()) throw new Error("feishu appId 不能为空");
    if (!binding.appSecret.trim()) throw new Error(`feishu ${binding.appId} appSecret 不能为空`);
    if (binding.domain !== "feishu" && binding.domain !== "lark") {
      throw new Error(`feishu ${binding.appId} domain 非法`);
    }
  }
}

export function mergePatch(current: AgentConfig, patch: AgentConfigPatch): AgentConfig {
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
      if (existing) next.skills.items[skillId] = { ...existing, status: "enabled", updatedAt: Date.now() };
    }
    for (const rawSkillId of asStringArray(patch.skills.disableSkillIds)) {
      const skillId = safeAgentSegment(rawSkillId);
      const existing = next.skills.items[skillId];
      if (existing) next.skills.items[skillId] = { ...existing, status: "disabled", updatedAt: Date.now() };
    }
    for (const rawSkillId of asStringArray(patch.skills.removeSkillIds)) {
      delete next.skills.items[safeAgentSegment(rawSkillId)];
    }
    if (patch.skills.builtinOverrides) {
      for (const [rawSkillId, overridePatch] of Object.entries(patch.skills.builtinOverrides)) {
        const skillId = safeAgentSegment(rawSkillId);
        if (overridePatch === null) { delete next.skills.builtinOverrides[skillId]; continue; }
        next.skills.builtinOverrides[skillId] = {
          status: overridePatch.status === "disabled" ? "disabled" : "enabled",
          updatedAt: Date.now(),
        };
      }
    }
    if (patch.skills.items) {
      for (const [rawSkillId, rawSkillPatch] of Object.entries(patch.skills.items)) {
        if (rawSkillPatch === null) continue;
        const skillId = safeAgentSegment(rawSkillId);
        const existing = next.skills.items[skillId];
        const timestamp = Date.now();
        next.skills.items[skillId] = {
          name: rawSkillPatch.name?.trim() ?? existing?.name ?? skillId,
          description: rawSkillPatch.description?.trim() ?? existing?.description ?? "",
          category: rawSkillPatch.category?.trim() ?? existing?.category ?? "general",
          allowedTools: rawSkillPatch.allowedTools ? asStringArray(rawSkillPatch.allowedTools) : existing?.allowedTools ?? [],
          source: rawSkillPatch.source?.trim() ?? existing?.source ?? "agent-created",
          origin: rawSkillPatch.origin
            ? normalizeSkillOrigin(skillId, rawSkillPatch.origin, rawSkillPatch.source ?? existing?.source ?? "agent-created", timestamp)
            : existing?.origin ?? normalizeSkillOrigin(skillId, null, rawSkillPatch.source ?? existing?.source ?? "agent-created", timestamp),
          status: rawSkillPatch.status === "disabled" ? "disabled" : rawSkillPatch.status === "enabled" ? "enabled" : existing?.status ?? "enabled",
          createdAt: existing?.createdAt ?? rawSkillPatch.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
        next.skills.items[skillId].allowedTools = addStrings(next.skills.items[skillId].allowedTools, rawSkillPatch.addAllowedTools);
        next.skills.items[skillId].allowedTools = removeStrings(next.skills.items[skillId].allowedTools, rawSkillPatch.removeAllowedTools);
      }
    }
  }
  if (patch.channels?.feishu) {
    const feishuPatch = patch.channels.feishu;
    if (feishuPatch.enabled !== undefined) next.channels.feishu.enabled = Boolean(feishuPatch.enabled);
    for (const rawAppId of asStringArray(feishuPatch.removeBindingAppIds)) {
      delete next.channels.feishu.bindings[rawAppId.trim()];
    }
    if (feishuPatch.bindings) {
      for (const [rawAppId, bindingPatch] of Object.entries(feishuPatch.bindings)) {
        const appId = rawAppId.trim();
        if (!appId) continue;
        if (bindingPatch === null) { delete next.channels.feishu.bindings[appId]; continue; }
        const existing = next.channels.feishu.bindings[appId];
        const timestamp = Date.now();
        next.channels.feishu.bindings[appId] = {
          appId,
          appSecret: normalizeSecret(bindingPatch.appSecret) ?? existing?.appSecret ?? "",
          domain: normalizeDomain(bindingPatch.domain ?? existing?.domain),
          enabled: bindingPatch.enabled ?? existing?.enabled ?? true,
          verificationToken: normalizeSecret(bindingPatch.verificationToken) ?? existing?.verificationToken,
          encryptKey: normalizeSecret(bindingPatch.encryptKey) ?? existing?.encryptKey,
          openId: normalizeSecret(bindingPatch.openId) ?? existing?.openId,
          botName: normalizeSecret(bindingPatch.botName) ?? existing?.botName,
          botOpenId: normalizeSecret(bindingPatch.botOpenId) ?? existing?.botOpenId,
          createdAt: existing?.createdAt ?? bindingPatch.createdAt ?? timestamp,
          updatedAt: timestamp,
        };
      }
    }
  }
  next.updatedAt = Date.now();
  return next;
}
