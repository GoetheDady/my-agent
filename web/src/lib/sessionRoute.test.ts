import { describe, expect, test } from "bun:test";
import { getSessionIdFromPath, getSessionPath } from "./sessionRoute";

describe("sessionRoute", () => {
  test("builds a session path", () => {
    expect(getSessionPath("abc-123")).toBe("/sessions/abc-123");
  });

  test("reads a session id from a path", () => {
    expect(getSessionIdFromPath("/sessions/abc-123")).toBe("abc-123");
  });

  test("ignores non-session paths", () => {
    expect(getSessionIdFromPath("/")).toBeNull();
    expect(getSessionIdFromPath("/api/sessions")).toBeNull();
  });
});
