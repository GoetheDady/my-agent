# Frontend Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor frontend from single-sidebar navigation to two-layout architecture (ChatLayout + ConsoleLayout) with agent-grouped session sidebar.

**Architecture:** Two React Router layouts replace the single AppShell. ChatLayout serves `/` and `/sessions/:sessionId` with a minimal header and agent-session tree sidebar. ConsoleLayout serves `/console/*` routes with sub-navigation sidebar and dashboard. Existing stores need no changes; page components mostly unchanged except ChatPage.

**Tech Stack:** React 19, TypeScript 6, Vite 6, Tailwind CSS 4, Zustand 5, react-router v7, lucide-react

---

## File Structure

```
Create:
  web/src/layouts/ChatLayout.tsx          — chat layout (header + agent sidebar + outlet)
  web/src/layouts/ConsoleLayout.tsx       — console layout (back header + sub-nav + outlet)
  web/src/features/sessions/AgentSessionSidebar.tsx — agent-grouped session tree
  web/src/pages/ConsoleDashboard.tsx      — console landing (runtime overview)

Modify:
  web/src/App.tsx                         — new route tree
  web/src/lib/sessionRoute.ts             — add CONSOLE_PATH constant
  web/src/pages/ChatPage.tsx              — strip header/sidebar UI, keep chat core

Remove (or keep for reference):
  web/src/layouts/AppShell.tsx            — replaced by ChatLayout + ConsoleLayout
  web/src/features/sessions/SessionSidebar.tsx — replaced by AgentSessionSidebar
```

---

### Task 1: Add console path constants

**Files:**
- Modify: `web/src/lib/sessionRoute.ts`

- [ ] **Step 1: Add CONSOLE_PATH and helper**

```typescript
const SESSION_PREFIX = "/sessions/";
export const CONSOLE_PATH = "/console";
export const ARCHITECTURE_PATH = "/architecture";
export const MEMORY_PATH = "/memory";
// ... existing exports unchanged ...

export function getConsolePath(subPath: string): string {
  return `${CONSOLE_PATH}${subPath}`;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/sessionRoute.ts
git commit -m "feat: add CONSOLE_PATH and getConsolePath helper"
```

---

### Task 2: Create AgentSessionSidebar

**Files:**
- Create: `web/src/features/sessions/AgentSessionSidebar.tsx`

The sidebar shows agents grouped with their sessions, status indicators, and a "+ new conversation" action.

- [ ] **Step 1: Style the top "new conversation" area with agent picker**

