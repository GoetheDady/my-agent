import type { Database } from "bun:sqlite";
import { defaultAgentService, type AgentService } from "../agents/service";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { defaultFeishuBindingService, type FeishuBinding, type FeishuBindingService } from "./feishu-binding-service";
import { defaultFeishuWebSocketService, type FeishuWebSocketService } from "./feishu-websocket-service";

type FeishuDomain = "feishu" | "lark";
type OnboardingStatus = "pending" | "succeeded" | "failed" | "expired" | "canceled";
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface RegistrationBeginResult {
  deviceCode: string;
  qrUrl: string;
  userCode: string;
  interval: number;
  expiresAt: number;
}

interface RegistrationCredentials {
  appId: string;
  appSecret: string;
  domain: FeishuDomain;
  openId?: string;
}

interface BotInfo {
  botName?: string;
  botOpenId?: string;
}

interface OnboardingRecord {
  id: string;
  agentId: string;
  domain: FeishuDomain;
  status: OnboardingStatus;
  deviceCode: string;
  qrUrl: string;
  userCode: string;
  interval: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  binding?: FeishuBinding;
}

export interface StartFeishuOnboardingInput {
  agentId?: string;
  domain?: FeishuDomain;
}

export interface PublicFeishuOnboardingStatus {
  onboardingId: string;
  agentId: string;
  domain: FeishuDomain;
  status: OnboardingStatus;
  qrUrl: string;
  userCode: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  binding?: ReturnType<FeishuBindingService["toPublicBinding"]>;
}

interface FeishuOnboardingOptions {
  database?: Database;
  bindingService?: FeishuBindingService;
  websocketService?: Pick<FeishuWebSocketService, "startBinding">;
  agentService?: AgentService;
  fetchImpl?: FetchLike;
  now?: () => number;
  idFactory?: () => string;
}

const ACCOUNTS_BASE_URLS: Record<FeishuDomain, string> = {
  feishu: "https://accounts.feishu.cn",
  lark: "https://accounts.larksuite.com",
};

const OPEN_BASE_URLS: Record<FeishuDomain, string> = {
  feishu: "https://open.feishu.cn",
  lark: "https://open.larksuite.com",
};

const REGISTRATION_PATH = "/oauth/v1/app/registration";
const REQUEST_TIMEOUT_MS = 10_000;

function normalizeDomain(value?: string): FeishuDomain {
  return value === "lark" ? "lark" : "feishu";
}

function normalizeAgentId(value?: string): string {
  return value?.trim() || "default";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asPositiveNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function createFormBody(body: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    params.set(key, value);
  }
  return params;
}

/**
 * FeishuOnboardingService 负责飞书“扫码创建机器人”的设备码流程。
 *
 * 这里的状态只放在进程内，适合 MVP：用户生成二维码、扫码、前端轮询，成功后
 * 立即写入目标 Agent 的 agent.json 并启动 WebSocket。重启服务后未完成的二维码
 * 会失效，用户重新生成即可。
 */
export class FeishuOnboardingService {
  private readonly records = new Map<string, OnboardingRecord>();

  constructor(private readonly options: FeishuOnboardingOptions = {}) {}

  async start(input: StartFeishuOnboardingInput = {}): Promise<PublicFeishuOnboardingStatus> {
    const agentId = normalizeAgentId(input.agentId);
    const domain = normalizeDomain(input.domain);
    if (!this.agentService.getAgent(agentId, { database: this.database })) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    await this.initRegistration(domain);
    const begin = await this.beginRegistration(domain);
    const now = this.now();
    const record: OnboardingRecord = {
      id: this.idFactory(),
      agentId,
      domain,
      status: "pending",
      deviceCode: begin.deviceCode,
      qrUrl: begin.qrUrl,
      userCode: begin.userCode,
      interval: begin.interval,
      expiresAt: begin.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);
    appendEvent({
      agent_id: agentId,
      type: "channel.feishu.onboarding.started",
      payload: { channel: "feishu", onboardingId: record.id, domain, expiresAt: record.expiresAt },
    }, this.database);
    return this.toPublicStatus(record);
  }

