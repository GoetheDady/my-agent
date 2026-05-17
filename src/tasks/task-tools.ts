import { tool } from "ai";
import { z } from "zod";
import type { MemoryToolContext } from "../memory/memory-tools";
import {
  addTaskDependency,
  getTaskStep,
  listChildTasks,
  listTaskDependencies,
  listTaskSteps,
  removeTaskDependency,
  setTaskPlan,
  updateTaskStepStatus,
} from "./task-plan-store";
import { getTask } from "./task-store";
import type { TaskRecord, TaskStepStatus } from "./task-types";

interface TaskDelegationService {
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
    planStepId?: string | null;
    dependsOnTaskIds?: string[];
  }): {
    id: string;
    childTaskId: string;
    status: string;
  };
}

export interface TaskToolContext extends MemoryToolContext {
  delegationService?: TaskDelegationService;
}

const taskPlanGetSchema = z.object({});

const taskPlanSetSchema = z.object({
  steps: z.array(z.object({
    title: z.string(),
    detail: z.string().optional(),
  })),
});

const taskStepUpdateSchema = z.object({
  stepId: z.string().min(1),
  status: z.enum(["pending", "running", "completed", "failed", "canceled", "skipped"]),
});

const taskChildCreateSchema = z.object({
  stepId: z.string().min(1),
  targetAgentId: z.string().min(1),
  instruction: z.string().min(1),
  reason: z.string().optional(),
  dependsOnTaskIds: z.array(z.string().min(1)).optional(),
});

const taskDependencyAddSchema = z.object({
  taskId: z.string().min(1),
  dependsOnTaskId: z.string().min(1),
  reason: z.string().optional(),
});

const taskDependencyRemoveSchema = z.object({
  taskId: z.string().min(1),
  dependsOnTaskId: z.string().min(1),
});

