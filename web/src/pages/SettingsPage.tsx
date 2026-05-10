import { Bot, Brain, Cable, Settings, Wrench } from "lucide-react";
import { InfoCard, PageScaffold, PageSection } from "../components/common/PageScaffold";

export default function SettingsPage() {
  return (
    <PageScaffold>
      <PageSection title="配置中心" description="第一版先作为配置入口页，不直接改写后端配置文件。">
        <div className="grid gap-4 xl:grid-cols-2">
          <SettingBlock icon={Bot} title="模型配置" text="后续配置 DeepSeek 模型名、超时、thinking 开关默认值和 provider 优先级。" />
          <SettingBlock icon={Brain} title="记忆策略" text="后续配置记忆提取、Dream Worker 调度、profile_sync 开关和阈值。" />
          <SettingBlock icon={Wrench} title="工具权限" text="后续配置工具 allowlist、路径写入范围和记住审批选择。" />
          <SettingBlock icon={Cable} title="渠道配置" text="后续配置 Web、微信、飞书 channel identity 和消息适配。" />
        </div>
      </PageSection>
      <div className="mt-5">
        <PageSection title="当前配置来源" description="配置优先级由后端控制。">
          <div className="grid gap-3 xl:grid-cols-3">
            <InfoCard title="环境变量" description="优先级最高，适合 API key 和部署环境差异。" />
            <InfoCard title="config.json" description="本地配置文件，支持 $VAR 形式从环境变量解析。" />
            <InfoCard title="默认值" description="代码内默认配置，保证最小可运行。" />
          </div>
        </PageSection>
      </div>
    </PageScaffold>
  );
}

function SettingBlock({ icon: Icon, title, text }: { icon: typeof Settings; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[var(--color-accent)] shadow-sm">
        <Icon size={18} />
      </span>
      <div className="mt-4 text-sm font-semibold text-[var(--color-text)]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{text}</p>
    </div>
  );
}
