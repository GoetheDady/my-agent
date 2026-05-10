// 人类式记忆工具层，也可以理解为 Memory Router（记忆路由器）。
// Router 的意思是：主 Agent 不需要知道底层是 LanceDB、episodes 还是 review item，
// 只需要按“我要回忆偏好/经历/计划/证据”表达意图，这里负责把请求分发到正确的记忆层。
export type MemoryRecallIntent =
  | "auto"
  | "semantic"
  | "episodic"
  | "procedural"
  | "prospective"
  | "reflective"
  | "social"
  | "evidence";

/**
 * 根据查询文本推断要回忆的记忆层。
 *
 * 这是轻量路由提示，不是最终事实判断；真正回答仍要基于工具返回的证据。
 *
 * @param query 用户或 Agent 提出的回忆问题。
 * @returns 推荐查询的记忆意图。
 */
export function inferRecallIntent(query: string): MemoryRecallIntent {
  if (/(刚才|上午|下午|昨天|上周|做了什么|发生了什么|之前)/.test(query)) return "episodic";
  if (/(后续|以后|计划|待办|提醒|要做什么)/.test(query)) return "prospective";
  if (/(怎么做|流程|步骤|注意什么|应该怎么)/.test(query)) return "procedural";
  if (/(坑|复盘|风险|教训|为什么错)/.test(query)) return "reflective";
  if (/(偏好|喜欢|习惯|风格|沟通)/.test(query)) return "social";
  return "semantic";
}
