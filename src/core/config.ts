/**
 * 配置加载模块
 *
 * 职责：从配置文件中读取应用配置，合并环境变量，提供类型安全的配置访问。
 *
 * MVP 阶段只需要 provider 相关配置（API key、base URL、model 名），
 * 其他配置项按需逐步添加。
 *
 * 为什么不直接用 process.env？
 *   1. 配置需要做校验（API key 缺失时尽早报错，而非运行时才发现）
 *   2. 配置文件支持默认值和覆盖（JSON 配置 → 环境变量覆盖）
 *   3. 集中管理 key 名，避免字符串散落各处拼写错误
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// 类型定义
// ============================================================

/** Provider 相关配置 */
export interface ProviderConfig {
  /** API 密钥 */
  apiKey: string;
  /** API 基础 URL（可选，不填则用 DeepSeek 默认地址） */
  baseUrl?: string;
  /** 模型名称 */
  model: string;
}

/** 完整应用配置 */
export interface AppConfig {
  provider: ProviderConfig;
}

// ============================================================
// 默认值
// ============================================================

const DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic";
const DEFAULT_MODEL = "deepseek-chat";

// ============================================================
// 配置加载
// ============================================================

/**
 * 获取项目根目录
 *
 * Bun 和 Node 的 import.meta 行为不同，做兼容处理。
 * Bun 有 import.meta.dir，Node 需要用 fileURLToPath。
 */
function getProjectRoot(): string {
  // Bun 特有 API：import.meta.dir 直接返回当前文件所在目录
  // 当前文件：src/core/config.ts，需要向上两级到达项目根目录
  const meta = import.meta as unknown as { dir?: string };
  if (meta.dir) return resolve(meta.dir, "../..");

  // Node 兼容路径：通过 fileURLToPath 反推目录
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return resolve(__dirname, "../..");
}

/**
 * 加载配置
 *
 * 优先级：环境变量 > 配置文件 > 默认值
 *
 * 为什么不用 .env 文件自动加载？
 *   MVP 阶段保持简单。需要时再加一个 loadDotEnv() 步骤即可，接口不变。
 */
export function loadConfig(): AppConfig {
  const root = getProjectRoot();
  const configPath = resolve(root, "config.json");

  // 读取配置文件（可选——用户可能只用环境变量）
  let fileConfig: Partial<AppConfig> = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch (err) {
      // 配置文件读取失败时跳过，继续用环境变量兜底
      // 不抛异常：用户可能没有配置文件，只用环境变量运行
      console.warn(`配置文件读取失败: ${configPath}`, err);
    }
  }

  // 合并：环境变量覆盖配置文件
  // 使用 $ENV_VAR 语法：配置文件中可以写 "$DEEPSEEK_API_KEY" 来引用环境变量
  const resolveEnv = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    // 如果是 $VAR_NAME 格式，替换为环境变量值
    if (value.startsWith("$")) {
      return process.env[value.slice(1)] ?? undefined;
    }
    return value;
  };

  const apiKey =
    resolveEnv(process.env.DEEPSEEK_API_KEY) ??
    resolveEnv(fileConfig.provider?.apiKey) ??
    "";

  // API key 缺失时直接报错——没有 key 一切调用都会失败，不如启动时就报
  if (!apiKey) {
    throw new Error(
      "缺少 DEEPSEEK_API_KEY。请在环境变量中设置，或在 config.json 中配置"
    );
  }

  return {
    provider: {
      apiKey,
      baseUrl: fileConfig.provider?.baseUrl ?? DEFAULT_BASE_URL,
      model: fileConfig.provider?.model ?? DEFAULT_MODEL,
    },
  };
}

/**
 * 应用配置单例
 *
 * 为什么用单例？
 *   配置加载涉及文件 I/O 和环境变量读取，启动时加载一次即可。
 *   如果每次调用都重新读文件，在开发者频繁 reload 时会有不必要的 I/O 开销。
 *   副作用是热更新配置需要重启——MVP 阶段可接受。
 */
let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}
