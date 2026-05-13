import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { defaultAgentConfigService, type AgentConfigService } from "../agents/config-service";
import type { AgentConfigPatch } from "../agents/config-types";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { getSession, getSessionMessages } from "../sessions/service";
import { defaultApprovalService, type ApprovalService } from "../tools/approval-service";
import { listToolsForAgent } from "../tools/registry";
import { listToolsetsForAgent, TOOLSETS } from "../tools/toolsets";

interface ToolRouteOptions {
  database?: Database;
  approvalService?: ApprovalService;
  agentConfigService?: AgentConfigService;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 50;
}

function findToolCallById(messages: unknown[], toolCallId: string): { toolName: string; args: Record<string, unknown> } | null {
  // 从历史 assistant parts 里找对应工具调用参数，兼容 AI SDK v5/v6 的工具 part 形状。
  for (const msg of messages) {
    const message = msg as { role: string; content: string };
    if (message.role !== "assistant") continue;

    try {
      const parts = JSON.parse(message.content) as Array<{
        type: string;
        toolCallId?: string;
        toolName?: string;
        input?: unknown;
        toolInvocation?: { toolCallId: string; toolName?: string; args: Record<string, unknown> };
      }>;

      for (const part of parts) {
        if (part.toolInvocation?.toolCallId === toolCallId) {
          return { toolName: part.toolInvocation.toolName ?? "", args: part.toolInvocation.args };
        }
        if (part.toolCallId === toolCallId) {
          return {
            toolName: part.toolName ?? (part.type.startsWith("tool-") ? part.type.slice("tool-".length) : ""),
            args: asObject(part.input),
          };
        }
      }
    } catch {
      // 历史消息解析失败不影响其它消息。
    }
  }

  return null;
}

export function createToolRoutes(options: ToolRouteOptions = {}): Hono {
  const app = new Hono();
  const database = options.database ?? getDb();
  const approvalService = options.approvalService ?? defaultApprovalService;
  const agentConfigService = options.agentConfigService ?? defaultAgentConfigService;

  app.get("/", (c) => {
    const agentId = c.req.query("agentId")?.trim() || "default";
    const config = agentConfigService.getPublicAgentConfig(agentId, { agentId, database });
    return c.json({
      agentId,
      config: config.tools,
      toolsets: listToolsetsForAgent(agentId),
      tools: listToolsForAgent(agentId).map((registeredTool) => ({
        name: registeredTool.name,
        toolset: registeredTool.toolset,
        category: registeredTool.category,
        defaultEnabled: registeredTool.defaultEnabled,
        requiresApproval: config.tools.requiresApproval.includes(registeredTool.name),
      })),
      availableToolsets: TOOLSETS,
    });
  });

  app.get("/approvals", (c) => {
    const agentId = c.req.query("agentId")?.trim() || "default";
    return c.json({
      approvals: approvalService.listApprovals(agentId, parseLimit(c.req.query("limit") ?? null)),
    });
  });

  app.post("/approvals", async (c) => {
    const body = asObject(await c.req.json().catch(() => ({})));
    const toolCallId = asString(body.toolCallId).trim();
    const toolName = asString(body.toolName).trim();
    if (!toolCallId || !toolName) {
      return c.json({ error: "缺少 toolCallId 或 toolName" }, 400);
    }
    try {
      const approval = approvalService.createApproval({
        agentId: asString(body.agentId),
        sessionId: asString(body.sessionId),
        taskId: asString(body.taskId),
        toolCallId,
        toolName,
        args: asObject(body.args),
        reason: asString(body.reason),
      });
      return c.json({ approval }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "创建审批失败" }, 400);
    }
  });

  app.post("/approvals/:id/approve", async (c) => {
    const body = asObject(await c.req.json().catch(() => ({})));
    try {
      return c.json({
        approval: approvalService.approveApproval(c.req.param("id"), {
          rememberChoice: body.rememberChoice === true,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "批准审批失败";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

  app.post("/approvals/:id/deny", (c) => {
    try {
      return c.json({ approval: approvalService.denyApproval(c.req.param("id")) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "拒绝审批失败";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

  app.patch("/config/:agentId", async (c) => {
    const agentId = c.req.param("agentId");
    const body = asObject(await c.req.json().catch(() => ({})));
    const patch: AgentConfigPatch = {
      tools: {
        addEnabledToolsets: asStringArray(body.addEnabledToolsets),
        removeEnabledToolsets: asStringArray(body.removeEnabledToolsets),
        addRequiresApproval: asStringArray(body.addRequiresApproval),
        removeRequiresApproval: asStringArray(body.removeRequiresApproval),
        addAllowedPaths: asStringArray(body.addAllowedPaths),
        removeAllowedPaths: asStringArray(body.removeAllowedPaths),
      },
    };
    try {
      const config = agentConfigService.patchAgentConfig(agentId, patch, { agentId, database });
      appendEvent({
        agent_id: agentId,
        type: "tool.policy.updated",
        payload: { changedKeys: Object.keys(body) },
      }, database);
      return c.json({ config: config.tools });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "工具策略更新失败" }, 400);
    }
  });

  app.post("/whitelist", async (c) => {
    // 兼容旧前端入口：仍然接受 toolCallId/sessionId，但改为创建并批准审批，
    // 最终写入目标 Agent 的 agent.json，而不是全局 config.json。
    const body = asObject(await c.req.json().catch(() => ({})));
    const toolCallId = asString(body.toolCallId).trim();
    const sessionId = asString(body.sessionId).trim();
    if (!toolCallId || !sessionId) {
      return c.json({ error: "缺少 toolCallId 或 sessionId" }, 400);
    }

    try {
      const session = getSession(sessionId, database);
      const messages = getSessionMessages(sessionId, database);
      const toolCall = findToolCallById(messages, toolCallId);
      if (!toolCall) return c.json({ error: "工具调用不存在" }, 404);
      const approval = approvalService.createApproval({
        agentId: session?.agent_id ?? "default",
        sessionId,
        toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.args,
      });
      const approved = approvalService.approveApproval(approval.id, { rememberChoice: true });
      return c.json({ ok: true, approval: approved });
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : "更新白名单失败",
      }, 500);
    }
  });

  return app;
}

export default createToolRoutes();
