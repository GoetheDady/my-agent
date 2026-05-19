import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  getCurrentTask,
  getQueuedTasks,
  getRuntimeEventView,
  getTaskStatusDetail,
  getWatchdogNotice,
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
    parent_task_id: null,
    plan_step_id: null,
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
    parent_task_id: null,
    plan_step_id: null,
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

const timelineResponse = {
  task: tasks[0],
  episode: {
    id: "episode-1",
    task_id: "task-running",
    title: "当前任务",
    summary: "任务执行摘要",
    outcome: "完成",
    key_steps: ["任务开始执行", "调用工具：read_file"],
    problems: [],
  },
  current: {
    progressStatus: "using_tool",
    progressMessage: "正在执行工具：read_file",
    currentToolName: "read_file",
    currentToolCallId: "call-1",
    recentOutput: "读取完成",
    failureType: null,
    failureStage: null,
    retriable: null,
    leaseExpiresAt: null,
    lastProgressAt: 40,
  },
  plan: {
    steps: [
      {
        id: "step-1",
        task_id: "task-running",
        step_index: 0,
        title: "读取上下文",
        detail: "查看相关文件",
        status: "completed",
        child_task_id: "task-child",
        created_at: 1,
        updated_at: 2,
      },
    ],
  },
  dependencies: [
    {
      task_id: "task-running",
      depends_on_task_id: "task-blocker",
      reason: "等待前置任务",
      created_at: 1,
      depends_on_status: "completed",
      depends_on_input: "前置任务",
    },
  ],
  children: [
    {
      ...tasks[1],
      id: "task-child",
      parent_task_id: "task-running",
      plan_step_id: "step-1",
      source_channel: "delegation",
      input: "子任务",
    },
  ],
  timeline: [
    {
      id: "event-tool",
      eventId: "event-tool",
      kind: "tool",
      tone: "success",
      title: "工具结果",
      detail: "read_file",
      createdAt: 40,
      payloadJson: { toolName: "read_file", success: true },
    },
  ],
};

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
      pollingAgentId: "default",
      selectedTaskId: null,
      selectedTaskTimeline: null,
      dismissedWatchdogEventIds: [],
      taskTimelineLoading: false,
      taskTimelineError: null,
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

  test("fetches runtime snapshot for a selected agent", async () => {
    const researcherAgent = { ...agent, id: "researcher", name: "Researcher" };
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runtime/agents/researcher") return jsonResponse(researcherAgent);
      if (url === "/api/runtime/tasks?agentId=researcher") return jsonResponse({ tasks: [] });
      if (url === "/api/runtime/events?agentId=researcher&limit=50") return jsonResponse({ events: [] });
      return jsonResponse({ error: "unexpected url" }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await useRuntimeStore.getState().fetchRuntimeSnapshot("researcher");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useRuntimeStore.getState().agent?.id).toBe("researcher");
  });

  test("refreshes the selected agent after canceling a task", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/runtime/tasks/task-queued/cancel" && init?.method === "POST") {
        return jsonResponse({ task: { ...tasks[1], status: "canceled" } });
      }
      if (url === "/api/runtime/agents/researcher") return jsonResponse({ ...agent, id: "researcher" });
      if (url === "/api/runtime/tasks?agentId=researcher") return jsonResponse({ tasks: [] });
      if (url === "/api/runtime/events?agentId=researcher&limit=50") return jsonResponse({ events: [] });
      return jsonResponse({ error: "unexpected url" }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await useRuntimeStore.getState().cancelTask("task-queued", "researcher");

    expect(fetchMock).toHaveBeenCalledWith("/api/runtime/tasks/task-queued/cancel", { method: "POST" });
    expect(useRuntimeStore.getState().agent?.id).toBe("researcher");
  });

  test("fetches and stores task timeline details", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runtime/tasks/task-running/timeline") return jsonResponse(timelineResponse);
      return jsonResponse({ error: "unexpected url" }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await useRuntimeStore.getState().fetchTaskTimeline("task-running");

    expect(fetchMock).toHaveBeenCalledWith("/api/runtime/tasks/task-running/timeline");
    expect(useRuntimeStore.getState().selectedTaskTimeline?.task.id).toBe("task-running");
    expect(useRuntimeStore.getState().selectedTaskTimeline?.current.currentToolName).toBe("read_file");
    expect(useRuntimeStore.getState().selectedTaskTimeline?.plan.steps[0].title).toBe("读取上下文");
    expect(useRuntimeStore.getState().selectedTaskTimeline?.dependencies[0].depends_on_task_id).toBe("task-blocker");
    expect(useRuntimeStore.getState().selectedTaskTimeline?.children[0].id).toBe("task-child");
    expect(useRuntimeStore.getState().taskTimelineError).toBeNull();
  });

  test("selectTask records selected id and loads the task timeline", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runtime/tasks/task-running/timeline") return jsonResponse(timelineResponse);
      return jsonResponse({ error: "unexpected url" }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await useRuntimeStore.getState().selectTask("task-running");

    expect(useRuntimeStore.getState().selectedTaskId).toBe("task-running");
    expect(useRuntimeStore.getState().selectedTaskTimeline?.timeline[0]).toMatchObject({
      title: "工具结果",
      detail: "read_file",
    });
  });

  test("clearSelectedTask clears timeline state", () => {
    useRuntimeStore.setState({
      selectedTaskId: "task-running",
      selectedTaskTimeline: timelineResponse,
      taskTimelineLoading: false,
      taskTimelineError: "旧错误",
    });

    useRuntimeStore.getState().clearSelectedTask();

    expect(useRuntimeStore.getState().selectedTaskId).toBeNull();
    expect(useRuntimeStore.getState().selectedTaskTimeline).toBeNull();
    expect(useRuntimeStore.getState().taskTimelineError).toBeNull();
  });

  test("startPolling keeps a selected snapshot without creating an interval", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runtime/agents/default") return jsonResponse(agent);
      if (url === "/api/runtime/tasks?agentId=default") return jsonResponse({ tasks });
      if (url === "/api/runtime/events?agentId=default&limit=50") return jsonResponse({ events });
      return jsonResponse({ error: "unexpected url" }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    useRuntimeStore.getState().startPolling(10, "default");
    await Promise.resolve();
    await Promise.resolve();

    expect(useRuntimeStore.getState().polling).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
    expect(getRuntimeEventView({
      id: "event-episode",
      agent_id: "default",
      task_id: "task-running",
      conversation_id: "conversation-1",
      type: "episode.created",
      payload: JSON.stringify({ title: "总结记忆系统" }),
      payloadJson: { title: "总结记忆系统" },
      created_at: 40,
    })).toMatchObject({
      label: "经历记录创建",
      detail: "总结记忆系统",
      tone: "memory",
    });
    expect(getRuntimeEventView({
      id: "event-dream",
      agent_id: "default",
      task_id: null,
      conversation_id: null,
      type: "dream.completed",
      payload: JSON.stringify({ episodeCount: 3 }),
      payloadJson: { episodeCount: 3 },
      created_at: 50,
    })).toMatchObject({
      label: "梦整理完成",
      detail: "3",
      tone: "memory",
    });
    expect(getRuntimeEventView({
      id: "event-profile",
      agent_id: "default",
      task_id: null,
      conversation_id: null,
      type: "profile.sync.completed",
      payload: JSON.stringify({ reason: "新增身份记忆" }),
      payloadJson: { reason: "新增身份记忆" },
      created_at: 60,
    })).toMatchObject({
      label: "认知文件同步完成",
      detail: "新增身份记忆",
      tone: "memory",
    });
    expect(getRuntimeEventView({
      id: "event-skill",
      agent_id: "default",
      task_id: null,
      conversation_id: null,
      type: "skill.enabled",
      payload: JSON.stringify({ skillId: "web-debug" }),
      payloadJson: { skillId: "web-debug" },
      created_at: 70,
    })).toMatchObject({
      label: "Skill 启用",
      detail: "web-debug",
      tone: "memory",
    });
  });

  test("renders watchdog events for the control panel", () => {
    expect(getRuntimeEventView({
      id: "event-watchdog-canceled",
      agent_id: "default",
      task_id: "task-queued",
      conversation_id: "conversation-1",
      type: "task.watchdog.canceled",
      payload: JSON.stringify({ reason: "web_queued_stale" }),
      payloadJson: { reason: "web_queued_stale" },
      created_at: 80,
    })).toMatchObject({
      label: "Watchdog 取消任务",
      detail: "web_queued_stale",
      tone: "error",
    });
    expect(getRuntimeEventView({
      id: "event-agent-repaired",
      agent_id: "default",
      task_id: null,
      conversation_id: null,
      type: "agent.watchdog.repaired",
      payload: JSON.stringify({ reason: "agent_running_without_running_task" }),
      payloadJson: { reason: "agent_running_without_running_task" },
      created_at: 90,
    })).toMatchObject({
      label: "Watchdog 修复 Agent",
      detail: "agent_running_without_running_task",
      tone: "task",
    });
  });

  test("formats system-canceled task detail", () => {
    expect(getTaskStatusDetail({
      ...tasks[1],
      status: "canceled",
      failure_type: "system_canceled",
      failure_stage: "cancel",
      retriable: false,
      progress_status: "canceled",
      progress_message: "任务已取消",
    })).toBe("系统自动取消：任务已取消");
  });

  test("formats blocked task detail", () => {
    expect(getTaskStatusDetail({
      ...tasks[1],
      progress_status: "blocked",
      progress_message: "等待依赖任务完成",
    })).toBe("等待依赖任务完成");
  });

  test("renders task plan and dependency events for the control panel", () => {
    expect(getRuntimeEventView({
      id: "event-plan",
      agent_id: "default",
      task_id: "task-running",
      conversation_id: "conversation-1",
      type: "task.plan.updated",
      payload: JSON.stringify({ stepCount: 2 }),
      payloadJson: { stepCount: 2 },
      created_at: 1,
    })).toMatchObject({
      label: "任务计划更新",
      detail: "2",
      tone: "task",
    });
    expect(getRuntimeEventView({
      id: "event-dependency",
      agent_id: "default",
      task_id: "task-running",
      conversation_id: "conversation-1",
      type: "task.dependency.blocked",
      payload: JSON.stringify({ blockers: [{ taskId: "task-blocker" }] }),
      payloadJson: { blockers: [{ taskId: "task-blocker" }] },
      created_at: 1,
    })).toMatchObject({
      label: "等待依赖",
      detail: "task-blocker",
      tone: "task",
    });
  });

  test("summarizes elevated watchdog events for the control panel", () => {
    const notice = getWatchdogNotice([
      {
        id: "event-watchdog-batch",
        agent_id: "default",
        task_id: null,
        conversation_id: null,
        type: "task.watchdog.alerted",
        payload: JSON.stringify({ reason: "web_queued_stale_batch", count: 4, notificationLevel: "P1" }),
        payloadJson: { reason: "web_queued_stale_batch", count: 4, notificationLevel: "P1" },
        created_at: 100,
      },
      {
        id: "event-watchdog-detected",
        agent_id: "default",
        task_id: "task-queued",
        conversation_id: "conversation-1",
        type: "task.watchdog.detected",
        payload: JSON.stringify({ reason: "web_queued_stale", notificationLevel: "P2" }),
        payloadJson: { reason: "web_queued_stale", notificationLevel: "P2" },
        created_at: 90,
      },
    ]);

    expect(notice).toEqual({
      title: "Watchdog 状态提醒",
      detail: "系统清理了 4 个异常任务",
      tone: "warning",
      eventIds: ["event-watchdog-batch"],
      items: [],
    });
  });

  test("includes task details for elevated watchdog alerts", () => {
    const notice = getWatchdogNotice([
      {
        id: "event-approval-1",
        agent_id: "default",
        task_id: "task-approval-1",
        conversation_id: "conversation-1",
        type: "task.watchdog.alerted",
        payload: JSON.stringify({ reason: "approval_pending_timeout", notificationLevel: "P0" }),
        payloadJson: { reason: "approval_pending_timeout", notificationLevel: "P0" },
        created_at: 100,
      },
      {
        id: "event-approval-2",
        agent_id: "default",
        task_id: "task-approval-2",
        conversation_id: "conversation-2",
        type: "task.watchdog.alerted",
        payload: JSON.stringify({ reason: "failed_retriable", notificationLevel: "P1" }),
        payloadJson: { reason: "failed_retriable", notificationLevel: "P1" },
        created_at: 90,
      },
    ]);

    expect(notice).toEqual({
      title: "Watchdog 状态提醒",
      detail: "发现 2 个需要关注的任务",
      tone: "error",
      taskId: "task-approval-1",
      eventIds: ["event-approval-1", "event-approval-2"],
      items: [
        { eventId: "event-approval-1", taskId: "task-approval-1", reason: "approval_pending_timeout", detail: "工具审批超时" },
        { eventId: "event-approval-2", taskId: "task-approval-2", reason: "failed_retriable", detail: "任务失败但可重试" },
      ],
    });
  });

  test("filters dismissed watchdog alerts from the notice", () => {
    const notice = getWatchdogNotice([
      {
        id: "event-approval-1",
        agent_id: "default",
        task_id: "task-approval-1",
        conversation_id: "conversation-1",
        type: "task.watchdog.alerted",
        payload: JSON.stringify({ reason: "approval_pending_timeout", notificationLevel: "P0" }),
        payloadJson: { reason: "approval_pending_timeout", notificationLevel: "P0" },
        created_at: 100,
      },
      {
        id: "event-approval-2",
        agent_id: "default",
        task_id: "task-approval-2",
        conversation_id: "conversation-2",
        type: "task.watchdog.alerted",
        payload: JSON.stringify({ reason: "failed_retriable", notificationLevel: "P1" }),
        payloadJson: { reason: "failed_retriable", notificationLevel: "P1" },
        created_at: 90,
      },
    ], new Set(["event-approval-1"]));

    expect(notice).toMatchObject({
      detail: "发现 1 个需要关注的任务",
      tone: "warning",
      taskId: "task-approval-2",
      eventIds: ["event-approval-2"],
    });
  });
});