```tsx
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  Bot,
  CheckCircle2,
  Clock3,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import { useAgentStore } from "../../store/agentStore";
import { useSessionStore } from "../../store/sessionStore";
import { getSessionPath } from "../../lib/sessionRoute";
import type { AgentSummary, Session } from "../../types";

export default function AgentSessionSidebar() {
  const navigate = useNavigate();
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  useEffect(() => {
    fetchAgents();
    fetchSessions();
  }, [fetchAgents, fetchSessions]);

  const sessionsByAgent = useMemo(() => {
    const map: Record<string, Session[]> = {};
    for (const s of sessions) {
      (map[s.agent_id] ??= []).push(s);
    }
    for (const [, list] of Object.entries(map)) {
      list.sort((a, b) => b.updated_at - a.updated_at);
    }
    return map;
  }, [sessions]);

  async function handleNewSession(agentId: string) {
    const session = await useSessionStore.getState().createSession(agentId);
    navigate(getSessionPath(session.id));
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteSession(id);
    if (id === activeSessionId) navigate("/");
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }

  const idleAgents = agents.filter((a) => a.status === "idle");
  const busyAgents = agents.filter((a) => a.status === "running");
  const offlineAgents = agents.filter((a) => a.status !== "idle" && a.status !== "running");

  function renderAgentGroup(agent: AgentSummary) {
    const agentSessions = sessionsByAgent[agent.id] ?? [];
    const isBusy = agent.status === "running";
    return (
      <div key={agent.id} className="mb-4">
        <div className="group flex items-center gap-2 px-3 py-1.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              isBusy ? "bg-amber-400" : agent.status === "idle" ? "bg-emerald-400" : "bg-gray-300"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-[var(--color-text)]">
              {agent.config?.name || agent.name}
            </div>
            <div className="truncate text-[11px] text-[var(--color-text-soft)] font-mono">
              {agent.id}
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            isBusy
              ? "bg-amber-50 text-amber-700"
              : agent.status === "idle"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-gray-100 text-gray-500"
          }`}>
            {isBusy ? "忙碌" : agent.status === "idle" ? "空闲" : "离线"}
          </span>
          <button
            onClick={() => handleNewSession(agent.id)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-soft)] opacity-0 transition-opacity hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] group-hover:opacity-100"
            title={`新建 ${agent.config?.name || agent.name} 对话`}
          >
            <Plus size={14} />
          </button>
        </div>
        {agentSessions.length > 0 && (
          <div className="ml-5 mt-0.5 space-y-0.5 border-l border-[var(--color-border-soft)] pl-3">
            {agentSessions.slice(0, 20).map((s) => (
              <div
                key={s.id}
                onClick={() => navigate(getSessionPath(s.id))}
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                  s.id === activeSessionId
                    ? "bg-white text-[var(--color-text)] shadow-sm ring-1 ring-[var(--color-border-soft)]"
                    : "text-[var(--color-text-muted)] hover:bg-white/70 hover:text-[var(--color-text)]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                <span className="ml-1.5 shrink-0 text-[10px] text-[var(--color-text-soft)]">
                  {formatTime(s.updated_at)}
                </span>
                <button
                  onClick={(e) => handleDelete(e, s.id)}
                  className="ml-1 hidden shrink-0 rounded p-0.5 text-[var(--color-text-soft)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] group-hover:block"
                  title="删除"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-[#f3f5f8]">
      <div className="border-b border-[var(--color-border-soft)] px-4 py-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white">
            <MessageSquare size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">My Agent</div>
            <div className="text-[11px] text-[var(--color-text-soft)]">
              {agents.length} 个 Agent · {sessions.length} 个会话
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => handleNewSession(selectedAgentId)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-accent-strong)]"
          >
            <Plus size={15} />
            新建对话
          </button>
          <div className="relative flex-1">
            <select
              value={selectedAgentId}
              onChange={(e) => {
                useAgentStore.getState().setSelectedAgentId(e.target.value);
              }}
              className="h-full w-full appearance-none rounded-lg border border-[var(--color-border)] bg-white px-2.5 text-[12px] font-medium text-[var(--color-text)] outline-none cursor-pointer"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.config?.name || a.name}</option>
              ))}
              {agents.length === 0 && <option value="default">default</option>}
            </select>
            <Bot size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-soft)]" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-3 pb-3">
        {agents.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-[var(--color-text-soft)]">
            暂无 Agent
          </div>
        )}
        {busyAgents.map(renderAgentGroup)}
        {idleAgents.map(renderAgentGroup)}
        {offlineAgents.map(renderAgentGroup)}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/features/sessions/AgentSessionSidebar.tsx
git commit -m "feat: create AgentSessionSidebar with agent-grouped session tree"
```

---

### Task 3: Create ChatLayout

**Files:**
- Create: `web/src/layouts/ChatLayout.tsx`

- [ ] **Step 1: Create ChatLayout**

```tsx
import { Outlet, useNavigate } from "react-router";
import { Settings } from "lucide-react";
import { useEffect } from "react";
import AgentSessionSidebar from "../features/sessions/AgentSessionSidebar";
import { CONSOLE_PATH } from "../lib/sessionRoute";
import { useRealtimeStore, buildCurrentRealtimeSubscription } from "../store/realtimeStore";
import { useAgentStore } from "../store/agentStore";
import { useChatStore } from "../store/chatStore";

export default function ChatLayout() {
  const navigate = useNavigate();
  const realtimeStatus = useRealtimeStore((s) => s.status);
  const connectRealtime = useRealtimeStore((s) => s.connect);
  const subscribeRealtime = useRealtimeStore((s) => s.subscribe);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const sessionId = useChatStore((s) => s.sessionId);

  useEffect(() => {
    connectRealtime();
  }, [connectRealtime]);

  useEffect(() => {
    subscribeRealtime(buildCurrentRealtimeSubscription());
  }, [selectedAgentId, sessionId, subscribeRealtime]);

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <AgentSessionSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[52px] items-center justify-end gap-3 border-b border-[var(--color-border-soft)] bg-white/95 px-6 backdrop-blur">
          <div
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              realtimeStatus === "connected"
                ? "bg-emerald-50 text-emerald-700"
                : realtimeStatus === "connecting"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-red-50 text-red-600"
            }`}
          >
            {realtimeStatus === "connected" ? "实时已连接" : realtimeStatus === "connecting" ? "实时连接中" : "实时离线"}
          </div>
          <button
            onClick={() => navigate(CONSOLE_PATH)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--color-text-muted)] shadow-sm transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            title="控制台"
          >
            <Settings size={15} />
            控制台
          </button>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/layouts/ChatLayout.tsx
git commit -m "feat: create ChatLayout with agent sidebar and console entry"
```

---

### Task 4: Create ConsoleLayout

**Files:**
- Create: `web/src/layouts/ConsoleLayout.tsx`