  async getStatus(onboardingId: string): Promise<PublicFeishuOnboardingStatus> {
    const record = this.getRecord(onboardingId);
    if (record.status !== "pending") return this.toPublicStatus(record);
    if (this.now() >= record.expiresAt) {
      this.markFailed(record, "expired", "二维码已过期");
      return this.toPublicStatus(record);
    }

    const credentials = await this.pollRegistration(record);
    if (!credentials) return this.toPublicStatus(record);

    const botInfo = await this.probeBot(credentials).catch(() => null);
    const binding = this.bindingService.upsertBinding({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      agentId: record.agentId,
      domain: credentials.domain,
      enabled: true,
      openId: credentials.openId,
      botName: botInfo?.botName,
      botOpenId: botInfo?.botOpenId,
    }, { agentId: record.agentId, database: this.database });
    record.status = "succeeded";
    record.binding = binding;
    record.updatedAt = this.now();
    appendEvent({
      agent_id: record.agentId,
      type: "channel.feishu.onboarding.completed",
      payload: {
        channel: "feishu",
        onboardingId: record.id,
        appId: binding.appId,
        domain: binding.domain,
        botName: binding.botName,
        hasAppSecret: true,
      },
    }, this.database);
    void this.websocketService.startBinding(binding).catch((error) => {
      appendEvent({
        agent_id: binding.agentId,
        type: "channel.delivery.failed",
        payload: {
          channel: "feishu",
          transport: "websocket",
          appId: binding.appId,
          error: error instanceof Error ? error.message : String(error),
        },
      }, this.database);
    });
    return this.toPublicStatus(record);
  }

  cancel(onboardingId: string): PublicFeishuOnboardingStatus {
    const record = this.getRecord(onboardingId);
    if (record.status === "pending") {
      record.status = "canceled";
      record.updatedAt = this.now();
      appendEvent({
        agent_id: record.agentId,
        type: "channel.feishu.onboarding.canceled",
        payload: { channel: "feishu", onboardingId: record.id, domain: record.domain },
      }, this.database);
    }
    return this.toPublicStatus(record);
  }

  private async initRegistration(domain: FeishuDomain): Promise<void> {
    const result = await this.postRegistration(domain, { action: "init" });
    const methods = Array.isArray(result.supported_auth_methods) ? result.supported_auth_methods : [];
    if (!methods.includes("client_secret")) {
      throw new Error(`飞书注册环境不支持 client_secret，当前支持：${methods.join(", ") || "未知"}`);
    }
  }

  private async beginRegistration(domain: FeishuDomain): Promise<RegistrationBeginResult> {
    const result = await this.postRegistration(domain, {
      action: "begin",
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id",
    });
    const deviceCode = asString(result.device_code);
    if (!deviceCode) throw new Error("飞书注册未返回 device_code");
    const rawQrUrl = asString(result.verification_uri_complete);
    if (!rawQrUrl) throw new Error("飞书注册未返回二维码链接");
    const separator = rawQrUrl.includes("?") ? "&" : "?";
    const qrUrl = `${rawQrUrl}${separator}from=my-agent&tp=my-agent`;
    const expireInSeconds = asPositiveNumber(result.expire_in, 600);
    return {
      deviceCode,
      qrUrl,
      userCode: asString(result.user_code),
      interval: asPositiveNumber(result.interval, 5),
      expiresAt: this.now() + expireInSeconds * 1000,
    };
  }

