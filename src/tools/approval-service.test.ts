import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { AgentConfigService } from "../agents/config-service";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";
import { createTask } from "../tasks/task-store";
import { ApprovalService } from "./approval-service";
import "./service";

function createFixture() {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const configService = new AgentConfigService({
    rootDir: `/tmp/my-agent-approval-${crypto.randomUUID()}`,
  });
  const service = new ApprovalService(db, configService);
  return { db, configService, service };
}

describe("ApprovalService", () => {
  test("creates approvals idempotently by agent and toolCallId", () => {
    const { db, service } = createFixture();
    try {
      const first = service.createApproval({
        agentId: "default",
        toolCallId: "call_1",
        toolName: "write_file",
        args: { path: "README.md", mode: "overwrite" },
      });
      const second = service.createApproval({
        agentId: "default",
        toolCallId: "call_1",
        toolName: "write_file",
        args: { path: "README.md", mode: "overwrite" },
      });

      expect(second.id).toBe(first.id);
      expect(first).toMatchObject({
        status: "pending",
        riskLevel: "high",
        reason: "write_requires_configured_approval",
      });
      expect(service.listApprovals("default")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("approves and remembers write_file path in agent config", () => {
    const { db, service, configService } = createFixture();
    try {
      const approval = service.createApproval({
        agentId: "default",
        toolCallId: "call_2",
        toolName: "write_file",
        args: { path: "README.md", mode: "append" },
      });
      const approved = service.approveApproval(approval.id, { rememberChoice: true });
      const config = configService.getAgentConfig("default", { database: db });

      expect(approved.status).toBe("approved");
      expect(approved.rememberChoice).toBe(true);
      expect(config.tools.allowedPaths.some((path) => path.endsWith("README.md"))).toBe(true);
      expect(listAgentEvents("default", 20, db).map((event) => event.type)).toContain("tool.approval.approved");
      expect(listAgentEvents("default", 20, db).map((event) => event.type)).toContain("tool.policy.updated");
    } finally {
      db.close();
    }
  });

  test("denies pending approval", () => {
    const { db, service } = createFixture();
    try {
      const approval = service.createApproval({
        agentId: "default",
        toolCallId: "call_3",
        toolName: "skill_create",
        args: { name: "demo" },
      });
      const denied = service.denyApproval(approval.id);

      expect(denied.status).toBe("denied");
      expect(listAgentEvents("default", 20, db).map((event) => event.type)).toContain("tool.approval.denied");
    } finally {
      db.close();
    }
  });

  test("creates channel approval with resume payload and validates channel resolver", () => {
    const { db, service } = createFixture();
    try {
      const approval = service.createChannelApproval({
        agentId: "default",
        taskId: createTask({
          id: "task-1",
          agent_id: "default",
          conversation_id: "conversation-1",
          source_channel: "feishu",
          source_user_id: "ou_user",
          input: "写文件",
        }, db).id,
        channel: "feishu",
        conversationId: "conversation-1",
        externalConversationId: "cli_test:oc_chat",
        externalUserId: "ou_user",
        toolCallId: "approval_ai_1",
        toolName: "write_file",
        args: { path: "README.md", mode: "append" },
        resumePayload: {
          userText: "写文件",
          messages: [{ role: "assistant", content: [] }],
          deliverMetadata: { appId: "cli_test", chatId: "oc_chat" },
        },
      });

      expect(approval).toMatchObject({
        channel: "feishu",
        conversationId: "conversation-1",
        externalConversationId: "cli_test:oc_chat",
        externalUserId: "ou_user",
        status: "pending",
      });
      expect(service.getResumePayload(approval.id)).toMatchObject({
        userText: "写文件",
        deliverMetadata: { appId: "cli_test", chatId: "oc_chat" },
      });
      expect(() => service.resolveChannelApproval({
        approvalId: approval.id,
        channel: "feishu",
        externalConversationId: "wrong",
        externalUserId: "ou_user",
        decision: "approve",
      })).toThrow("审批会话不匹配");

      const resolved = service.resolveChannelApproval({
        approvalId: approval.id,
        channel: "feishu",
        externalConversationId: "cli_test:oc_chat",
        externalUserId: "ou_user",
        decision: "approve",
      });
      expect(resolved.status).toBe("approved");
    } finally {
      db.close();
    }
  });
});
