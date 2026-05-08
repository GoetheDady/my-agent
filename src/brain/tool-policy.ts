import { getTool, type RegisteredTool } from "./tool-registry";

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
      reason: "memory_write_candidate",
      createsCandidateMemory: registeredTool.createsCandidateMemory ?? true,
    };
  }

  const allowlisted = input.allowlisted === true;
  return {
    allowed: true,
    requiresApproval: !allowlisted,
    reason: allowlisted ? "write_allowlisted" : "write_requires_approval",
  };
}