export function createTaskTools(context: TaskToolContext = {}) {
  return {
    task_plan_get: tool({
      description: "读取当前任务的计划步骤、依赖关系和直接子任务。",
      inputSchema: taskPlanGetSchema,
      execute: async () => {
        const task = requireCurrentTask(context);
        if (!task) return missingTaskContext();
        return {
          success: true,
          task,
          plan: { steps: listTaskSteps(task.id, context.database) },
          dependencies: listDescendantDependencies(task.id, context.database),
          children: listChildTasks(task.id, context.database),
        };
      },
    }),
    task_plan_set: tool({
      description: "给当前任务写入或替换计划步骤。复杂任务开始前优先先写计划。",
      inputSchema: taskPlanSetSchema,
      execute: async (input: z.infer<typeof taskPlanSetSchema>) => {
        const task = requireCurrentTask(context);
        if (!task) return missingTaskContext();
        try {
          return { success: true, steps: setTaskPlan(task.id, input.steps, context.database) };
        } catch (error) {
          return failure(error);
        }
      },
    }),
    task_step_update: tool({
      description: "更新当前任务某个计划步骤的状态。",
      inputSchema: taskStepUpdateSchema,
      execute: async (input: z.infer<typeof taskStepUpdateSchema>) => {
        const task = requireCurrentTask(context);
        if (!task) return missingTaskContext();
        const step = getTaskStep(input.stepId, context.database);
        if (!step || step.task_id !== task.id) {
          return { success: false, error: "只能更新当前任务的步骤。" };
        }
        try {
          return {
            success: true,
            step: updateTaskStepStatus(step.id, input.status as TaskStepStatus, context.database),
          };
        } catch (error) {
          return failure(error);
        }
      },
    }),
    task_child_create: tool({
      description: "把当前任务的某个步骤委派给另一个 Agent，创建带计划步骤绑定的子任务。",
      inputSchema: taskChildCreateSchema,
      execute: async (input: z.infer<typeof taskChildCreateSchema>) => {
        const task = requireCurrentTask(context);
        if (!task) return missingTaskContext();
        const step = getTaskStep(input.stepId, context.database);
        if (!step || step.task_id !== task.id) {
          return { success: false, error: "只能为当前任务的步骤创建子任务。" };
        }
        if (step.child_task_id) {
          return { success: false, error: "该步骤已经关联子任务。" };
        }
        if (!validateChildDependencyScope(task.id, input.dependsOnTaskIds ?? [], context.database)) {
          return { success: false, error: "dependsOnTaskIds 只能引用当前任务的直接子任务。" };
        }
        try {
          const delegationService = await getDelegationService(context);
          const delegation = delegationService.delegateTask({
            parentAgentId: context.agentId ?? task.agent_id,
            parentTaskId: task.id,
            parentSessionId: context.sessionId,
            parentConversationId: context.conversationId ?? task.conversation_id,
            sourceChannel: context.sourceChannel ?? task.source_channel,
            sourceUserId: context.sourceUserId ?? task.source_user_id,
            sourceMetadata: context.sourceMetadata,
            targetAgentId: input.targetAgentId,
            instruction: input.instruction,
            reason: input.reason,
            planStepId: step.id,
            dependsOnTaskIds: input.dependsOnTaskIds ?? [],
          });
          return {
            success: true,
            delegationId: delegation.id,
            childTaskId: delegation.childTaskId,
            status: delegation.status,
          };
        } catch (error) {
          return failure(error);
        }
      },
    }),
    task_dependency_add: tool({
      description: "给当前任务的两个直接子任务添加依赖关系。",
      inputSchema: taskDependencyAddSchema,
      execute: async (input: z.infer<typeof taskDependencyAddSchema>) => {
        const task = requireCurrentTask(context);
        if (!task) return missingTaskContext();
        if (!validateDirectChildPair(task.id, input.taskId, input.dependsOnTaskId, context.database)) {
          return { success: false, error: "只能维护当前任务直接子任务之间的依赖。" };
        }
        try {
          return {
            success: true,
            dependency: addTaskDependency(input.taskId, input.dependsOnTaskId, input.reason ?? "", context.database),
          };
        } catch (error) {
          return failure(error);
        }
      },
    }),
    task_dependency_remove: tool({
      description: "移除当前任务两个直接子任务之间的依赖关系。",
      inputSchema: taskDependencyRemoveSchema,
      execute: async (input: z.infer<typeof taskDependencyRemoveSchema>) => {
        const task = requireCurrentTask(context);
        if (!task) return missingTaskContext();
        if (!validateDirectChildPair(task.id, input.taskId, input.dependsOnTaskId, context.database)) {
          return { success: false, error: "只能维护当前任务直接子任务之间的依赖。" };
        }
        try {
          return {
            success: true,
            removed: removeTaskDependency(input.taskId, input.dependsOnTaskId, context.database),
          };
        } catch (error) {
          return failure(error);
        }
      },
    }),
  };
}

function requireCurrentTask(context: TaskToolContext): TaskRecord | null {
  if (!context.taskId) return null;
  return getTask(context.taskId, context.database);
}

function missingTaskContext() {
  return { success: false, error: "当前运行上下文缺少 taskId。" };
}

function failure(error: unknown) {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function getDelegationService(context: TaskToolContext): Promise<TaskDelegationService> {
  if (context.delegationService) return context.delegationService;
  const { DelegationService } = await import("../delegations/service");
  return new DelegationService({ database: context.database });
}

function validateDirectChildPair(
  parentTaskId: string,
  taskId: string,
  dependsOnTaskId: string,
  database?: TaskToolContext["database"],
): boolean {
  const childIds = new Set(listChildTasks(parentTaskId, database).map((child) => child.id));
  return childIds.has(taskId) && childIds.has(dependsOnTaskId);
}

function validateChildDependencyScope(
  parentTaskId: string,
  dependsOnTaskIds: string[],
  database?: TaskToolContext["database"],
): boolean {
  const childIds = new Set(listChildTasks(parentTaskId, database).map((child) => child.id));
  return dependsOnTaskIds.every((taskId) => childIds.has(taskId));
}

function listDescendantDependencies(parentTaskId: string, database?: TaskToolContext["database"]) {
  return listChildTasks(parentTaskId, database)
    .flatMap((child) => listTaskDependencies(child.id, database));
}
