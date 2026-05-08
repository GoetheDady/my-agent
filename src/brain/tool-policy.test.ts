import { describe, expect, test } from "bun:test";
import { evaluateToolPolicy } from "./tool-policy";
import "./tools";

describe("tool policy", () => {
  test("read-only tools are allowed by default", () => {
    expect(evaluateToolPolicy({ toolName: "read_file" })).toEqual({
      allowed: true,
      requiresApproval: false,
      reason: "read_allowed",
    });
  });

  test("write tools require approval unless allowlisted", () => {
    expect(evaluateToolPolicy({ toolName: "write_file", operation: "write" })).toMatchObject({
      allowed: true,
      requiresApproval: true,
      reason: "write_requires_approval",
    });

    expect(
      evaluateToolPolicy({ toolName: "write_file", operation: "write", allowlisted: true }),
    ).toMatchObject({
      allowed: true,
      requiresApproval: false,
      reason: "write_allowlisted",
    });
  });

  test("memory write tools create candidates by default", () => {
    expect(evaluateToolPolicy({ toolName: "memory_propose" })).toEqual({
      allowed: true,
      requiresApproval: false,
      reason: "memory_write_candidate",
      createsCandidateMemory: true,
    });
  });
});
