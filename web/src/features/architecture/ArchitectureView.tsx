import {
  ArrowRight,
  Bot,
  Brain,
  Cable,
  ClipboardList,
  Database,
  FileText,
  GitBranch,
  HardDrive,
  MessageSquare,
  Moon,
  Network,
  RefreshCw,
  Server,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";

const layers = [
  {
    title: "Channel Layer",
    subtitle: "入口层",
    description: "把 Web、后续微信/飞书等渠道消息统一转换成内部 task。",
    icon: Cable,
    accent: "blue",
    items: ["Web Chat", "Session API", "Channel Identity", "未来 WeChat / Feishu"],
  },
  {
    title: "Agent Runtime",
    subtitle: "执行层",
    description: "单 Agent 串行处理任务，构建 prompt，调用模型和工具，保存回复。",
    icon: Bot,
    accent: "green",
    items: ["Task Queue", "Agent Lock", "Prompt Builder", "Tool Policy"],
  },
  {
    title: "Tool & Memory",
    subtitle: "认知层",
    description: "长期记忆通过工具主动查询；后台 worker 自动提取、再巩固和同步画像。",
    icon: Brain,
    accent: "amber",
    items: ["memory_recall", "memory_extract", "Dream Worker", "profile_sync"],
  },
  {
    title: "Persistence",
    subtitle: "持久层",
    description: "对话、任务、事件、记忆、profile 文件分别持久化，方便回放和审计。",
    icon: Database,
    accent: "purple",
    items: ["SQLite", "LanceDB", "soul.md / user.md", "Runtime Events"],
  },
];

const messageFlow = [
  {
    title: "用户发送消息",
    detail: "前端先确保 session 存在，再 POST /api/chat。",
    icon: User,
    tags: ["session", "chat"],
  },
  {
    title: "Web Channel 创建任务",
    detail: "消息写入 user.message event，并创建 queued task。",
    icon: MessageSquare,
    tags: ["conversation", "task.created"],
  },
  {
    title: "Agent 串行执行",
    detail: "同一个 Agent 同时只跑一个 task；构建 system prompt。",
    icon: Bot,
    tags: ["agent lock", "prompt"],
  },
  {
    title: "加载稳定认知",
    detail: "soul.md / user.md 注入 prompt；长期记忆不直接注入。",
    icon: FileText,
    tags: ["profile context"],
  },
  {
    title: "模型调用工具",
    detail: "需要历史、文件或操作时调用工具，工具事件进入 runtime。",
    icon: Wrench,
    tags: ["tools", "events"],
  },
  {
    title: "助手回复落库",
    detail: "assistant message 保存到 messages，并触发生命周期 hook。",
    icon: Server,
    tags: ["persisted hook"],
  },
  {
    title: "后台记忆提取",
    detail: "Memory Worker 提取新记忆、再巩固旧记忆，并写合成工具卡。",
    icon: Sparkles,
    tags: ["memory_extract", "reconsolidate"],
  },
  {
    title: "同步认知文件",
    detail: "profile_sync 判断稳定认知，自动更新 user.md 或 soul.md。",
    icon: RefreshCw,
    tags: ["user.md", "soul.md"],
  },
];

const memoryFlows = [
  {
    name: "Working Memory",
    cn: "工作记忆",
    detail: "当前 task 的临时状态，任务结束后不作为长期事实。",
  },
  {
    name: "Episodic",
    cn: "情景记忆",
    detail: "一次任务或对话的经历摘要，用来回答刚才/昨天/之前做过什么。",
  },
  {
    name: "Semantic / Social",
    cn: "事实与偏好",
    detail: "稳定事实、项目知识、用户偏好和协作方式。",
  },
  {
    name: "Procedural / Reflective",
    cn: "流程与反思",
    detail: "做事方法、踩坑经验和风险模式，由 Dream Worker 沉淀。",
  },
  {
    name: "Prospective",
    cn: "前瞻记忆",
    detail: "未来计划、待办和提醒意图，目前负责可回忆和可完成。",
  },
];

const storage = [
  { icon: HardDrive, label: "SQLite", detail: "sessions、messages、tasks、events、episodes、dream_runs、decisions" },
  { icon: Network, label: "LanceDB", detail: "active / inactive / superseded 长期向量记忆" },
  { icon: FileText, label: "Markdown Profiles", detail: "agents/default/soul.md 与 users/default/user.md" },
];

export default function ArchitectureView() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg)]">
      <section className="border-b border-[var(--color-border-soft)] bg-white">
        <div className="mx-auto flex max-w-7xl items-start justify-between gap-8 px-8 py-7">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase text-[var(--color-text-soft)]">
              <GitBranch size={15} />
              Architecture Map
            </div>
            <h2 className="text-3xl font-semibold tracking-normal text-[var(--color-text)]">
              My Agent 当前架构与消息流转
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
              这张图展示从用户发消息、Agent 串行执行、工具调用、记忆提取、Dream Worker 整理，到
              soul.md / user.md 自动沉淀稳定认知的完整链路。
            </p>
          </div>
          <div className="hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm text-[var(--color-text-muted)] lg:block">
            <div className="font-medium text-[var(--color-text)]">当前阶段</div>
            <div className="mt-1">单 Agent MVP + 类人记忆系统</div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-8 py-7">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {layers.map((layer) => (
            <LayerCard key={layer.title} {...layer} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-8 pb-7">
        <SectionHeader
          icon={MessageSquare}
          title="从输入到回复的主流程"
          subtitle="主流程是用户能直接感知的聊天路径；后台 worker 不阻塞助手回复。"
        />
        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-white p-5 shadow-sm">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 2xl:grid-cols-8">
            {messageFlow.map((step, index) => (
              <FlowStep key={step.title} index={index + 1} isLast={index === messageFlow.length - 1} {...step} />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-8 pb-8 xl:grid-cols-[1.15fr_0.85fr]">
        <div>
          <SectionHeader
            icon={Brain}
            title="记忆系统与 profile 同步"
            subtitle="profile 是稳定认知层；memory 是证据和动态回忆层。"
          />
          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
            {memoryFlows.map((memory) => (
              <div key={memory.name} className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
                <div className="text-[13px] font-semibold text-[var(--color-text)]">{memory.name}</div>
                <div className="mt-1 text-xs font-medium text-[var(--color-accent)]">{memory.cn}</div>
                <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">{memory.detail}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-1 items-center gap-3 rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm xl:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <PipelineBox title="Memory Worker" detail="每轮助手消息落库后提取与再巩固" icon={Sparkles} />
            <ArrowRight className="hidden text-[var(--color-text-soft)] xl:block" size={18} />
            <PipelineBox title="Dream Worker" detail="每日自动整理、去重、沉淀经验" icon={Moon} />
            <ArrowRight className="hidden text-[var(--color-text-soft)] xl:block" size={18} />
            <PipelineBox title="profile_sync" detail="自动更新 user.md / soul.md" icon={RefreshCw} />
          </div>
        </div>

        <div>
          <SectionHeader
            icon={Database}
            title="持久化与可观察性"
            subtitle="可观察性指系统把内部运行状态记录成事件，方便前端展示和排查。"
          />
          <div className="mt-4 space-y-3">
            {storage.map((item) => (
              <StorageRow key={item.label} {...item} />
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
              <ClipboardList size={16} />
              Runtime Events
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[var(--color-text-muted)]">
              {[
                "task.*",
                "tool.*",
                "memory.search",
                "memory.extract.*",
                "memory.reconsolidate.*",
                "memory.decision.*",
                "profile.sync.*",
                "dream.*",
              ].map((event) => (
                <div key={event} className="rounded-md bg-[var(--color-surface-subtle)] px-3 py-2 font-mono">
                  {event}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function LayerCard({
  title,
  subtitle,
  description,
  icon: Icon,
  accent,
  items,
}: {
  title: string;
  subtitle: string;
  description: string;
  icon: typeof Cable;
  accent: string;
  items: string[];
}) {
  return (
    <article className="rounded-lg border border-[var(--color-border)] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accentClass(accent)}`}>
          <Icon size={18} />
        </div>
        <span className="text-xs font-medium text-[var(--color-text-soft)]">{subtitle}</span>
      </div>
      <h3 className="mt-4 text-base font-semibold text-[var(--color-text)]">{title}</h3>
      <p className="mt-2 min-h-[48px] text-xs leading-5 text-[var(--color-text-muted)]">{description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="rounded-md bg-[var(--color-surface-subtle)] px-2 py-1 text-[11px] text-[var(--color-text-muted)]">
            {item}
          </span>
        ))}
      </div>
    </article>
  );
}

function FlowStep({
  index,
  title,
  detail,
  icon: Icon,
  tags,
  isLast,
}: {
  index: number;
  title: string;
  detail: string;
  icon: typeof User;
  tags: string[];
  isLast: boolean;
}) {
  return (
    <div className="relative min-w-0">
      {!isLast && (
        <div className="absolute left-[calc(100%-6px)] top-8 z-0 h-px w-5 bg-[var(--color-border)]" />
      )}
      <div className="relative z-10 flex min-h-[220px] flex-col rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-[var(--color-accent)] shadow-sm">
            <Icon size={15} />
          </div>
          <span className="font-mono text-[11px] text-[var(--color-text-soft)]">{String(index).padStart(2, "0")}</span>
        </div>
        <div className="mt-3 text-[13px] font-semibold leading-5 text-[var(--color-text)]">{title}</div>
        <p className="mt-2 flex-1 text-xs leading-5 text-[var(--color-text-muted)]">{detail}</p>
        <div className="mt-3 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <span key={tag} className="rounded bg-white px-1.5 py-1 text-[10px] font-medium text-[var(--color-text-soft)]">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof MessageSquare;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Icon size={17} className="text-[var(--color-accent)]" />
          {title}
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{subtitle}</p>
      </div>
    </div>
  );
}

function PipelineBox({ title, detail, icon: Icon }: { title: string; detail: string; icon: typeof Sparkles }) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-subtle)] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
        <Icon size={15} className="text-[var(--color-accent)]" />
        {title}
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">{detail}</p>
    </div>
  );
}

function StorageRow({ icon: Icon, label, detail }: { icon: typeof HardDrive; label: string; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Icon size={16} />
        </div>
        <div>
          <div className="text-sm font-semibold text-[var(--color-text)]">{label}</div>
          <div className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">{detail}</div>
        </div>
      </div>
    </div>
  );
}

function accentClass(accent: string): string {
  const classes: Record<string, string> = {
    blue: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
    green: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    amber: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    purple: "bg-[#f0eaff] text-[#7357c8]",
  };
  return classes[accent] ?? classes.blue;
}
