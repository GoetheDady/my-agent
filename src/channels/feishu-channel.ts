import { appendEvent } from "../events/event-log";
import type { ChannelAdapter, ChannelMessageOutput } from "./types";
import { defaultFeishuBindingService, type FeishuBinding, type FeishuBindingService } from "./feishu-binding-service";

interface TenantTokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

function getOpenBaseUrl(domain: "feishu" | "lark"): string {
  return domain === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
}

function getStringMetadata(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

/**
 * FeishuChannelAdapter 负责飞书出站消息。
 *
 * 入站事件由 routes/channels 解析后交给 ChannelService；这里专注把 Agent
 * 的最终文本回复发回飞书会话。MVP 使用飞书 HTTP OpenAPI，不依赖 lark-oapi SDK。
 */
export class FeishuChannelAdapter implements ChannelAdapter {
  readonly channel = "feishu";
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly bindingService: FeishuBindingService = defaultFeishuBindingService) {}

  async deliver(output: ChannelMessageOutput): Promise<void> {
    const appId = getStringMetadata(output.metadata, "appId");
    const chatId = getStringMetadata(output.metadata, "chatId") || output.conversationId;
    const replyToMessageId = getStringMetadata(output.metadata, "messageId");
    const binding = appId
      ? this.bindingService.getEnabledBinding(appId)
      : this.bindingService.getSingleEnabledBinding();
    if (!binding) {
      throw new Error(appId ? `Feishu binding not found: ${appId}` : "Feishu binding not found");
    }
    if (!chatId) {
      throw new Error("Feishu chatId 不能为空");
    }

    const token = await this.getTenantAccessToken(binding);
    const baseUrl = getOpenBaseUrl(binding.domain);
    const url = replyToMessageId
      ? `${baseUrl}/open-apis/im/v1/messages/${encodeURIComponent(replyToMessageId)}/reply`
      : `${baseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`;
    const body = replyToMessageId
      ? {
          msg_type: "text",
          content: JSON.stringify({ text: output.text }),
        }
      : {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: output.text }),
        };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as { code?: number; msg?: string };
    if (!response.ok || payload.code !== 0) {
      const message = payload.msg || `HTTP ${response.status}`;
      appendEvent({
        agent_id: binding.agentId,
        task_id: output.taskId,
        conversation_id: output.conversationId,
        type: "channel.delivery.failed",
        payload: { channel: "feishu", appId: binding.appId, chatId, error: message },
      });
      throw new Error(`Feishu delivery failed: ${message}`);
    }

    appendEvent({
      agent_id: binding.agentId,
      task_id: output.taskId,
      conversation_id: output.conversationId,
      type: "channel.delivery.completed",
      payload: { channel: "feishu", appId: binding.appId, chatId, replyToMessageId },
    });
  }

  private async getTenantAccessToken(binding: FeishuBinding): Promise<string> {
    const cached = this.tokenCache.get(binding.appId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const response = await fetch(`${getOpenBaseUrl(binding.domain)}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: binding.appId, app_secret: binding.appSecret }),
    });
    const payload = await response.json().catch(() => ({})) as TenantTokenResponse;
    if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
      throw new Error(`Feishu token failed: ${payload.msg || `HTTP ${response.status}`}`);
    }

    const expiresAt = Date.now() + Math.max((payload.expire ?? 7200) - 120, 60) * 1000;
    this.tokenCache.set(binding.appId, { token: payload.tenant_access_token, expiresAt });
    return payload.tenant_access_token;
  }
}
