import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  getCurrentTask,
  getQueuedTasks,
  getRuntimeEventView,
  useRuntimeStore,
  type RuntimeAgent,
  type RuntimeEvent,
  type RuntimeTask,
} from "./runtimeStore";

const originalFetch = globalThis.fetch;

const agent: RuntimeAgent = {
  id: "default",
  name: "Default Agent",
  status: "running",
  current_task_id: "task-running",
  workspace_path: "/tmp/project",
  created_at: 1,
  updated_at: 2,
};

const tasks: RuntimeTask[] = [
  {
    id: "task-running",
    agent_id: "default",
    conversation_id: "conversation-1",
    source_channel: "web",
    source_user_id: "default",
    status: "running",
    priority: 0,
    input: "当前任务",
    result: null,
    error: null,
    created_at: 10,
    started_at: 11,
    completed_at: null,
  },
  {
    id: "task-queued",
    agent_id: "default",
    conversation_id: "conversation-1",
    source_channel: "web",
    source_user_id: "default",
    status: "queued",
    priority: 0,
    input: "排队任务",
    result: null,
    error: null,
    created_at: 12,
    started_at: null,
    completed_at: null,
  },
];

const events: RuntimeEvent[] = [
  {
    id: "event-memory",
    agent_id: "default",
    task_id: "task-running",
    conversation_id: "conversation-1",
    type: "memory.search",
    payload: JSON.stringify({ query: "项目目标", resultIds: ["mem-1"] }),
    created_at: 30,
  },
  {
    id: "event-tool",
    agent_id: "default",
    task_id: "task-running",
    conversation_id: "conversation-1",
    type: "tool.call",
    payload: JSON.stringify({ toolName: "read_file", args: { path: "eslint.config.js" } }),
    created_at: 20,
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("runtimeStore", () => {
  beforeEach(() => {
    useRuntimeStore.getState().stopPolling();
    useRuntimeStore.setState({
      agent: null,
      tasks: [],
      events: [],
      loading: false,
      error: null,
      polling: false,
    });
  });

  afterAll(() => {
    useRuntimeStore.getState().stopPolling();
    globalThis.fetch = originalFetch;
  });

  test("fetches the default agent, task queue, and recent events", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runtime/agents/default") return jsonResponse(agent);
      if (url === "/api/runtime/tasks?agentId=default") return jsonResponse({ tasks });
      if (url === "/api/runtime/events?agentId=default&limit=50") return jsonResponse({ events });
      return jsonResponse({ error: "unexpected url" }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await useRuntimeStore.getState().fetchRuntimeSnapshot();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useRuntimeStore.getState().agent?.status).toBe("running");
    expect(useRuntimeStore.getState().tasks).toHaveLength(2);
    expect(useRuntimeStore.getState().events[0].payloadJson).toEqual({
      query: "项目目标",
      resultIds: ["mem-1"],
    });
    expect(useRuntimeStore.getState().error).toBeNull();
  });

  test("derives the current task and queued tasks", () => {
    expect(getCurrentTask(agent, tasks)?.id).toBe("task-running");
    expect(getQueuedTasks(tasks).map((task) => task.id)).toEqual(["task-queued"]);
  });

  test("renders persisted tool and memory events for the control panel", () => {
    expect(getRuntimeEventView({ ...events[0], payloadJson: JSON.parse(events[0].payload) })).toMatchObject({
      label: "记忆检索",
      detail: "项目目标",
      tone: "memory",
    });
    expect(getRuntimeEventView({ ...events[1], payloadJson: JSON.parse(events[1].payload) })).toMatchObject({
      label: "工具调用",
      detail: "read_file",
      tone: "tool",
    });
  });
});