- [ ] **Step 1: Create ConsoleLayout**

```tsx
import { NavLink, Outlet } from "react-router";
import {
  Activity,
  ArrowLeft,
  Bot,
  Brain,
  Cable,
  ClipboardList,
  MessageSquare,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAgentStore } from "../store/agentStore";

interface ConsoleNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

const subNav: ConsoleNavItem[] = [
  { label: "总览", path: "/console", icon: Activity },
  { label: "Agents", path: "/console/agents", icon: Bot },
  { label: "Tasks", path: "/console/tasks", icon: ClipboardList },
  { label: "Tools", path: "/console/tools", icon: Wrench },
  { label: "Skills", path: "/console/skills", icon: Brain },
  { label: "Memory", path: "/console/memory", icon: Brain },
  { label: "Events", path: "/console/events", icon: Sparkles },
  { label: "渠道", path: "/console/channels", icon: Cable },
  { label: "设置", path: "/console/settings", icon: Settings },
];

export default function ConsoleLayout() {
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-white">
        <NavLink
          to="/"
          className="flex items-center gap-2 border-b border-[var(--color-border-soft)] px-5 py-4 text-[13px] font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          <ArrowLeft size={16} />
          返回对话
        </NavLink>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {subNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/console"}
                className={({ isActive }) =>
                  `mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${
                    isActive
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
                  }`
                }
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-[var(--color-border-soft)] px-4 py-3">
          <div className="text-[11px] text-[var(--color-text-soft)]">
            Agent: <span className="font-mono font-semibold text-[var(--color-text)]">{selectedAgentId}</span>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[52px] items-center border-b border-[var(--color-border-soft)] bg-white/95 px-6 backdrop-blur">
          <div className="text-[13px] font-semibold text-[var(--color-text)]">控制台</div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/layouts/ConsoleLayout.tsx
git commit -m "feat: create ConsoleLayout with sub-navigation sidebar"
```

---

### Task 5: Create ConsoleDashboard page

**Files:**
- Create: `web/src/pages/ConsoleDashboard.tsx`

- [ ] **Step 1: Create ConsoleDashboard**

```tsx
import { RuntimeSummary } from "../features/runtime/RuntimeSummary";

export default function ConsoleDashboard() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">总览</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Runtime 状态、任务执行和事件摘要。
        </p>
      </div>
      <RuntimeSummary mode="tasks" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/ConsoleDashboard.tsx
git commit -m "feat: create ConsoleDashboard with runtime overview"
```

---

### Task 6: Refactor ChatPage (strip header/sidebar, keep chat core)

**Files:**
- Modify: `web/src/pages/ChatPage.tsx`

ChatPage currently renders its own header (agent selector, sidebar toggle, runtime info) and includes SessionSidebar. After refactoring, ChatPage only handles message display + input + approval logic. The layout frame (sidebar, top bar) comes from ChatLayout.

- [ ] **Step 1: Remove the outer layout shell from ChatPage**

The current ChatPage wraps everything in `<main>` with sidebar toggle and header. Replace the JSX return block with just the chat content area:

Replace the return block (lines 309-376) with:

```tsx
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
      <MessageList
        messages={messages}
        handleApprove={handleApprove}
        handleDeny={handleDeny}
        approvals={approvals}
        approvalLoading={approvalLoading}
        approvalErrors={approvalErrors}
        registerApproval={registerApproval}
      />
      <ChatInput
        isLoading={isLoading}
        onSend={handleSend}
        onStop={stop}
        thinkingEnabled={thinkingEnabled}
        onToggleThinking={() => useChatStore.getState().setThinkingEnabled(!thinkingEnabled)}
      />
    </section>
  );
```

- [ ] **Step 2: Remove unused imports from ChatPage**

Remove imports that are no longer used: `Bot`, `PanelLeftClose`, `PanelLeftOpen` from lucide-react, and `SessionSidebar` from features.

Old imports to remove:
```tsx
import { Bot, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import SessionSidebar from "../features/sessions/SessionSidebar";
```

- [ ] **Step 3: Remove unused state and code**

Remove:
- `sessionSidebarOpen` state and `setSessionSidebarOpen`
- `handleAgentChange` function (agent switching is now in the sidebar)
- `handleLoadSession` and `handleNewSession` callbacks (moved to sidebar)
- The `handleAgentChange` and `handleNewSession` no longer need to be passed down

Also remove:
- `agentLoading` and `agentError` usage in the header JSX (those were in the old header)
- The `handleAgentChange` callback

The remaining props should be: `handleSend`, `handleApprove`, `handleDeny`, `approvals`, `approvalLoading`, `approvalErrors`, `registerApproval`.

