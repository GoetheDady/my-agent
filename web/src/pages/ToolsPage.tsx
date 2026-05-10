import { Lock, Search, ShieldCheck, Wrench } from "lucide-react";
import { InfoCard, PageScaffold, PageSection } from "../components/common/PageScaffold";

export default function ToolsPage() {
  return (
    <PageScaffold>
      <PageSection title="工具系统" description="工具按读、写、记忆读、记忆写分类；写工具需要策略判断。">
        <div className="grid gap-4 xl:grid-cols-4">
          <ToolClass icon={Search} title="Read" text="读取文件、列目录等低风险工具默认允许。" />
          <ToolClass icon={Lock} title="Write" text="写文件等高影响工具需要审批或 allowlist。" />
          <ToolClass icon={Wrench} title="Memory Read" text="memory_recall/search/get 用于查询长期记忆和证据。" />
          <ToolClass icon={ShieldCheck} title="Memory Write" text="memory_propose/update/forget 直接写 active memory，并记录事件。" />
        </div>
      </PageSection>
      <div className="mt-5">
        <PageSection title="后续配置入口" description="本页先建立信息架构，具体 allowlist 和工具开关后续接 API。">
          <div className="grid gap-3 xl:grid-cols-2">
            <InfoCard title="工具权限" description="按 toolset、category、路径 allowlist 和会话选择记录配置。" />
            <InfoCard title="审计事件" description="所有工具调用和结果继续通过 runtime events 观察。" />
          </div>
        </PageSection>
      </div>
    </PageScaffold>
  );
}

function ToolClass({ icon: Icon, title, text }: { icon: typeof Wrench; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[var(--color-accent)] shadow-sm">
        <Icon size={16} />
      </span>
      <div className="mt-4 text-sm font-semibold text-[var(--color-text)]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{text}</p>
    </div>
  );
}
