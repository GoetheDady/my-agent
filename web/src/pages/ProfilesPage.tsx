import { Brain, RefreshCw, UserRound } from "lucide-react";
import { InfoCard, PageScaffold, PageSection } from "../components/common/PageScaffold";

export default function ProfilesPage() {
  return (
    <PageScaffold>
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <PageSection
          title="user.md"
          description="Agent 对用户的稳定认知：身份、长期项目、偏好、协作方式。"
        >
          <div className="grid gap-3">
            <InfoCard
              title="定位"
              description="这是从长期记忆沉淀出的高优先级用户画像，不保存完整聊天历史。"
              meta="data/agents/default/user.md"
            />
            <InfoCard
              title="写入来源"
              description="Memory Worker 和 Dream Worker 写入 active memory 后，由 profile_sync 判断是否同步。"
            />
            <InfoCard
              title="当前边界"
              description="前端还没有 profile 文件读取 API；本页先展示结构定位，后续补充文件内容预览和差异查看。"
            />
          </div>
        </PageSection>

        <PageSection
          title="soul.md"
          description="Agent 对自己的稳定认知：表达规则、行为边界、长期协作原则。"
        >
          <div className="grid gap-3">
            <InfoCard
              title="定位"
              description="这是 Agent 的稳定自我规则，用于 prompt context；过去经历和证据仍必须通过记忆工具查询。"
              meta="data/agents/default/soul.md"
            />
            <InfoCard
              title="适合写入"
              description="长期语气要求、反复出现的做事方法、稳定边界、踩坑后的自我修正。"
            />
            <InfoCard
              title="不适合写入"
              description="普通项目事实、一次性任务结果、工具输出细节和用户私人事实。"
            />
          </div>
        </PageSection>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        {[
          { icon: Brain, title: "Memory as Evidence", text: "记忆系统保留证据、变化轨迹和可检索上下文。" },
          { icon: RefreshCw, title: "profile_sync", text: "同步器自动判断哪些稳定认知进入 user.md 或 soul.md。" },
          { icon: UserRound, title: "Prompt Context", text: "画像文件注入 prompt，但长期记忆不整体注入。" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="rounded-xl border border-[var(--color-border-soft)] bg-white p-5 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <Icon size={18} />
              </div>
              <div className="mt-4 text-sm font-semibold text-[var(--color-text)]">{item.title}</div>
              <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{item.text}</p>
            </div>
          );
        })}
      </div>
    </PageScaffold>
  );
}
