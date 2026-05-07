import { describe, expect, test } from "bun:test";
import { createSessionResolver } from "./sessionResolver";

describe("createSessionResolver", () => {
  test("reuses the current session id", async () => {
    const resolver = createSessionResolver({
      getSessionId: () => "existing-session",
      setSessionId: () => {},
      setActiveSessionId: () => {},
      fetchSessions: async () => {},
      createSession: async () => {
        throw new Error("should not create a session");
      },
    });

    await expect(resolver.ensureSessionId()).resolves.toBe("existing-session");
  });

  test("shares one created session across concurrent calls", async () => {
    let sessionId: string | null = null;
    let createCount = 0;
    const resolver = createSessionResolver({
      getSessionId: () => sessionId,
      setSessionId: (id) => {
        sessionId = id;
      },
      setActiveSessionId: () => {},
      fetchSessions: async () => {},
      createSession: async () => {
        createCount++;
        await Promise.resolve();
        return { id: "created-session" };
      },
    });

    await expect(
      Promise.all([resolver.ensureSessionId(), resolver.ensureSessionId()]),
    ).resolves.toEqual(["created-session", "created-session"]);
    expect(createCount).toBe(1);
    expect(sessionId as string | null).toBe("created-session");
  });
});
