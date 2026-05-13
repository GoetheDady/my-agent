import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentConfigService } from "../agents/config-service";
import { evaluateToolPolicy } from "./policy";
import "./service";

function withConfigService<T>(run: (service: AgentConfigService) => T): T {
  const rootDir = mkdtempSync(join(tmpdir(), "my-agent-tool-policy-"));
  try {
    const service = new AgentConfigService({ rootDir });
    return run(service);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
}

describe("tool policy", () => {
  test("read-only tools are allowed by default", () => {
    expect(evaluateToolPolicy({ toolName: "read_file" })).toEqual({
      allowed: true,
      requiresApproval: false,
      reason: "read_allowed",
    });
  });

  test("write tools require approval unless the concrete path is allowlisted", () => {
    expect(evaluateToolPolicy({ toolName: "write_file", operation: "write" })).toMatchObject({
      allowed: true,
      requiresApproval: true,
      reason: "write_requires_configured_approval",
    });

    expect(
      evaluateToolPolicy({ toolName: "write_file", operation: "write", allowlisted: true }),
    ).toEqual({
      allowed: true,
      requiresApproval: false,
      reason: "write_allowlisted",
    });
  });

  test("write tools can be allowed by removing them from requiresApproval", () => {
    withConfigService((service) => {
      service.patchAgentConfig("default", {
        tools: {
          removeRequiresApproval: ["skill_create"],
        },
      });

      expect(evaluateToolPolicy({
        toolName: "skill_create",
        operation: "write",
        agentConfigService: service,
      })).toEqual({
        allowed: true,
        requiresApproval: false,
        reason: "write_allowed_by_agent_policy",
      });
    });
  });

  test("memory write tools write active memories by default", () => {
    expect(evaluateToolPolicy({ toolName: "memory_remember" })).toEqual({
      allowed: true,
      requiresApproval: false,
      reason: "memory_write_allowed",
      createsCandidateMemory: false,
    });
  });
});
