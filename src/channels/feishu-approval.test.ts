import { describe, expect, test } from "bun:test";
import {
  buildFeishuApprovalCard,
  buildFeishuApprovalFallbackText,
  buildFeishuApprovalResolvedCard,
  parseFeishuApprovalCommand,
} from "./feishu-approval";

describe("Feishu approval helpers", () => {
  test("parses text approval commands", () => {
    expect(parseFeishuApprovalCommand("批准 123e4567-e89b-12d3-a456-426614174000")).toMatchObject({
      decision: "approve",
      rememberChoice: false,
    });
    expect(parseFeishuApprovalCommand("批准并记住 123e4567-e89b-12d3-a456-426614174000")).toMatchObject({
      decision: "approve",
      rememberChoice: true,
    });
    expect(parseFeishuApprovalCommand("拒绝 123e4567-e89b-12d3-a456-426614174000")).toMatchObject({
      decision: "deny",
    });
    expect(parseFeishuApprovalCommand("普通消息")).toBeNull();
  });

  test("builds interactive approval card without secrets", () => {
    const card = buildFeishuApprovalCard({
      approvalId: "approval-1",
      toolName: "write_file",
      args: { path: "README.md", mode: "append", appSecret: "secret" },
      riskLevel: "medium",
      reason: "write_requires_configured_approval",
    });
    const serialized = JSON.stringify(card);

    expect(serialized).toContain("批准并记住此路径");
    expect(serialized).toContain("approval-1");
    expect(serialized).not.toContain("appSecret");
    expect(serialized).not.toContain("secret");
  });

  test("fallback text contains approval commands", () => {
    const text = buildFeishuApprovalFallbackText({
      approvalId: "approval-1",
      toolName: "write_file",
      args: { path: "README.md", mode: "append" },
      riskLevel: "medium",
      reason: "write_requires_configured_approval",
    });

    expect(text).toContain("批准：批准 approval-1");
    expect(text).toContain("拒绝：拒绝 approval-1");
    expect(text).toContain("批准并记住");
  });

  test("builds resolved card without action buttons", () => {
    const card = buildFeishuApprovalResolvedCard({
      toolName: "write_file",
      riskLevel: "medium",
      status: "approved",
    });
    const serialized = JSON.stringify(card);

    expect(serialized).toContain("已批准");
    expect(serialized).toContain("write_file");
    expect(serialized).not.toContain("批准并记住");
    expect(serialized).not.toContain("\"tag\":\"button\"");
  });
});
