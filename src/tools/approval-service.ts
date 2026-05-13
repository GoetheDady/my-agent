import type { Database } from "bun:sqlite";
import { defaultAgentConfigService, type AgentConfigService } from "../agents/config-service";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { normalizePath } from "./executor";
import { evaluateToolPolicy } from "./policy";

export type ToolApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ToolRiskLevel = "low" | "medium" | "high";

export interface ToolApprovalRecord {
  id: string;
  agent_id: string;
  session_id: string | null;
  task_id: string | null;
  channel: string | null;
  conversation_id: string | null;
  external_conversation_id: string | null;
  external_user_id: string | null;
  tool_call_id: string;
  tool_name: string;
  args: string;
  risk_level: ToolRiskLevel;
  reason: string;
  status: ToolApprovalStatus;
  remember_choice: number;
  resume_payload: string | null;
  created_at: number;
  resolved_at: number | null;
}

export interface PublicToolApproval {
  id: string;
  agentId: string;
  sessionId: string | null;
  taskId: string | null;
  channel: string | null;
  conversationId: string | null;
  externalConversationId: string | null;
  externalUserId: string | null;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  reason: string;
  status: ToolApprovalStatus;
  rememberChoice: boolean;
  createdAt: number;
  resolvedAt: number | null;
}

export interface CreateToolApprovalInput {
  agentId?: string;
  sessionId?: string | null;
  taskId?: string | null;
  channel?: string | null;
  conversationId?: string | null;
  externalConversationId?: string | null;
  externalUserId?: string | null;
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  reason?: string;
}

export interface ChannelApprovalResumePayload {
  userText: string;
  messages: unknown[];
  deliverMetadata?: Record<string, unknown>;
}

export interface CreateChannelApprovalInput extends CreateToolApprovalInput {
  channel: string;
  conversationId: string;
  externalConversationId: string;
  externalUserId: string;
  resumePayload: ChannelApprovalResumePayload;
}

export interface ResolveToolApprovalInput {
  rememberChoice?: boolean;
}

export interface ResolveChannelApprovalInput extends ResolveToolApprovalInput {
  channel: string;
  externalConversationId: string;
  externalUserId: string;
  decision: "approve" | "deny";
}

function normalizeAgentId(value?: string): string {
  return value?.trim() || "default";
}

