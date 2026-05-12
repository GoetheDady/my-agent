import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { AgentConfigService, defaultAgentConfigService } from "../agents/config-service";
import { getRuntimeDataDir } from "../core/config";
import { appendEvent } from "../events/event-log";
import type {
  SkillCreateInput,
  SkillListResult,
  SkillRecord,
  SkillMetadata,
  SkillServiceContext,
  SkillStatus,
  SkillStatusUpdateResult,
  SkillViewResult,
} from "./skill-types";

const DEFAULT_AGENT_ID = "default";
const DEFAULT_SKILLS_DIR_NAME = "skills";
const SKILL_MARKDOWN_FILENAME = "SKILL.md";

function now(): number {
  return Date.now();
}

function safeSkillSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return normalized.length > 0 ? normalized : "skill";
}

function jsonValue(value: string): string {
  return JSON.stringify(value);
}

function buildFrontmatter(input: {
  id: string;
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
  source: string;
}): string {
  const lines = [
    "---",
    `id: ${jsonValue(input.id)}`,
    `name: ${jsonValue(input.name)}`,
    `description: ${jsonValue(input.description)}`,
    `category: ${jsonValue(input.category)}`,
    `source: ${jsonValue(input.source)}`,
  ];
  if (input.allowedTools.length > 0) {
    lines.push("allowedTools:");
    for (const toolName of input.allowedTools) {
      lines.push(`  - ${jsonValue(toolName)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function buildSkillMarkdown(input: {
  id: string;
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
  source: string;
  content: string;
}): string {
  const trimmedContent = input.content.trim();
  if (trimmedContent.startsWith("---")) {
    return `${trimmedContent}\n`;
  }

  const frontmatter = buildFrontmatter(input);
  const body = trimmedContent.length > 0
    ? trimmedContent
    : `# ${input.name}\n\n${input.description}`;
  return `${frontmatter}\n\n${body.trim()}\n`;
}

function skillDirectoryFor(agentId: string, skillId: string, rootDir: string): string {
  return resolve(rootDir, "agents", agentId, DEFAULT_SKILLS_DIR_NAME, skillId);
}

function skillFilePathFor(agentId: string, skillId: string, rootDir: string): string {
  return resolve(skillDirectoryFor(agentId, skillId, rootDir), SKILL_MARKDOWN_FILENAME);
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function toSkillRecord(agentId: string, rootDir: string, skillId: string, entry: SkillMetadata): SkillRecord {
  const directory = skillDirectoryFor(agentId, skillId, rootDir);
  const filePath = skillFilePathFor(agentId, skillId, rootDir);
  return {
    id: skillId,
    agentId,
    directory,
    filePath,
    ...entry,
  };
}

function formatSkillIndex(skills: SkillRecord[]): string {
  if (skills.length === 0) {
    return "";
  }

  const lines = [
    "## Skills",
    "下面是当前 Agent 已启用的能力目录。先看索引，需要时再调用 `skill_view(skillId)` 读取完整说明。",
    "",
  ];

  for (const skill of skills) {
    const toolText = skill.allowedTools.length > 0
      ? `；tools: ${skill.allowedTools.join(", ")}`
      : "";
    lines.push(`- ${skill.id}: ${skill.name} — ${skill.description}（${skill.category}${toolText}）`);
  }

  lines.push("", "如果某个 skill 与当前任务相关，请先加载它，再继续执行。");
  return lines.join("\n");
}

function emitSkillEvent(
  database: Database | undefined,
  input: SkillServiceContext,
  type: "skill.created" | "skill.updated" | "skill.enabled" | "skill.disabled" | "skill.viewed",
  payload: Record<string, unknown>,
): void {
  appendEvent({
    agent_id: input.agentId ?? DEFAULT_AGENT_ID,
    task_id: input.taskId ?? null,
    conversation_id: input.conversationId ?? null,
    type,
    payload,
  }, database);
}

export class SkillService {
  private readonly rootDir: string;
  private readonly agentConfigService: AgentConfigService;

  constructor(options: { rootDir?: string; agentConfigService?: AgentConfigService } = {}) {
    this.rootDir = options.rootDir ?? getRuntimeDataDir();
    this.agentConfigService = options.agentConfigService ?? new AgentConfigService({ rootDir: this.rootDir });
  }

  private getAgentId(input: SkillServiceContext = {}): string {
    return safeSkillSegment(input.agentId ?? DEFAULT_AGENT_ID);
  }

  private getSkillItems(agentId: string, context: SkillServiceContext = {}): Record<string, SkillMetadata> {
    return this.agentConfigService.getAgentConfig(agentId, context).skills.items;
  }

  private getEntry(agentId: string, skillId: string, context: SkillServiceContext = {}): SkillRecord | null {
    const entry = this.getSkillItems(agentId, context)[skillId];
    if (!entry) return null;
    return toSkillRecord(agentId, this.rootDir, skillId, entry);
  }

  listSkills(agentIdOrContext: string | SkillServiceContext = DEFAULT_AGENT_ID, status: "enabled" | "disabled" | "all" = "all"): SkillListResult {
    const input = typeof agentIdOrContext === "string" ? { agentId: agentIdOrContext } : agentIdOrContext;
    const agentId = this.getAgentId(input);
    const config = this.agentConfigService.getAgentConfig(agentId, input);
    const records = Object.entries(config.skills.items).map(([skillId, entry]) => toSkillRecord(agentId, this.rootDir, skillId, entry));
    const filtered = status === "all"
      ? records
      : records.filter((skill) => skill.status === status);
    filtered.sort((a, b) => {
      if (a.status !== b.status) return a.status === "enabled" ? -1 : 1;
      return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    });
    return {
      agentId,
      skills: filtered,
      enabledCount: records.filter((skill) => skill.status === "enabled").length,
      disabledCount: records.filter((skill) => skill.status === "disabled").length,
    };
  }

  listEnabledSkills(agentIdOrContext: string | SkillServiceContext = DEFAULT_AGENT_ID): SkillRecord[] {
    return this.listSkills(agentIdOrContext, "enabled").skills;
  }

  buildSkillIndex(agentIdOrContext: string | SkillServiceContext = DEFAULT_AGENT_ID): string {
    const context = typeof agentIdOrContext === "string" ? { agentId: agentIdOrContext } : agentIdOrContext;
    return formatSkillIndex(
      this.listEnabledSkills(context).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    );
  }

  viewSkill(
    skillId: string,
    context: SkillServiceContext = {},
    options: { filePath?: string; allowDisabled?: boolean } = {},
  ): SkillViewResult {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const skill = this.getEntry(agentId, normalizedSkillId, context);
    if (!skill) {
      return { agentId, skill: null, content: null, filePath: null, error: "skill_not_found" };
    }

    if (!options.allowDisabled && skill.status !== "enabled") {
      return { agentId, skill: null, content: null, filePath: null, error: "skill_disabled" };
    }

    const skillDir = skill.directory;
    const targetFilePath = options.filePath
      ? this.resolveSkillFilePath(skillDir, options.filePath)
      : skill.filePath;

    if (!existsSync(targetFilePath)) {
      return { agentId, skill, content: null, filePath: targetFilePath, error: "file_not_found" };
    }

    const content = readFileSync(targetFilePath, "utf8");
    emitSkillEvent(context.database, { ...context, agentId }, "skill.viewed", {
      skillId: skill.id,
      skillName: skill.name,
      filePath: targetFilePath,
      status: skill.status,
    });

    return { agentId, skill, content, filePath: targetFilePath };
  }

  createSkill(input: SkillCreateInput, context: SkillServiceContext = {}): SkillRecord {
    const agentId = this.getAgentId(context);
    const skillId = safeSkillSegment(input.skillId);
    const nowTs = now();
    const existing = this.getEntry(agentId, skillId, context);
    const status: SkillStatus = input.status ?? existing?.status ?? "enabled";
    const record: SkillMetadata = {
      name: input.name.trim(),
      description: input.description.trim(),
      category: (input.category ?? existing?.category ?? "general").trim() || "general",
      allowedTools: (input.allowedTools ?? existing?.allowedTools ?? []).map((toolName) => toolName.trim()).filter(Boolean),
      source: input.source ?? existing?.source ?? "agent-created",
      status,
      createdAt: existing?.createdAt ?? nowTs,
      updatedAt: nowTs,
    };

    const skillDir = skillDirectoryFor(agentId, skillId, this.rootDir);
    ensureDirectory(skillDir);
    const skillFilePath = skillFilePathFor(agentId, skillId, this.rootDir);
    const markdown = buildSkillMarkdown({
      id: skillId,
      name: record.name,
      description: record.description,
      category: record.category,
      allowedTools: record.allowedTools,
      source: record.source,
      content: input.content,
    });
    writeFileSync(skillFilePath, markdown, "utf8");

    this.agentConfigService.patchAgentConfig(agentId, {
      skills: {
        items: {
          [skillId]: record,
        },
      },
    }, context);

    emitSkillEvent(context.database, { ...context, agentId }, existing ? "skill.updated" : "skill.created", {
      skillId,
      name: record.name,
      status: record.status,
      category: record.category,
      allowedTools: record.allowedTools,
      source: record.source,
    });

    return toSkillRecord(agentId, this.rootDir, skillId, record);
  }

  enableSkill(skillId: string, context: SkillServiceContext = {}): SkillStatusUpdateResult {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const record = this.getEntry(agentId, normalizedSkillId, context);
    if (!record) {
      return { agentId, skill: null, changed: false };
    }
    this.agentConfigService.patchAgentConfig(agentId, {
      skills: {
        items: {
          [normalizedSkillId]: {
            ...record,
            status: "enabled",
            updatedAt: now(),
          },
        },
      },
    }, context);
    const next = this.getEntry(agentId, normalizedSkillId, context) ?? {
      ...record,
      status: "enabled",
      updatedAt: now(),
    };
    emitSkillEvent(context.database, { ...context, agentId }, "skill.enabled", {
      skillId: normalizedSkillId,
      name: next.name,
      category: next.category,
    });
    return { agentId, skill: next, changed: true };
  }

  disableSkill(skillId: string, context: SkillServiceContext = {}): SkillStatusUpdateResult {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const record = this.getEntry(agentId, normalizedSkillId, context);
    if (!record) {
      return { agentId, skill: null, changed: false };
    }
    this.agentConfigService.patchAgentConfig(agentId, {
      skills: {
        items: {
          [normalizedSkillId]: {
            ...record,
            status: "disabled",
            updatedAt: now(),
          },
        },
      },
    }, context);
    const next = this.getEntry(agentId, normalizedSkillId, context) ?? {
      ...record,
      status: "disabled",
      updatedAt: now(),
    };
    emitSkillEvent(context.database, { ...context, agentId }, "skill.disabled", {
      skillId: normalizedSkillId,
      name: next.name,
      category: next.category,
    });
    return { agentId, skill: next, changed: true };
  }

  private resolveSkillFilePath(skillDir: string, inputPath: string): string {
    const normalized = inputPath.trim() || SKILL_MARKDOWN_FILENAME;
    const resolved = resolve(skillDir, normalized);
    const relativePath = relative(skillDir, resolved);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Unsafe skill file path");
    }
    return resolved;
  }
}

export const defaultSkillService = new SkillService({ agentConfigService: defaultAgentConfigService });

export function buildSkillIndex(agentId: string, database?: Database): string {
  void database;
  return new SkillService().buildSkillIndex(agentId);
}
