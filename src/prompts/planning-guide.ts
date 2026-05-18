export interface PlanningGuideContext {
  hasParentTask: boolean;
  availableTools: string[];
  recentEpisodes?: string[];
}

export function shouldInjectPlanningGuide(input: {
  taskInput: string;
  hasParentTask: boolean;
  hasExistingPlan: boolean;
}): boolean {
  if (input.hasParentTask || input.hasExistingPlan) return false;
  return input.taskInput.trim().length > 200;
}

export function buildPlanningGuide(taskInput: string, context: PlanningGuideContext): string {
  const tools = context.availableTools.length > 0 ? context.availableTools.join(", ") : "task_plan_set, task_step_update, task_child_create";
  const recentEpisodes = context.recentEpisodes && context.recentEpisodes.length > 0
    ? context.recentEpisodes.map((episode) => `- ${episode}`).join("\n")
    : "- 暂无可直接复用的近期经历摘要。";

  return [
    "",
    "<planning-guide>",
    "这是一个可能需要结构化规划的复杂任务。开始执行前先判断是否需要写计划。",
    "",
    "应该先调用 task_plan_set 的情况：",
    "- 用户输入明显包含多个目标、多个步骤或多个文件/模块。",
    "- 需要先调查、再修改、再验证。",
    "- 需要多个工具组配合，或需要中间结果确认。",
    "- 任务可以拆成可检查的阶段，每个阶段有明确输出。",
    "",
    "写计划时：",
    "- 每一步写清楚预期输出。",
    "- 执行步骤时用 task_step_update 标记 running、completed、failed 或 skipped。",
    "- 如果某一步能由其他 Agent 独立完成，并且结果可合并，使用 task_child_create 创建绑定到 plan step 的子任务。",
    "",
    `可用规划相关工具：${tools}`,
    `当前任务输入长度：${taskInput.length}`,
    `是否父任务子任务：${context.hasParentTask ? "是" : "否"}`,
    "",
    "近期相关经历摘要：",
    recentEpisodes,
    "</planning-guide>",
  ].join("\n");
}