Actually, keep all the logic — just remove the UI that renders the header and sidebar. The `handleAgentChange`, `handleNewSession`, etc. are still used internally. But we can clean up unused local state like `sessionSidebarOpen`.

Remove line 24:
```tsx
const [sessionSidebarOpen, setSessionSidebarOpen] = useState(true);
```

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ChatPage.tsx
git commit -m "refactor: strip header/sidebar from ChatPage, keep chat core only"
```

---

### Task 7: Update App.tsx with new route tree

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Rewrite App.tsx**

```tsx
import { BrowserRouter, Route, Routes } from "react-router";
import ChatLayout from "./layouts/ChatLayout";
import ConsoleLayout from "./layouts/ConsoleLayout";
import AgentsPage from "./pages/AgentsPage";
import ChannelsPage from "./pages/ChannelsPage";
import ChatPage from "./pages/ChatPage";
import ConsoleDashboard from "./pages/ConsoleDashboard";
import EventsPage from "./pages/EventsPage";
import MemoryPage from "./pages/MemoryPage";
import ProfilesPage from "./pages/ProfilesPage";
import SettingsPage from "./pages/SettingsPage";
import SkillsPage from "./pages/SkillsPage";
import TasksPage from "./pages/TasksPage";
import ToolsPage from "./pages/ToolsPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ChatLayout />}>
          <Route index element={<ChatPage />} />
          <Route path="sessions/:sessionId" element={<ChatPage />} />
        </Route>
        <Route path="console" element={<ConsoleLayout />}>
          <Route index element={<ConsoleDashboard />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="channels" element={<ChannelsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<ChatPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: run tsc check**

```bash
cd web && bun run typecheck
```

Fix any import errors for removed path constants.

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx
git commit -m "refactor: rewrite routes with ChatLayout and ConsoleLayout"
```

---

### Task 8: Remove old AppShell and SessionSidebar

**Files:**
- Remove reference: `web/src/layouts/AppShell.tsx` (can keep as dead code initially, just not imported)

- [ ] **Step 1: Verify AppShell is no longer imported anywhere**

```bash
cd web && grep -r "AppShell" src/ || echo "No references found — safe to keep or remove"
```

- [ ] **Step 2: Remove unused ArchitecturePage import from App.tsx (if still there)**

ArchitecturePage was in the old route tree. Not needed in new tree. Remove from imports if present.

- [ ] **Step 3: Run typecheck and build**

```bash
cd web && bun run typecheck && bun run build
```

Expected: Clean build with no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "chore: remove unused ArchitecturePage import and dead code"
```

---

### Task 9: Dev server smoke test

- [ ] **Step 1: Start dev server**

```bash
bun run dev
# In another terminal:
cd web && bun run dev
```

- [ ] **Step 2: Verify routes**

Visit in browser:
- `http://localhost:5173/` — should show ChatLayout with agent sidebar + empty chat
- `http://localhost:5173/sessions/test` — should attempt to load session
- `http://localhost:5173/console` — should show ConsoleDashboard
- `http://localhost:5173/console/agents` — should show AgentsPage
- `http://localhost:5173/console/tasks` — should show TasksPage

- [ ] **Step 3: Verify console back navigation**

From any `/console/*` page, click "返回对话" → should navigate to `/`

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: smoke test corrections"
```

---

### Task 10: Visual polish with frontend-design

For each new component, invoke the `frontend-design:frontend-design` skill to refine the visual design while keeping the existing CSS variable theme system.

- [ ] **Step 1: Polish ChatLayout and AgentSessionSidebar**

For the agent sidebar — refine spacing, status indicators, hover states, and the "new conversation" button to be distinctive and polished. The sidebar should feel premium with subtle shadows, smooth transitions, and refined typography.

Key areas:
- Status dots with pulse animation for busy agents
- Session list items with better hover/active states
- "新建对话" button as primary CTA
- Agent selector dropdown styling

- [ ] **Step 2: Polish ConsoleLayout**

Refine the console sub-navigation with better icon spacing, active indicators (left border accent), and a more modern header treatment.

- [ ] **Step 3: Polish ConsoleDashboard**

Add stat cards at the top (running/completed/failed task counts), better spacing, and refined RuntimeSummary integration.

- [ ] **Step 4: Commit visual polish**

```bash
git add -A
git commit -m "style: visual polish for ChatLayout, ConsoleLayout, and Dashboard"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full check**

```bash
cd web && bun run check && bun run build
```

Expected: TypeScript check passes, build succeeds.

- [ ] **Step 2: Run all tests**

```bash
cd web && bun test
cd .. && bun test
```

Expected: All existing tests pass (no new test failures).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: final verification — all checks pass"
```
