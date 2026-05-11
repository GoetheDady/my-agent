import { getTool, type RegisteredTool } from "./registry";

export interface ToolPolicyInput {
  toolName: string;
  operation?: "read" | "write";
  allowlisted?: boolean;
  tool?: RegisteredTool | null;
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
  // 未列入 allowlist 的普通写操作仍可执行，但前端必须先展示审批卡。
  return {
    allowed: true,
    requiresApproval: !allowlisted,
    reason: allowlisted ? "write_allowlisted" : "write_requires_approval",
  };
}
