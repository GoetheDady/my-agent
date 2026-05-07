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

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// 类型定义
// ============================================================

/** Provider 相关配置 */
export interface ProviderConfig {
  /** API 密钥 */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** API 基础 URL（可选，不填则用 @ai-sdk/deepseek 默认地址） */
  baseURL?: string;
}

/** Embedding 相关配置 */
export interface EmbeddingConfig {
  apiKey: string;
  model: string;
}

/** Tools 相关配置 */
export interface ToolsConfig {
  allowedPaths: string[];
}

/** 完整应用配置 */
export interface AppConfig {
  provider: ProviderConfig;
  embedding: EmbeddingConfig;
  tools: ToolsConfig;
}

// ============================================================
// 默认值
// ============================================================

const DEFAULT_MODEL = "deepseek-v4-flash";

// ============================================================
// 配置加载
// ============================================================

/**
 * 获取项目根目录
 *
 * Bun 和 Node 的 import.meta 行为不同，做兼容处理。
 * Bun 有 import.meta.dir，Node 需要用 fileURLToPath。
 */
export function getProjectRoot(): string {
  const meta = import.meta as unknown as { dir?: string };
  if (meta.dir) return resolve(meta.dir, "../..");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return resolve(__dirname, "../..");
}

/**
 * 加载配置
 *
 * 优先级：环境变量 > 配置文件 > 默认值
 */
export function loadConfig(): AppConfig {
  const root = getProjectRoot();
  const configPath = resolve(root, "config.json");

  let fileConfig: Partial<AppConfig> = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch (err) {
      console.warn(`配置文件读取失败: ${configPath}`, err);
    }
  }

  const resolveEnv = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    if (value.startsWith("$")) {
      return process.env[value.slice(1)] ?? undefined;
    }
    return value;
  };

  const apiKey =
    resolveEnv(process.env.DEEPSEEK_API_KEY) ??
    resolveEnv(fileConfig.provider?.apiKey) ??
    "";

  if (!apiKey) {
    throw new Error(
      "缺少 DEEPSEEK_API_KEY。请在环境变量中设置，或在 config.json 中配置"
    );
  }

  // Strip /anthropic suffix if present (migration from old Anthropic-format config)
  let baseURL = fileConfig.provider?.baseURL;
  if (baseURL?.endsWith("/anthropic")) {
    baseURL = baseURL.slice(0, -"/anthropic".length);
  }

  return {
    provider: {
      apiKey,
      model: fileConfig.provider?.model ?? DEFAULT_MODEL,
      baseURL,
    },
    embedding: {
      apiKey: process.env.ZHIPU_API_KEY ?? "",
      model: "embedding-3",
    },
    tools: {
      allowedPaths: fileConfig.tools?.allowedPaths ?? [getProjectRoot()],
    },
  };
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function saveConfig(config: AppConfig): void {
  const root = getProjectRoot();
  const configPath = resolve(root, "config.json");

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}
