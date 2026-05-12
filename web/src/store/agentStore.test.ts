import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { useAgentStore } from "./agentStore";
import type { AgentSummary } from "../types";

const originalFetch = globalThis.fetch;

const defaultAgent: AgentSummary = {
  id: "default",
  name: "Default Agent",
  status: "idle",
  current_task_id: null,
  workspace_path: "",
  created_at: 1,
  updated_at: 2,
  config: {
    name: "Default Agent",
    description: "默认 Agent",
    model: { provider: "deepseek", model: "deepseek-chat" },
    tools: { enabledToolsets: ["core"], requiresApproval: [], allowedPaths: [] },
    memory: { enabled: true, autoExtract: true, dreamEnabled: true },
    skills: { enabled: true, indexEnabled: true, enabledCount: 0, disabledCount: 0 },
  },
};

const researcherAgent: AgentSummary = {
  ...defaultAgent,
  id: "researcher",
  name: "Researcher",
  config: { ...defaultAgent.config, name: "Researcher" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("agentStore", () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: [],
      selectedAgentId: "default",
      loading: false,
      error: null,
    });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetches agents and preserves a valid selected agent", async () => {
    useAgentStore.setState({ selectedAgentId: "researcher" });
    globalThis.fetch = mock(async () => jsonResponse({ agents: [defaultAgent, researcherAgent] })) as unknown as typeof fetch;

    await useAgentStore.getState().fetchAgents();

    expect(useAgentStore.getState().agents.map((agent) => agent.id)).toEqual(["default", "researcher"]);
    expect(useAgentStore.getState().selectedAgentId).toBe("researcher");
  });

  test("creates an agent and selects it", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/agents" && init?.method === "POST") {
        return jsonResponse({ agent: researcherAgent, config: researcherAgent.config }, 201);
      }
      if (url === "/api/agents") {
        return jsonResponse({ agents: [defaultAgent, researcherAgent] });
      }
      return jsonResponse({ error: "unexpected url" }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const created = await useAgentStore.getState().createAgent({ agentId: "researcher", name: "Researcher" });

    expect(created.id).toBe("researcher");
    expect(useAgentStore.getState().selectedAgentId).toBe("researcher");
    expect(useAgentStore.getState().agents.map((agent) => agent.id)).toEqual(["default", "researcher"]);
  });
});
