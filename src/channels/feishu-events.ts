import type { FeishuBinding, FeishuBindingService } from "./feishu-binding-service";

export interface FeishuInboundMessage {
  binding: FeishuBinding;
  appId: string;
  chatId: string;
  messageId: string;
  senderId: string;
  text: string;
  chatType: string;
  rawEventType: string;
  mentionsBot: boolean;
}

export interface FeishuCardAction {
  binding: FeishuBinding;
  appId: string;
  chatId: string;
  messageId: string;
  operatorId: string;
  approvalId: string;
  decision: "approve" | "deny";
  rememberChoice: boolean;
  rawEventType: string;
}

export type FeishuEventParseResult =
  | { kind: "challenge"; challenge: string }
  | { kind: "message"; message: FeishuInboundMessage }
  | { kind: "card_action"; action: FeishuCardAction }
  | { kind: "ignored"; reason: string; appId?: string };

function readPath(value: unknown, path: string[]): unknown {
  let cursor = value;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseContentText(content: string): string {
  if (!content.trim()) return "";
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return asString(parsed.text).replace(/<at user_id="[^"]+">[^<]*<\/at>/g, "").trim();
  } catch {
    return content.trim();
  }
}

function parseActionValue(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function resolveBinding(payload: unknown, bindingService: FeishuBindingService): FeishuBinding | null {
  const appId = asString(readPath(payload, ["header", "app_id"])) || asString(readPath(payload, ["app_id"]));
  if (appId) return bindingService.getEnabledBinding(appId);
  const token = asString(readPath(payload, ["header", "token"])) || asString(readPath(payload, ["token"]));
  return bindingService.findBindingForVerificationToken(token) ?? bindingService.getSingleEnabledBinding();
}

function validateToken(payload: unknown, binding: FeishuBinding): boolean {
  if (!binding.verificationToken) return true;
  const token = asString(readPath(payload, ["header", "token"])) || asString(readPath(payload, ["token"]));
  return token === binding.verificationToken;
}

/**
 * 解析飞书事件回调。
 *
 * MVP 支持未加密的 URL 验证、文本消息和交互卡片按钮回调。
 * 图片、文件等其它事件会被明确忽略，避免误把不完整内容交给 Agent。
 */
export function parseFeishuEvent(payload: unknown, bindingService: FeishuBindingService): FeishuEventParseResult {
  if (!payload || typeof payload !== "object") {
    return { kind: "ignored", reason: "invalid_payload" };
  }
  if (asString(readPath(payload, ["type"])) === "url_verification") {
    return { kind: "challenge", challenge: asString(readPath(payload, ["challenge"])) };
  }
  if (readPath(payload, ["encrypt"])) {
    return { kind: "ignored", reason: "encrypted_payload_not_supported" };
  }

  const binding = resolveBinding(payload, bindingService);
  const appId = asString(readPath(payload, ["header", "app_id"])) || asString(readPath(payload, ["app_id"])) || binding?.appId;
  if (!binding) return { kind: "ignored", reason: "binding_not_found", appId };
  if (!validateToken(payload, binding)) return { kind: "ignored", reason: "invalid_verification_token", appId };

  const eventType = asString(readPath(payload, ["header", "event_type"])) || asString(readPath(payload, ["event_type"]));
  if (eventType === "card.action.trigger") {
    const eventRoot = readPath(payload, ["event"]) ? ["event"] : [];
    const value = parseActionValue(readPath(payload, [...eventRoot, "action", "value"]));
    const decision = asString(value.decision);
    const approvalId = asString(value.approvalId);
    const chatId =
      asString(readPath(payload, [...eventRoot, "context", "open_chat_id"])) ||
      asString(readPath(payload, [...eventRoot, "open_chat_id"]));
    const messageId =
      asString(readPath(payload, [...eventRoot, "context", "open_message_id"])) ||
      asString(readPath(payload, [...eventRoot, "open_message_id"]));
    const operatorId =
      asString(readPath(payload, [...eventRoot, "operator", "open_id"])) ||
      asString(readPath(payload, [...eventRoot, "operator", "union_id"])) ||
      asString(readPath(payload, [...eventRoot, "operator", "user_id"]));

    if (!approvalId || (decision !== "approve" && decision !== "deny")) {
      return { kind: "ignored", reason: "invalid_card_action_value", appId };
    }
    if (!chatId || !messageId || !operatorId) {
      return { kind: "ignored", reason: "missing_card_action_context", appId };
    }

    return {
      kind: "card_action",
      action: {
        binding,
        appId: binding.appId,
        chatId,
        messageId,
        operatorId,
        approvalId,
        decision,
        rememberChoice: value.rememberChoice === true,
        rawEventType: eventType,
      },
    };
  }

  if (eventType !== "im.message.receive_v1") {
    return { kind: "ignored", reason: `unsupported_event:${eventType || "unknown"}`, appId };
  }

  const eventRoot = readPath(payload, ["event"]) ? ["event"] : [];
  const messageType = asString(readPath(payload, [...eventRoot, "message", "message_type"]));
  if (messageType !== "text") {
    return { kind: "ignored", reason: `unsupported_message_type:${messageType || "unknown"}`, appId };
  }

  const text = parseContentText(asString(readPath(payload, [...eventRoot, "message", "content"])));
  if (!text) return { kind: "ignored", reason: "empty_text", appId };

  const chatId = asString(readPath(payload, [...eventRoot, "message", "chat_id"]));
  const messageId = asString(readPath(payload, [...eventRoot, "message", "message_id"]));
  const senderId =
    asString(readPath(payload, [...eventRoot, "sender", "sender_id", "open_id"])) ||
    asString(readPath(payload, [...eventRoot, "sender", "sender_id", "union_id"])) ||
    asString(readPath(payload, [...eventRoot, "sender", "sender_id", "user_id"])) ||
    "default";
  if (!chatId || !messageId) return { kind: "ignored", reason: "missing_chat_or_message_id", appId };

  const mentions = readPath(payload, [...eventRoot, "message", "mentions"]);
  const mentionsBot = Array.isArray(mentions) && mentions.length > 0;

  return {
    kind: "message",
    message: {
      binding,
      appId: binding.appId,
      chatId,
      messageId,
      senderId,
      text,
      chatType: asString(readPath(payload, [...eventRoot, "message", "chat_type"])) || "unknown",
      rawEventType: eventType,
      mentionsBot,
    },
  };
}
