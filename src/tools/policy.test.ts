import { describe, expect, test } from "bun:test";
import { evaluateToolPolicy } from "./policy";
import "./service";

describe("tool policy", () => {
  test("read-only tools are allowed by default", () => {
    expect(evaluateToolPolicy({ toolName: "read_file" })).toEqual({
      allowed: true,
      requiresApproval: false,
      reason: "read_allowed",
    });
  });

  test("write tools follow agent approval config even when allowlisted", () => {
    expect(evaluateToolPolicy({ toolName: "write_file", operation: "write" })).toMatchObject({
      allowed: true,
      requiresApproval: true,
      reason: "write_requires_configured_approval",
    });

    expect(
      evaluateToolPolicy({ toolName: "write_file", operation: "write", allowlisted: true }),
    ).toMatchObject({
      allowed: true,
      requiresApproval: true,
      reason: "write_requires_configured_approval",
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
