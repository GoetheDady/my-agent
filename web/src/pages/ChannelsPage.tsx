import { Cable, MessageSquare, Send, Smartphone } from "lucide-react";
import { InfoCard, PageScaffold, PageSection } from "../components/common/PageScaffold";

export default function ChannelsPage() {
  return (
    <PageScaffold>
      <PageSection title="渠道入口" description="Channel 会把外部消息统一转换成内部 task。">
        <div className="grid gap-4 xl:grid-cols-3">
          <ChannelCard icon={MessageSquare} title="Web" status="已启用" description="当前前端聊天入口，绑定 sessions 和 Web channel。" />
          <ChannelCard icon={Smartphone} title="WeChat" status="预留" description="后续需要 channel identity、消息适配和安全边界。" />
          <ChannelCard icon={Send} title="Feishu" status="预留" description="后续接入群聊、私聊、机器人事件和用户身份映射。" />
        </div>
      </PageSection>
      <div className="mt-5">
        <PageSection title="设计原则" description="提前设计 channel 是为了不把用户身份和会话绑定死在 Web。">
          <div className="grid gap-3 xl:grid-cols-2">
            <InfoCard title="Channel Identity" description="同一个真实用户可能来自 Web、微信、飞书，需要映射到统一 user profile。" />
            <InfoCard title="Task Boundary" description="外部渠道只负责输入输出，Agent Runtime 仍保持统一任务执行模型。" />
          </div>
        </PageSection>
      </div>
    </PageScaffold>
  );
}

function ChannelCard({ icon: Icon, title, status, description }: { icon: typeof Cable; title: string; status: string; description: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-5">
      <div className="flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[var(--color-accent)] shadow-sm">
          <Icon size={18} />
        </span>
        <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-[var(--color-text-muted)] shadow-sm">{status}</span>
      </div>
      <div className="mt-4 text-sm font-semibold text-[var(--color-text)]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>
    </div>
  );
}
