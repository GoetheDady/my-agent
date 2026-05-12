import { describe, expect, test } from "bun:test";
import { AgentConfigService } from "../agents/config-service";
import { FeishuBindingService } from "./feishu-binding-service";
import { parseFeishuEvent } from "./feishu-events";

function createBindingService(): FeishuBindingService {
  const configService = new AgentConfigService({ rootDir: `/tmp/my-agent-feishu-bindings-${crypto.randomUUID()}` });
  const service = new FeishuBindingService(configService);
  service.upsertBinding({
    appId: "cli_test",
    appSecret: "secret",
    agentId: "researcher",
    verificationToken: "token",
  });
  return service;
}

describe("Feishu event parser", () => {
  test("handles url verification challenge", () => {
    const parsed = parseFeishuEvent({ type: "url_verification", challenge: "abc" }, createBindingService());
    expect(parsed).toEqual({ kind: "challenge", challenge: "abc" });
  });

  test("parses text message and strips mention markup", () => {
    const parsed = parseFeishuEvent({
      header: {
        app_id: "cli_test",
        token: "token",
        event_type: "im.message.receive_v1",
      },
      event: {
        sender: { sender_id: { open_id: "ou_user" } },
        message: {
          message_id: "om_msg",
          chat_id: "oc_chat",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: '<at user_id="ou_bot">Bot</at> hello' }),
        },
      },
    }, createBindingService());

    expect(parsed).toMatchObject({
      kind: "message",
      message: {
        appId: "cli_test",
        chatId: "oc_chat",
        messageId: "om_msg",
        senderId: "ou_user",
        text: "hello",
      },
    });
  });

  test("rejects invalid verification token", () => {
    const parsed = parseFeishuEvent({
      header: {
        app_id: "cli_test",
        token: "wrong",
        event_type: "im.message.receive_v1",
      },
    }, createBindingService());

    expect(parsed).toEqual({
      kind: "ignored",
      reason: "invalid_verification_token",
      appId: "cli_test",
    });
  });

  test("parses websocket event shape without webhook header wrapper", () => {
    const parsed = parseFeishuEvent({
      app_id: "cli_test",
      event_type: "im.message.receive_v1",
      token: "token",
      sender: { sender_id: { union_id: "on_user" } },
      message: {
        message_id: "om_ws",
        chat_id: "oc_ws",
        chat_type: "group",
        message_type: "text",
        content: JSON.stringify({ text: "ws hello" }),
      },
    }, createBindingService());

    expect(parsed).toMatchObject({
      kind: "message",
      message: {
        appId: "cli_test",
        chatId: "oc_ws",
        messageId: "om_ws",
        senderId: "on_user",
        text: "ws hello",
      },
    });
  });
});
