import { describe, expect, test } from "bun:test";
import { getNormalizedToolPart } from "./toolPart";

describe("toolPart", () => {
  test("normalizes AI SDK v6 static tool parts", () => {
    const tool = getNormalizedToolPart({
      type: "tool-read_file",
      toolCallId: "call-1",
      state: "approval-requested",
      input: { path: "package.json" },
      approval: { id: "approval-1" },
    });

    expect(tool).toEqual({
      toolName: "read_file",
      args: { path: "package.json" },
      state: "approval-requested",
      toolCallId: "call-1",
      approvalId: "approval-1",
    });
  });

  test("normalizes legacy tool-invocation parts", () => {
    const tool = getNormalizedToolPart({
      type: "tool-invocation",
      toolInvocation: {
        toolName: "write_file",
        args: { path: "note.md", mode: "create" },
        state: "result",
        toolCallId: "call-2",
      },
    });

    expect(tool?.toolName).toBe("write_file");
    expect(tool?.args).toEqual({ path: "note.md", mode: "create" });
    expect(tool?.state).toBe("output-available");
    expect(tool?.toolCallId).toBe("call-2");
  });

  test("normalizes output and error states for display", () => {
    expect(getNormalizedToolPart({ type: "tool-read_file", state: "output-available" })?.state).toBe("output-available");
    expect(getNormalizedToolPart({ type: "tool-write_file", state: "output-error", errorText: "failed" })?.errorText).toBe("failed");
    expect(getNormalizedToolPart({ type: "tool-invocation", toolInvocation: { state: "result" } })?.state).toBe("output-available");
  });
});
