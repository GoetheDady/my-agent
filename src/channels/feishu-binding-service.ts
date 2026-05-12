import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import {
  AgentConfigService,
  defaultAgentConfigService,
} from "../agents/config-service";
import type { AgentConfigContext } from "../agents/config-types";
import { getRuntimeDataDir } from "../core/config";

export interface FeishuBinding {
  appId: string;
  appSecret: string;
  agentId: string;
  domain: "feishu" | "lark";
  enabled: boolean;
  verificationToken?: string;
  encryptKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FeishuBindingInput {
  appId: string;
  appSecret: string;
  agentId?: string;
  domain?: "feishu" | "lark";
  enabled?: boolean;
  verificationToken?: string;
  encryptKey?: string;
}

interface LegacyFeishuBindingFile {
  bindings?: Array<Partial<FeishuBinding>>;
}

function normalizeDomain(value?: string): "feishu" | "lark" {
  return value === "lark" ? "lark" : "feishu";
}

function normalizeSecret(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAgentId(value?: string): string {
  const normalized = value?.trim();
  return normalized || "default";
}

/**
 * FeishuBindingService 是飞书绑定的渠道门面。
 *
 * 绑定的唯一事实来源已经收口到 `data/agents/<agentId>/agent.json`：
 * `channels.feishu.bindings` 保存该 Agent 拥有哪些飞书 App。这个类保留
 * list/get/upsert API，是为了让飞书事件解析、WebSocket 和路由不直接理解
 * agent.json 的内部结构。旧的 `data/channels/feishu-bindings.json` 只在首次
 * 读取时迁移，迁移成功后删除。
 */
export class FeishuBindingService {
  constructor(
    private readonly agentConfigService: AgentConfigService = defaultAgentConfigService,
    private readonly legacyFilePath = resolve(getRuntimeDataDir(), "channels/feishu-bindings.json"),
  ) {}

  getBindingFilePath(): string {
    return this.legacyFilePath;
  }

  listBindings(context: AgentConfigContext = {}): FeishuBinding[] {
    this.migrateLegacyBindings(context);
    return this.agentConfigService.listConfiguredAgentIds().flatMap((agentId) => {
      const config = this.agentConfigService.getAgentConfig(agentId, { ...context, agentId });
      return Object.values(config.channels.feishu.bindings).map((binding) => ({
        ...binding,
        agentId,
      }));
    });
  }

  listPublicBindings(): Array<Omit<FeishuBinding, "appSecret" | "verificationToken" | "encryptKey"> & {
    hasAppSecret: boolean;
    hasVerificationToken: boolean;
    hasEncryptKey: boolean;
  }> {
    return this.listBindings().map(({ appSecret, verificationToken, encryptKey, ...binding }) => ({
      ...binding,
      hasAppSecret: Boolean(appSecret),
      hasVerificationToken: Boolean(verificationToken),
      hasEncryptKey: Boolean(encryptKey),
    }));
  }

  getBinding(appId: string): FeishuBinding | null {
    const normalizedAppId = appId.trim();
    if (!normalizedAppId) return null;
    return this.listBindings().find((binding) => binding.appId === normalizedAppId) ?? null;
  }

  getEnabledBinding(appId: string): FeishuBinding | null {
    const binding = this.getBinding(appId);
    return binding?.enabled ? binding : null;
  }

  findBindingForVerificationToken(token?: string): FeishuBinding | null {
    const normalizedToken = token?.trim();
    if (!normalizedToken) return null;
    return this.listBindings().find((binding) => binding.enabled && binding.verificationToken === normalizedToken) ?? null;
  }

  getSingleEnabledBinding(): FeishuBinding | null {
    const enabled = this.listBindings().filter((binding) => binding.enabled);
    return enabled.length === 1 ? enabled[0] : null;
  }

  upsertBinding(input: FeishuBindingInput, context: AgentConfigContext = {}): FeishuBinding {
    const appId = input.appId.trim();
    const appSecret = input.appSecret.trim();
    if (!appId) throw new Error("Feishu appId 不能为空");
    if (!appSecret) throw new Error("Feishu appSecret 不能为空");

    this.migrateLegacyBindings(context);
    const agentId = normalizeAgentId(input.agentId);
    const existing = this.getBinding(appId);
    if (existing && existing.agentId !== agentId) {
      this.agentConfigService.patchAgentConfig(existing.agentId, {
        channels: {
          feishu: {
            removeBindingAppIds: [appId],
          },
        },
      }, { ...context, agentId: existing.agentId });
    }
    const updated = this.agentConfigService.patchAgentConfig(agentId, {
      channels: {
        feishu: {
          enabled: true,
          bindings: {
            [appId]: {
              appId,
              appSecret,
              domain: normalizeDomain(input.domain ?? existing?.domain),
              enabled: input.enabled ?? existing?.enabled ?? true,
              verificationToken: normalizeSecret(input.verificationToken) ?? existing?.verificationToken,
              encryptKey: normalizeSecret(input.encryptKey) ?? existing?.encryptKey,
              createdAt: existing?.createdAt,
            },
          },
        },
      },
    }, { ...context, agentId });
    const binding = updated.channels.feishu.bindings[appId];
    return { ...binding, agentId };
  }

  private migrateLegacyBindings(context: AgentConfigContext = {}): void {
    if (!existsSync(this.legacyFilePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.legacyFilePath, "utf-8")) as LegacyFeishuBindingFile;
      let migratedCount = 0;
      for (const rawBinding of parsed.bindings ?? []) {
        if (!rawBinding.appId || !rawBinding.appSecret) continue;
        const agentId = normalizeAgentId(rawBinding.agentId);
        this.agentConfigService.patchAgentConfig(agentId, {
          channels: {
            feishu: {
              enabled: true,
              bindings: {
                [rawBinding.appId]: {
                  appId: rawBinding.appId,
                  appSecret: rawBinding.appSecret,
                  domain: normalizeDomain(rawBinding.domain),
                  enabled: rawBinding.enabled ?? true,
                  verificationToken: normalizeSecret(rawBinding.verificationToken),
                  encryptKey: normalizeSecret(rawBinding.encryptKey),
                  createdAt: rawBinding.createdAt,
                  updatedAt: rawBinding.updatedAt,
                },
              },
            },
          },
        }, { ...context, agentId });
        migratedCount += 1;
      }
      if (migratedCount > 0) {
        unlinkSync(this.legacyFilePath);
      }
    } catch {
      // 旧文件只是迁移来源。解析失败时保留文件，避免误删用户密钥。
    }
  }
}

export const defaultFeishuBindingService = new FeishuBindingService();
