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

/** 获取当前运行时（首次调用后缓存） */
export function getRuntime(): RuntimeKind {
  if (!_runtime) {
    _runtime = detectRuntime();
  }
  return _runtime;
}

/** 当前是否为 Bun 运行时 */
export const isBun = (): boolean => getRuntime() === "bun";

/** 当前是否为 Node 运行时 */
export const isNode = (): boolean => getRuntime() === "node";
