import { getTool, type RegisteredTool } from "./registry";
import { defaultAgentConfigService, type AgentConfigService } from "../agents/config-service";

export interface ToolPolicyInput {
  toolName: string;
  operation?: "read" | "write";
  allowlisted?: boolean;
  tool?: RegisteredTool | null;
  agentId?: string;
  agentConfigService?: AgentConfigService;
}

export interface ToolPolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  createsCandidateMemory?: boolean;
}

/**
 * 工具权限策略。
 *
 * v1 的核心规则：
 * - read / memory_read 默认允许。
 * - memory_write 直接写 active memory，但必须记录事件和证据。
 * - 普通 write 工具需要审批，除非路径或选择已 allowlist。
 *
 * @param input 工具名、操作类型、白名单状态和可选注册表元数据。
 * @returns 是否允许、是否需要审批，以及决策原因。
 */
export function evaluateToolPolicy(input: ToolPolicyInput): ToolPolicyDecision {
  const registeredTool = input.tool ?? getTool(input.toolName);
  if (!registeredTool) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "unknown_tool",
    };
  }

  const agentConfigService = input.agentConfigService ?? defaultAgentConfigService;
  const agentConfig = agentConfigService.getAgentConfig(input.agentId ?? "default");
  if (!agentConfig.tools.enabledToolsets.includes(registeredTool.toolset)) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "toolset_disabled",
    };
  }

  if (registeredTool.category === "read" || registeredTool.category === "memory_read") {
    return {
      allowed: true,
      requiresApproval: false,
      reason: "read_allowed",
    };
  }

  if (registeredTool.category === "memory_write") {
    return {
      allowed: true,
      requiresApproval: false,
      reason: "memory_write_allowed",
      createsCandidateMemory: registeredTool.createsCandidateMemory ?? false,
    };
  }

  const allowlisted = input.allowlisted === true;
  const configuredApproval = agentConfig.tools.requiresApproval.includes(input.toolName);
  // 路径白名单是用户“记住此选择”的结果，应优先于默认审批规则。
  // 这样 write_file 对同一路径再次执行时可以直接运行，但未入白名单路径仍会触发审批。
  if (allowlisted) {
    return {
      allowed: true,
      requiresApproval: false,
      reason: "write_allowlisted",
    };
  }

  // 普通写工具是否审批由当前 Agent 的 requiresApproval 配置决定。
  // Tools 页面修改该配置后，下一次 buildAgentTools 会立即按新策略挂载审批钩子。
  const reason = configuredApproval ? "write_requires_configured_approval" : "write_allowed_by_agent_policy";
  return {
    allowed: true,
    requiresApproval: configuredApproval,
    reason,
  };
}
