/**
 * 运行时环境检测与适配
 *
 * 项目优先适配 Bun，但需兼容 Node.js。此模块在启动时一次性检测当前运行时，
 * 导出统一的运行时标识，供其他 compat 模块使用。
 *
 * 为什么不用 process.versions.bun 直接判断？
 *   - 未来 Bun 可能在 Node 兼容模式下运行时，该值仍存在但不可靠
 *   - 检测全局对象 typeof Bun 是最稳定的判断方式
 */

import { ensureDefaultAgent } from "../agents/agent-registry";
import { getDb } from "./database";

/** 当前运行环境类型 */
export type RuntimeKind = "bun" | "node";

let _runtime: RuntimeKind;

/**
 * 检测当前运行时环境
 *
 * 只在首次调用时执行检测，结果缓存为模块级常量。
 * 不要在每个 compat 模块里重复检测——统一入口减少不一致。
 */
function detectRuntime(): RuntimeKind {
  // 检查全局 Bun 对象——TypeScript 不认这个全局类型，用 unknown 收窄
  const g = globalThis as unknown as { Bun?: { version?: string } };
  const bun = g.Bun;

  if (bun !== undefined) {
    try {
      const version = bun.version;
      if (typeof version === "string" && version.length > 0) {
        return "bun";
      }
    } catch {
      // Bun 对象存在但版本读取失败，降级为 node
    }
  }

  return "node";
}

/**
 * 获取当前运行时类型。
 *
 * @returns `bun` 或 `node`，首次调用后会缓存检测结果。
 */
export function getRuntime(): RuntimeKind {
  if (!_runtime) {
    _runtime = detectRuntime();
  }
  return _runtime;
}

/**
 * 判断当前是否运行在 Bun。
 *
 * @returns 是 Bun 时返回 `true`。
 */
export const isBun = (): boolean => getRuntime() === "bun";

/**
 * 判断当前是否运行在 Node.js。
 *
 * @returns 是 Node.js 时返回 `true`。
 */
export const isNode = (): boolean => getRuntime() === "node";

/**
 * 初始化 Agent runtime 所需的持久状态。
 *
 * 当前会确保 default Agent 存在；未来多 Agent 初始化也应集中放在这里。
 */
export function initializeRuntime(): void {
  // 目前 MVP 只有 default agent；未来多 Agent 也应从这里集中初始化。
  const db = getDb();
  ensureDefaultAgent(db);
}
