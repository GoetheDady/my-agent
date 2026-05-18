import type { TaskFailureClassification, TaskFailureStage } from "./task-types";

export interface TaskFailureContext {
  stage?: TaskFailureStage;
  isClientAbort?: boolean;
  isTimeout?: boolean;
  isPermissionDenied?: boolean;
  isToolError?: boolean;
}

export function classifyTaskFailure(
  error: string,
  context: TaskFailureContext = {},
): TaskFailureClassification {
  if (context.isClientAbort) {
    return { failure_type: "user_canceled", failure_stage: "cancel", retriable: false };
  }
  if (context.isTimeout || /timed out/i.test(error)) {
    return { failure_type: "timeout", failure_stage: context.stage ?? "model_call", retriable: true };
  }
  if (context.isPermissionDenied || /permission|审批|denied/i.test(error)) {
    return { failure_type: "permission_denied", failure_stage: context.stage ?? "tool_call", retriable: false };
  }
  if (context.isToolError) {
    return { failure_type: "tool_error", failure_stage: context.stage ?? "tool_call", retriable: true };
  }
  if (context.stage === "delivery") {
    return { failure_type: "unknown", failure_stage: "delivery", retriable: false };
  }
  if (context.stage === "prompt_build") {
    return { failure_type: "context_missing", failure_stage: "prompt_build", retriable: false };
  }
  return { failure_type: "model_error", failure_stage: context.stage ?? "model_call", retriable: true };
}