  private async pollRegistration(record: OnboardingRecord): Promise<RegistrationCredentials | null> {
    const result = await this.postRegistration(record.domain, {
      action: "poll",
      device_code: record.deviceCode,
      tp: "ob_app",
    }).catch((error) => {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      record.updatedAt = this.now();
      appendEvent({
        agent_id: record.agentId,
        type: "channel.feishu.onboarding.failed",
        payload: { channel: "feishu", onboardingId: record.id, error: record.error },
      }, this.database);
      return null;
    });
    if (!result) return null;

    const error = asString(result.error);
    if (error === "authorization_pending" || error === "slow_down") {
      record.updatedAt = this.now();
      return null;
    }
    if (error === "access_denied") {
      this.markFailed(record, "failed", "用户拒绝授权");
      return null;
    }
    if (error === "expired_token") {
      this.markFailed(record, "expired", "二维码已过期");
      return null;
    }

    const appId = asString(result.client_id);
    const appSecret = asString(result.client_secret);
    if (!appId || !appSecret) {
      record.updatedAt = this.now();
      return null;
    }
    const userInfo = asRecord(result.user_info);
    const tenantBrand = asString(userInfo.tenant_brand);
    return {
      appId,
      appSecret,
      domain: tenantBrand === "lark" ? "lark" : record.domain,
      openId: asString(userInfo.open_id) || undefined,
    };
  }

  private async probeBot(credentials: RegistrationCredentials): Promise<BotInfo | null> {
    const tokenResponse = await this.fetchJson(`${OPEN_BASE_URLS[credentials.domain]}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret }),
    });
    const token = asString(tokenResponse.tenant_access_token);
    if (!token) return null;
    const botResponse = await this.fetchJson(`${OPEN_BASE_URLS[credentials.domain]}/open-apis/bot/v3/info`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });
    if (Number(botResponse.code) !== 0) return null;
    const topLevelBot = asRecord(botResponse.bot);
    const nestedBot = asRecord(asRecord(botResponse.data).bot);
    const bot = Object.keys(topLevelBot).length > 0 ? topLevelBot : nestedBot;
    return {
      botName: asString(bot.app_name) || asString(bot.bot_name) || undefined,
      botOpenId: asString(bot.open_id) || undefined,
    };
  }

  private async postRegistration(domain: FeishuDomain, body: Record<string, string>): Promise<Record<string, unknown>> {
    return this.fetchJson(`${ACCOUNTS_BASE_URLS[domain]}${REGISTRATION_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: createFormBody(body),
    });
  }

  private async fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text();
      const parsed = text ? JSON.parse(text) as unknown : {};
      return asRecord(parsed);
    } finally {
      clearTimeout(timeout);
    }
  }

  private markFailed(record: OnboardingRecord, status: "failed" | "expired", error: string): void {
    record.status = status;
    record.error = error;
    record.updatedAt = this.now();
    appendEvent({
      agent_id: record.agentId,
      type: "channel.feishu.onboarding.failed",
      payload: { channel: "feishu", onboardingId: record.id, status, error },
    }, this.database);
  }

  private getRecord(onboardingId: string): OnboardingRecord {
    const record = this.records.get(onboardingId);
    if (!record) throw new Error(`Feishu onboarding not found: ${onboardingId}`);
    return record;
  }

  private toPublicStatus(record: OnboardingRecord): PublicFeishuOnboardingStatus {
    return {
      onboardingId: record.id,
      agentId: record.agentId,
      domain: record.domain,
      status: record.status,
      qrUrl: record.qrUrl,
      userCode: record.userCode,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      error: record.error,
      binding: record.binding ? this.bindingService.toPublicBinding(record.binding) : undefined,
    };
  }

  private get database(): Database {
    return this.options.database ?? getDb();
  }

  private get bindingService(): FeishuBindingService {
    return this.options.bindingService ?? defaultFeishuBindingService;
  }

  private get websocketService(): Pick<FeishuWebSocketService, "startBinding"> {
    return this.options.websocketService ?? defaultFeishuWebSocketService;
  }

  private get agentService(): AgentService {
    return this.options.agentService ?? defaultAgentService;
  }

  private get fetchImpl(): FetchLike {
    return this.options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private idFactory(): string {
    return this.options.idFactory?.() ?? crypto.randomUUID();
  }
}

export const defaultFeishuOnboardingService = new FeishuOnboardingService();
