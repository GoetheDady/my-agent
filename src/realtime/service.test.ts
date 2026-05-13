import { describe, expect, test } from "bun:test";
import { RealtimeService } from "./service";
import type { RealtimeSocketData } from "./types";

function createFakeSocket(data: RealtimeSocketData) {
  const sent: string[] = [];
  return {
    data,
    sent,
    send(message: string) {
      sent.push(message);
    },
  };
}

describe("RealtimeService", () => {
  test("broadcasts only to matching subscriptions", () => {
    const service = new RealtimeService();
    const defaultSocket = createFakeSocket(service.createSocketData());
    const researcherSocket = createFakeSocket(service.createSocketData());

    service.addSocket(defaultSocket as never);
    service.addSocket(researcherSocket as never);
    service.handleMessage(defaultSocket as never, JSON.stringify({ type: "subscribe", agentIds: ["default"] }));
    service.handleMessage(researcherSocket as never, JSON.stringify({ type: "subscribe", agentIds: ["researcher"] }));

    service.broadcast({
      type: "runtime.task.updated",
      agentId: "researcher",
      taskId: "task-1",
      payload: { ok: true },
    });

    expect(defaultSocket.sent.some((message) => message.includes("task-1"))).toBe(false);
    expect(researcherSocket.sent.some((message) => message.includes("task-1"))).toBe(true);
  });

  test("responds to ping", () => {
    const service = new RealtimeService();
    const socket = createFakeSocket(service.createSocketData());
    service.addSocket(socket as never);
    service.handleMessage(socket as never, JSON.stringify({ type: "ping" }));

    expect(socket.sent.some((message) => JSON.parse(message).type === "pong")).toBe(true);
  });
});
