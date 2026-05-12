import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { getProfileFilePaths, loadProfileContext } from "../profiles/files";
import { AgentConfigService, defaultAgentConfigService } from "./config-service";
import type { AgentRecord, AgentStatus, CreateAgentInput, UpdateAgentInput } from "./agent-types";
import type { AgentConfig } from "./config-types";

const DEFAULT_AGENT_ID = "default";
const DEFAULT_AGENT_NAME = "Default Agent";

export interface AgentServiceContext {
  database?: Database;
}

export interface AgentServiceOptions {
  configService?: AgentConfigService;
  profileRootDir?: string;
}

export interface AgentWithConfig {
  agent: AgentRecord;
  config: AgentConfig;
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

function emitAgentEvent(
  database: Database,
  agentId: string,
  type: "agent.created" | "agent.updated" | "agent.initialized" | "agent.create.failed",
  payload: Record<string, unknown>,
): void {
  appendEvent({
    agent_id: agentId,
    type,
    payload,
  }, database);
}

export class AgentService {
  private readonly configService: AgentConfigService;
  private readonly profileRootDir?: string;

  constructor(configServiceOrOptions: AgentConfigService | AgentServiceOptions = defaultAgentConfigService) {
    if (configServiceOrOptions instanceof AgentConfigService) {
      this.configService = configServiceOrOptions;
      this.profileRootDir = undefined;
      return;
    }
    this.configService = configServiceOrOptions.configService ?? defaultAgentConfigService;
    this.profileRootDir = configServiceOrOptions.profileRootDir;
  }

  normalizeAgentId(agentId: string): string {
    return safeAgentSegment(agentId);
  }

  ensureAgent(
    agentId = DEFAULT_AGENT_ID,
    defaults: Partial<CreateAgentInput> = {},
    context: AgentServiceContext = {},
  ): AgentRecord {
    const database = context.database ?? getDb();
    const normalizedAgentId = safeAgentSegment(agentId);
    const existing = this.getAgent(normalizedAgentId, context);
    if (existing) return existing.agent;

    return this.createAgent({
      agentId: normalizedAgentId,
      name: defaults.name ?? (normalizedAgentId === DEFAULT_AGENT_ID ? DEFAULT_AGENT_NAME : normalizedAgentId),
      description: defaults.description,
      workspacePath: defaults.workspacePath,
      model: defaults.model,
    }, { database }).agent;
  }

  createAgent(input: CreateAgentInput, context: AgentServiceContext = {}): AgentWithConfig {
    const database = context.database ?? getDb();
    const agentId = safeAgentSegment(input.agentId);
    const name = input.name.trim();
    if (!name) {
      throw new Error("Agent name 不能为空");
    }
    if (this.readAgent(database, agentId)) {
      emitAgentEvent(database, agentId, "agent.create.failed", { reason: "agent_exists" });
      throw new Error(`Agent already exists: ${agentId}`);
    }

    const now = Date.now();
    database
      .query(
        `INSERT INTO agents (id, name, status, current_task_id, workspace_path, created_at, updated_at)
         VALUES (?, ?, 'idle', NULL, ?, ?, ?)`,
      )
      .run(agentId, name, input.workspacePath?.trim() ?? "", now, now);

    // 创建 Agent 是一个原子业务动作：表记录、agent.json、skill 目录和 soul.md
    // 必须一起初始化，后续 Runtime 才能按 agentId 独立加载配置和稳定人格。
    const config = this.configService.initializeAgentConfig(agentId, {
      name,
      description: input.description ?? "默认个人 Agent",
      model: input.model,
    }, { agentId, database });
    this.initializeAgentFiles(agentId);

    emitAgentEvent(database, agentId, "agent.created", { name, workspacePath: input.workspacePath ?? "" });
    const profilePaths = getProfileFilePaths({ agentId, profileRootDir: this.profileRootDir });
    emitAgentEvent(database, agentId, "agent.initialized", {
      configPath: this.configService.getConfigPath(agentId),
      soulPath: profilePaths.soulPath,
      userPath: profilePaths.userPath,
    });

    return { agent: this.requireAgent(database, agentId), config };
  }

  listAgents(context: AgentServiceContext = {}): AgentWithConfig[] {
    const database = context.database ?? getDb();
    return database
      .query<AgentRecord, []>(
        `SELECT id, name, status, current_task_id, workspace_path, created_at, updated_at
         FROM agents
         ORDER BY created_at ASC, id ASC`,
      )
      .all()
      .map((agent) => ({
        agent,
        config: this.configService.getAgentConfig(agent.id, { agentId: agent.id, database }),
      }));
  }

  getAgent(agentId: string, context: AgentServiceContext = {}): AgentWithConfig | null {
    const database = context.database ?? getDb();
    const normalizedAgentId = safeAgentSegment(agentId);
    const agent = this.readAgent(database, normalizedAgentId);
    if (!agent) return null;
    return {
      agent,
      config: this.configService.getAgentConfig(normalizedAgentId, { agentId: normalizedAgentId, database }),
    };
  }

  updateAgent(agentId: string, patch: UpdateAgentInput, context: AgentServiceContext = {}): AgentWithConfig {
    const database = context.database ?? getDb();
    const normalizedAgentId = safeAgentSegment(agentId);
    const existing = this.requireAgent(database, normalizedAgentId);
    const name = patch.name?.trim() ?? existing.name;
    const workspacePath = patch.workspacePath?.trim() ?? existing.workspace_path;
    if (!name) throw new Error("Agent name 不能为空");

    database
      .query("UPDATE agents SET name = ?, workspace_path = ?, updated_at = ? WHERE id = ?")
      .run(name, workspacePath, Date.now(), normalizedAgentId);
    this.configService.patchAgentConfig(normalizedAgentId, {
      name,
      description: patch.description,
    }, { agentId: normalizedAgentId, database });
    emitAgentEvent(database, normalizedAgentId, "agent.updated", {
      name,
      workspacePath,
      changedKeys: Object.keys(patch),
    });

    const updated = this.getAgent(normalizedAgentId, { database });
    if (!updated) throw new Error(`Agent not found: ${normalizedAgentId}`);
    return updated;
  }

  updateAgentStatus(
    agentId: string,
    status: AgentStatus,
    currentTaskId?: string | null,
    context: AgentServiceContext = {},
  ): void {
    const database = context.database ?? getDb();
    const normalizedAgentId = safeAgentSegment(agentId);
    const existing = this.requireAgent(database, normalizedAgentId);
    const nextCurrentTaskId = currentTaskId === undefined ? existing.current_task_id : currentTaskId;
    database
      .query(
        `UPDATE agents
         SET status = ?, current_task_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, nextCurrentTaskId, Date.now(), normalizedAgentId);
  }

  private initializeAgentFiles(agentId: string): void {
    const skillDir = resolve(dirname(this.configService.getConfigPath(agentId)), "skills");
    mkdirSync(skillDir, { recursive: true });
    loadProfileContext({
      agentId,
      userId: "default",
      profileRootDir: this.profileRootDir,
      createIfMissing: true,
    });
  }

  private readAgent(database: Database, agentId: string): AgentRecord | null {
    return database
      .query<AgentRecord, [string]>(
        `SELECT id, name, status, current_task_id, workspace_path, created_at, updated_at
         FROM agents
         WHERE id = ?`,
      )
      .get(agentId) ?? null;
  }

  private requireAgent(database: Database, agentId: string): AgentRecord {
    const agent = this.readAgent(database, agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return agent;
  }
}

export const defaultAgentService = new AgentService();