function normalizeNullable(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeChannel(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function riskForTool(toolName: string, args: Record<string, unknown>): ToolRiskLevel {
  if (toolName === "read_file") return "low";
  if (toolName === "write_file") return args.mode === "overwrite" ? "high" : "medium";
  if (toolName.startsWith("agent_config") || toolName === "agent_create") return "high";
  if (toolName.startsWith("skill_")) return "medium";
  return "medium";
}

function parseArgs(args: string): Record<string, unknown> {
  try {
    return normalizeArgs(JSON.parse(args));
  } catch {
    return {};
  }
}

function toPublicApproval(record: ToolApprovalRecord): PublicToolApproval {
  return {
    id: record.id,
    agentId: record.agent_id,
    sessionId: record.session_id,
    taskId: record.task_id,
    channel: record.channel,
    conversationId: record.conversation_id,
    externalConversationId: record.external_conversation_id,
    externalUserId: record.external_user_id,
    toolCallId: record.tool_call_id,
    toolName: record.tool_name,
    args: parseArgs(record.args),
    riskLevel: record.risk_level,
    reason: record.reason,
    status: record.status,
    rememberChoice: record.remember_choice === 1,
    createdAt: record.created_at,
    resolvedAt: record.resolved_at,
  };
}

/**
 * ApprovalService 负责工具调用审批的持久化、审计和“记住路径”。
 *
 * 它不替代 AI SDK 的工具继续执行机制；聊天页仍需要调用
 * addToolApprovalResponse() 让模型流程继续。
 */
export class ApprovalService {
  constructor(
    private readonly database: Database = getDb(),
    private readonly agentConfigService: AgentConfigService = defaultAgentConfigService,
  ) {}

  createApproval(input: CreateToolApprovalInput): PublicToolApproval {
    const agentId = normalizeAgentId(input.agentId);
    const toolCallId = input.toolCallId.trim();
    const toolName = input.toolName.trim();
    if (!toolCallId) throw new Error("toolCallId 不能为空");
    if (!toolName) throw new Error("toolName 不能为空");

    const existing = this.findByToolCall(agentId, toolCallId);
    if (existing) return toPublicApproval(existing);

    const args = normalizeArgs(input.args);
    const policy = evaluateToolPolicy({
      toolName,
      operation: "write",
      agentId,
      allowlisted: false,
    });
    const now = Date.now();
    const record: ToolApprovalRecord = {
      id: crypto.randomUUID(),
      agent_id: agentId,
      session_id: normalizeNullable(input.sessionId),
      task_id: normalizeNullable(input.taskId),
      channel: normalizeChannel(input.channel),
      conversation_id: normalizeNullable(input.conversationId),
      external_conversation_id: normalizeNullable(input.externalConversationId),
      external_user_id: normalizeNullable(input.externalUserId),
      tool_call_id: toolCallId,
      tool_name: toolName,
      args: JSON.stringify(args),
      risk_level: riskForTool(toolName, args),
      reason: input.reason?.trim() || policy.reason,
      status: "pending",
      remember_choice: 0,
      resume_payload: null,
      created_at: now,
      resolved_at: null,
    };
    this.database
      .query(
        `INSERT INTO tool_approvals
         (id, agent_id, session_id, task_id, channel, conversation_id, external_conversation_id, external_user_id,
          tool_call_id, tool_name, args, risk_level, reason, status, remember_choice, resume_payload, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.agent_id,
        record.session_id,
        record.task_id,
        record.channel,
        record.conversation_id,
        record.external_conversation_id,
        record.external_user_id,
        record.tool_call_id,
        record.tool_name,
        record.args,
        record.risk_level,
        record.reason,
        record.status,
        record.remember_choice,
        record.resume_payload,
        record.created_at,
        record.resolved_at,
      );
    appendEvent({
      agent_id: agentId,
      task_id: record.task_id,
      type: "tool.approval.created",
      payload: {
        approvalId: record.id,
        toolCallId,
        toolName,
        riskLevel: record.risk_level,
        reason: record.reason,
        channel: record.channel,
        externalConversationId: record.external_conversation_id,
      },
    }, this.database);
    return toPublicApproval(record);
  }

  createChannelApproval(input: CreateChannelApprovalInput): PublicToolApproval {
    const approval = this.createApproval(input);
    const resumePayload = JSON.stringify(input.resumePayload);
    this.database
      .query(
        `UPDATE tool_approvals
         SET channel = ?, conversation_id = ?, external_conversation_id = ?, external_user_id = ?, resume_payload = ?
         WHERE id = ?`,
      )
      .run(
        normalizeChannel(input.channel),
        normalizeNullable(input.conversationId),
        normalizeNullable(input.externalConversationId),
        normalizeNullable(input.externalUserId),
        resumePayload,
        approval.id,
      );
    return toPublicApproval(this.requireApproval(approval.id));
  }

  approveApproval(id: string, input: ResolveToolApprovalInput = {}): PublicToolApproval {
    const record = this.requireApproval(id);
    if (record.status !== "pending") return toPublicApproval(record);
    const now = Date.now();
    const rememberChoice = Boolean(input.rememberChoice);
    this.database
      .query("UPDATE tool_approvals SET status = 'approved', remember_choice = ?, resolved_at = ? WHERE id = ?")
      .run(rememberChoice ? 1 : 0, now, id);
    const updated = this.requireApproval(id);
    if (rememberChoice) {
      this.rememberApproval(updated);
    }
    appendEvent({
      agent_id: updated.agent_id,
      task_id: updated.task_id,
      type: "tool.approval.approved",
      payload: {
        approvalId: updated.id,
        toolCallId: updated.tool_call_id,
        toolName: updated.tool_name,
        rememberChoice,
      },
    }, this.database);
    return toPublicApproval(updated);
  }

  denyApproval(id: string): PublicToolApproval {
    const record = this.requireApproval(id);
    if (record.status !== "pending") return toPublicApproval(record);
    const now = Date.now();
    this.database
      .query("UPDATE tool_approvals SET status = 'denied', resolved_at = ? WHERE id = ?")
      .run(now, id);
    const updated = this.requireApproval(id);
    appendEvent({
      agent_id: updated.agent_id,
      task_id: updated.task_id,
      type: "tool.approval.denied",
      payload: {
        approvalId: updated.id,
        toolCallId: updated.tool_call_id,
        toolName: updated.tool_name,
      },
    }, this.database);
    return toPublicApproval(updated);
  }

  resolveChannelApproval(input: ResolveChannelApprovalInput & { approvalId: string }): PublicToolApproval {
    const record = this.requireApproval(input.approvalId);
    this.assertChannelMatch(record, input);
    if (input.decision === "approve") {
      return this.approveApproval(input.approvalId, { rememberChoice: input.rememberChoice });
    }
    return this.denyApproval(input.approvalId);
  }

  getApproval(id: string): PublicToolApproval {
    return toPublicApproval(this.requireApproval(id));
  }

  getResumePayload(id: string): ChannelApprovalResumePayload | null {
    const record = this.requireApproval(id);
    if (!record.resume_payload) return null;
    try {
      const parsed = JSON.parse(record.resume_payload) as ChannelApprovalResumePayload;
      if (!Array.isArray(parsed.messages)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  listApprovals(agentId = "default", limit = 50): PublicToolApproval[] {
    return this.database
      .query<ToolApprovalRecord, [string, number]>(
        `SELECT id, agent_id, session_id, task_id, channel, conversation_id, external_conversation_id, external_user_id,
                tool_call_id, tool_name, args, risk_level, reason, status, remember_choice, resume_payload, created_at, resolved_at
         FROM tool_approvals
         WHERE agent_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(normalizeAgentId(agentId), Math.max(1, Math.min(limit, 200)))
      .map(toPublicApproval);
  }

  findByToolCall(agentId: string, toolCallId: string): ToolApprovalRecord | null {
    return this.database
      .query<ToolApprovalRecord, [string, string]>(
        `SELECT id, agent_id, session_id, task_id, channel, conversation_id, external_conversation_id, external_user_id,
                tool_call_id, tool_name, args, risk_level, reason, status, remember_choice, resume_payload, created_at, resolved_at
         FROM tool_approvals
         WHERE agent_id = ? AND tool_call_id = ?`,
      )
      .get(normalizeAgentId(agentId), toolCallId) ?? null;
  }

  private requireApproval(id: string): ToolApprovalRecord {
    const record = this.database
      .query<ToolApprovalRecord, [string]>(
        `SELECT id, agent_id, session_id, task_id, channel, conversation_id, external_conversation_id, external_user_id,
                tool_call_id, tool_name, args, risk_level, reason, status, remember_choice, resume_payload, created_at, resolved_at
         FROM tool_approvals
         WHERE id = ?`,
      )
      .get(id);
    if (!record) throw new Error(`Approval not found: ${id}`);
    return record;
  }

  private assertChannelMatch(
    record: ToolApprovalRecord,
    input: Pick<ResolveChannelApprovalInput, "channel" | "externalConversationId" | "externalUserId">,
  ): void {
    const channel = normalizeChannel(input.channel);
    const externalConversationId = normalizeNullable(input.externalConversationId);
    const externalUserId = normalizeNullable(input.externalUserId);
    if (record.channel !== channel) {
      throw new Error("审批渠道不匹配");
    }
    if (record.external_conversation_id !== externalConversationId) {
      throw new Error("审批会话不匹配");
    }
    if (record.external_user_id !== externalUserId) {
      throw new Error("审批用户不匹配");
    }
  }

  private rememberApproval(record: ToolApprovalRecord): void {
    if (record.tool_name !== "write_file") return;
    const args = parseArgs(record.args);
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return;
    const normalizedPath = normalizePath(path);
    this.agentConfigService.patchAgentConfig(record.agent_id, {
      tools: {
        addAllowedPaths: [normalizedPath],
      },
    }, { agentId: record.agent_id, database: this.database });
    appendEvent({
      agent_id: record.agent_id,
      task_id: record.task_id,
      type: "tool.policy.updated",
      payload: {
        source: "approval_remember_choice",
        toolName: record.tool_name,
        path: normalizedPath,
      },
    }, this.database);
  }
}

export const defaultApprovalService = new ApprovalService();
