import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import {
  Bot,
  Brain,
  Cable,
  ClipboardList,
  GitBranch,
  MessageSquare,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import MemoryPanel from "../features/memory/MemoryPanel";
import {
  AGENTS_PATH,
  ARCHITECTURE_PATH,
  CHANNELS_PATH,
  EVENTS_PATH,
  MEMORY_PATH,
  PROFILES_PATH,
  SETTINGS_PATH,
  TASKS_PATH,
  TOOLS_PATH,
} from "../lib/sessionRoute";

interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  description: string;
}

const primaryNav: NavItem[] = [
  { label: "对话", path: "/", icon: MessageSquare, description: "和默认 Agent 交互" },
  { label: "记忆", path: MEMORY_PATH, icon: Brain, description: "长期记忆与梦整理" },
  { label: "画像", path: PROFILES_PATH, icon: UserRound, description: "user.md / soul.md" },
  { label: "任务", path: TASKS_PATH, icon: ClipboardList, description: "队列与执行历史" },
  { label: "事件", path: EVENTS_PATH, icon: Sparkles, description: "Runtime event log" },
  { label: "架构", path: ARCHITECTURE_PATH, icon: GitBranch, description: "系统流转图" },
];

const secondaryNav: NavItem[] = [
  { label: "Agents", path: AGENTS_PATH, icon: Bot, description: "单 Agent 与多 Agent 预留" },
  { label: "Channels", path: CHANNELS_PATH, icon: Cable, description: "Web / 微信 / 飞书入口" },
  { label: "Tools", path: TOOLS_PATH, icon: Wrench, description: "工具权限与策略" },
  { label: "Settings", path: SETTINGS_PATH, icon: Settings, description: "模型、记忆、工具配置" },
];

const pageMeta: Record<string, { title: string; description: string }> = {
  "/": { title: "对话控制台", description: "单 Agent 串行执行、工具调用和后台记忆 worker 的主入口。" },
  [MEMORY_PATH]: { title: "记忆系统", description: "查看长期记忆、经历、整理记录和 Dream Worker 运行结果。" },
  [PROFILES_PATH]: { title: "稳定认知", description: "查看 user.md / soul.md 如何和长期记忆配合。" },
  [TASKS_PATH]: { title: "任务队列", description: "观察 Agent 当前任务、排队任务和执行历史。" },
  [EVENTS_PATH]: { title: "运行事件", description: "按事件流观察 task、tool、memory、profile、dream 的内部状态。" },
  [ARCHITECTURE_PATH]: { title: "系统架构", description: "从输入、执行、工具、记忆到持久化的整体流转图。" },
  [AGENTS_PATH]: { title: "Agent 管理", description: "当前默认 Agent 状态，以及后续多 Agent 协同入口。" },
  [CHANNELS_PATH]: { title: "渠道入口", description: "Web channel 已启用，微信和飞书预留接入位置。" },
  [TOOLS_PATH]: { title: "工具权限", description: "查看工具类别、权限策略和后续配置入口。" },
  [SETTINGS_PATH]: { title: "系统配置", description: "模型、记忆策略、Agent 和工具权限配置入口。" },
};

export default function AppShell() {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const location = useLocation();
  const meta = useMemo(() => {
    if (location.pathname.startsWith("/sessions/")) return pageMeta["/"];
    return pageMeta[location.pathname] ?? pageMeta["/"];
  }, [location.pathname]);

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <aside className="flex w-[86px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-white">
        <div className="flex h-[68px] items-center justify-center border-b border-[var(--color-border-soft)]">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-accent)] text-white shadow-sm">
            <SlidersHorizontal size={19} />
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
          {primaryNav.map((item) => (
            <GlobalNavLink key={item.path} item={item} />
          ))}
          <div className="my-2 h-px bg-[var(--color-border-soft)]" />
          {secondaryNav.map((item) => (
            <GlobalNavLink key={item.path} item={item} compact />
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[68px] items-center gap-4 border-b border-[var(--color-border-soft)] bg-white/95 px-6 backdrop-blur">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[16px] font-semibold text-[var(--color-text)]">{meta.title}</h1>
            <p className="mt-1 truncate text-xs text-[var(--color-text-soft)]">{meta.description}</p>
          </div>
          <button
            onClick={() => setMemoryOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-text-muted)] shadow-sm transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          >
            <Brain size={16} />
            快速记忆
          </button>
          <NavLink
            to={SETTINGS_PATH}
            className={({ isActive }) => `flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              isActive
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
            title="配置"
          >
            <Settings size={17} />
          </NavLink>
        </header>
        <Outlet />
      </div>

      {memoryOpen && <MemoryPanel onClose={() => setMemoryOpen(false)} />}
    </div>
  );
}

function GlobalNavLink({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const Icon = item.icon;
  const location = useLocation();
  const sessionRouteActive = item.path === "/" && location.pathname.startsWith("/sessions/");
  return (
    <NavLink
      to={item.path}
      end={item.path === "/"}
      title={`${item.label} - ${item.description}`}
      className={({ isActive }) => `flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[11px] font-medium transition-colors ${
        isActive || sessionRouteActive
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "text-[var(--color-text-soft)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
      } ${compact ? "py-2" : ""}`}
    >
      <Icon size={compact ? 16 : 18} />
      <span>{item.label}</span>
    </NavLink>
  );
}
