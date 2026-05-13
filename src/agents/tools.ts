import { tool } from "ai";
import { z } from "zod";
import type { PublicDelegation } from "../delegations/types";
import { defaultAgentService, type AgentService } from "./service";
import type { AgentServiceContext } from "./service";

interface AgentDelegationService {
  delegateTask(input: {
    parentAgentId: string;
    parentTaskId: string;
    parentSessionId?: string | null;
    parentConversationId?: string | null;
    sourceChannel: string;
    sourceUserId: string;
    sourceMetadata?: Record<string, unknown>;
    targetAgentId: string;
    instruction: string;
    reason?: string;
  }): PublicDelegation;
}

export interface AgentToolContext extends AgentServiceContext {
  agentId?: string;
  taskId?: string | null;
  conversationId?: string | null;
  sessionId?: string | null;
  sourceChannel?: string | null;
  sourceUserId?: string | null;
  sourceMetadata?: Record<string, unknown>;
  agentService?: AgentService;
  delegationService?: AgentDelegationService;
}

function getService(context: AgentToolContext): AgentService {
  return context.agentService ?? defaultAgentService;
}

async function getDelegationService(context: AgentToolContext): Promise<AgentDelegationService> {
  if (context.delegationService) return context.delegationService;
  const { defaultDelegationService } = await import("../delegations/service");
  return defaultDelegationService;
}

const agentListSchema = z.object({});

const agentGetSchema = z.object({
  agentId: z.string().optional(),
});

const agentCreateSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  workspacePath: z.string().optional(),
  model: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
});

const agentDelegateSchema = z.object({
  targetAgentId: z.string().min(1),
  instruction: z.string().min(1),
  reason: z.string().optional(),
});

function summarizeAgent(result: ReturnType<AgentService["getAgent"]>) {
  if (!result) return null;
  return {
    ...result.agent,
    configSummary: {
      name: result.config.name,
      description: result.config.description,
      model: result.config.model,
      enabledToolsets: result.config.tools.enabledToolsets,
      enabledSkillCount: Object.values(result.config.skills.items)
        .filter((skill) => skill.status === "enabled").length,
      disabledSkillCount: Object.values(result.config.skills.items)
        .filter((skill) => skill.status === "disabled").length,
    },
  };
}

export function createAgentTools(context: AgentToolContext = {}) {
  const service = getService(context);
  const baseContext: AgentServiceContext = {
    database: context.database,
  };

  return {
    agent_list: tool({
      description: "列出系统中可用的 Agent，并返回每个 Agent 的配置摘要。",
      inputSchema: agentListSchema,
      execute: async () => {
        return {
          success: true,
          agents: service.listAgents(baseContext).map((agentWithConfig) => summarizeAgent(agentWithConfig)),
        };
      },
    }),
    agent_get: tool({
      description: "读取某个 Agent 的运行状态和配置摘要。不读取完整 agent.json 时优先用这个工具。",
      inputSchema: agentGetSchema,
      execute: async (input: z.infer<typeof agentGetSchema>) => {
        const agentId = input.agentId ?? context.agentId ?? "default";
        const agent = summarizeAgent(service.getAgent(agentId, baseContext));
        return agent
          ? { success: true, agent }
          : { success: false, error: "agent_not_found", agentId };
      },
    }),
    agent_create: tool({
      description: "创建新的 Agent，并初始化独立 agent.json、skill 目录和 soul.md。不会创建 delegation 关系。",
      inputSchema: agentCreateSchema,
      execute: async (input: z.infer<typeof agentCreateSchema>) => {
        try {
          const created = service.createAgent(input, baseContext);
          return { success: true, agent: summarizeAgent(created) };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "agent_create_failed",
          };
        }
      },
    }),
    agent_delegate: tool({
      description: "把一个明确子任务异步委派给另一个已存在的 Agent。调用后立即返回 delegationId，不等待目标 Agent 完成；目标 Agent 完成后会由当前 Agent 整理结果并通知用户。",
      inputSchema: agentDelegateSchema,
      execute: async (input: z.infer<typeof agentDelegateSchema>) => {
        try {
          const delegationService = await getDelegationService(context);
          if (!context.taskId) {
            return { success: false, error: "当前运行上下文缺少 taskId，不能委派任务" };
          }
          const delegation = delegationService.delegateTask({
            parentAgentId: context.agentId ?? "default",
            parentTaskId: context.taskId,
            parentSessionId: context.sessionId,
            parentConversationId: context.conversationId,
            sourceChannel: context.sourceChannel ?? "web",
            sourceUserId: context.sourceUserId ?? "default",
            sourceMetadata: context.sourceMetadata,
            targetAgentId: input.targetAgentId,
            instruction: input.instruction,
            reason: input.reason,
          });
          return {
            success: true,
            delegationId: delegation.id,
            childTaskId: delegation.childTaskId,
            status: delegation.status,
            message: "已派发给目标 Agent，完成后会回到原会话通知用户。",
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "agent_delegate_failed",
          };
        }
      },
    }),
  };
}
