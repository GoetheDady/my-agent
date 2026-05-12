import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, RefreshCw, Square, Sparkles } from "lucide-react";
import { InfoCard, PageScaffold, PageSection } from "../components/common/PageScaffold";

interface SkillItem {
  id: string;
  agentId: string;
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
  source: string;
  status: "enabled" | "disabled";
  createdAt: number;
  updatedAt: number;
  directory: string;
  filePath: string;
}

interface SkillListResponse {
  agentId: string;
  skills: SkillItem[];
  enabledCount: number;
  disabledCount: number;
}

interface SkillIndexResponse {
  agentId: string;
  index: string;
}

export default function SkillsPage() {
  const [agentId, setAgentId] = useState("default");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [indexText, setIndexText] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkillContent, setSelectedSkillContent] = useState<string>("");
  const [newSkill, setNewSkill] = useState({
    skillId: "web-debug",
    name: "Web Debug",
    description: "用于调试 Web 页面和检查 UI 状态。",
    content: "# Web Debug\n\nUse browser tools to inspect the rendered UI.",
    category: "general",
    allowedTools: "",
  });
  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedSkillId) ?? skills[0] ?? null,
    [skills, selectedSkillId],
  );

  useEffect(() => {
    void fetchSkills();
  }, []);

  useEffect(() => {
    if (!selectedSkill?.id) {
      setSelectedSkillContent("");
      return;
    }
    void fetchSkillContent(selectedSkill.id);
  }, [selectedSkill?.id]);

  async function fetchSkills() {
    setLoading(true);
    setError(null);
    try {
      const [listRes, indexRes] = await Promise.all([
        fetch(`/api/skills?agentId=${encodeURIComponent(agentId)}&status=all`),
        fetch(`/api/skills/index?agentId=${encodeURIComponent(agentId)}`),
      ]);
      if (!listRes.ok) throw new Error("获取 skill 列表失败");
      if (!indexRes.ok) throw new Error("获取 skill 索引失败");
      const listData = await listRes.json() as SkillListResponse;
      const indexData = await indexRes.json() as SkillIndexResponse;
      setSkills(listData.skills);
      setIndexText(indexData.index);
      setSelectedSkillId((current) => current ?? listData.skills[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function updateSkillStatus(skillId: string, next: "enable" | "disable") {
    setError(null);
    const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}/${next}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    if (!res.ok) {
      setError(`${next === "enable" ? "启用" : "停用"} skill 失败`);
      return;
    }
    await fetchSkills();
  }

  async function fetchSkillContent(skillId: string) {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}?agentId=${encodeURIComponent(agentId)}`);
      if (!res.ok) throw new Error("获取 skill 内容失败");
      const data = await res.json() as { content?: string };
      setSelectedSkillContent(data.content ?? "");
    } catch (err) {
      setSelectedSkillContent(err instanceof Error ? err.message : "读取失败");
    }
  }

  async function createSkill() {
    setFormError(null);
    setError(null);
    const skillId = newSkill.skillId.trim();
    if (!skillId || !newSkill.name.trim() || !newSkill.description.trim() || !newSkill.content.trim()) {
      setFormError("请填写 skillId、name、description 和 content");
      return;
    }
    const res = await fetch("/api/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId,
        skillId,
        name: newSkill.name.trim(),
        description: newSkill.description.trim(),
        content: newSkill.content,
        category: newSkill.category.trim() || "general",
        allowedTools: newSkill.allowedTools.split(",").map((item) => item.trim()).filter(Boolean),
      }),
    });
    if (!res.ok) {
      setFormError("创建 skill 失败");
      return;
    }
    setSelectedSkillId(skillId);
    await fetchSkills();
  }

  const enabledSkills = skills.filter((skill) => skill.status === "enabled");
  const disabledSkills = skills.filter((skill) => skill.status === "disabled");

  return (
    <PageScaffold>
      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <PageSection title="Skill 索引" description="索引先让 Agent 知道有哪些 skill，需要时再加载全文，减少 token 使用。">
          <div className="flex items-center gap-3">
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-48 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              placeholder="agentId"
            />
            <button
              onClick={() => void fetchSkills()}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              刷新
            </button>
          </div>
          {error && <div className="mt-3 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
          <div className="mt-4 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <BookOpen size={16} />
            索引内容
          </div>
          <pre className="mt-3 overflow-auto rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4 text-xs leading-6 text-[var(--color-text-muted)]">
            {indexText || "暂无启用的 skill"}
          </pre>
        </PageSection>

        <PageSection title="当前概览" description="只保留启用和停用两种状态，目录保持干净。">
          <div className="grid gap-3 xl:grid-cols-2">
            <InfoCard title="启用" description="当前可直接被 Agent 查看和调用的 skill。" meta={String(enabledSkills.length)} />
            <InfoCard title="停用" description="保留在本地目录中，但不会进入可调用索引。" meta={String(disabledSkills.length)} />
          </div>
          <div className="mt-4 space-y-3">
            {skills.length === 0 ? (
              <EmptySkillState />
            ) : (
              skills.map((skill) => (
                <div
                  key={skill.id}
                  onClick={() => setSelectedSkillId(skill.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedSkillId(skill.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    selectedSkill?.id === skill.id
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                      : "border-[var(--color-border-soft)] bg-white hover:bg-[var(--color-surface-subtle)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          skill.status === "enabled"
                            ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                            : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                        }`}>
                          {skill.status === "enabled" ? "启用" : "停用"}
                        </span>
                        <span className="text-sm font-semibold text-[var(--color-text)]">{skill.name}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{skill.description}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {skill.status === "enabled" ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void updateSkillStatus(skill.id, "disable");
                          }}
                          className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)]"
                          title="停用"
                        >
                          <Square size={16} />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void updateSkillStatus(skill.id, "enable");
                          }}
                          className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text-muted)]"
                          title="启用"
                        >
                          <CheckCircle2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </PageSection>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <PageSection title="全文预览" description="需要的时候才真正加载 skill 内容。">
          {selectedSkill ? (
            <div className="space-y-3">
              <InfoCard title="路径" description={selectedSkill.filePath} />
              <InfoCard title="分类" description={selectedSkill.category} />
              <InfoCard title="允许工具" description={selectedSkill.allowedTools.length > 0 ? selectedSkill.allowedTools.join(", ") : "无"} />
              <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
                <div className="text-sm font-semibold text-[var(--color-text)]">正文</div>
                <pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs leading-6 text-[var(--color-text-muted)]">
                  {selectedSkillContent || "请选择 skill 后加载全文"}
                </pre>
              </div>
            </div>
          ) : (
            <EmptySkillState />
          )}
        </PageSection>

        <PageSection title="设计说明" description="skill 作为 Agent 的本地能力目录，只暴露索引和受控启停。">
          <div className="grid gap-3">
            <InfoCard title="本地目录" description="每个 Agent 自己有独立 skill 目录，不跨 Agent 共享。" />
            <InfoCard title="默认启用" description="skill_create 默认写成启用态，符合自动启用的使用习惯。" />
            <InfoCard title="索引加载" description="Agent 先看索引，再按需调用 skill_view 加载正文。" />
          </div>
        </PageSection>
      </div>

      <div className="mt-5">
        <PageSection title="创建 Skill" description="创建后默认启用，目录写入当前 Agent 的本地 skills 路径。">
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="grid gap-3">
              <InputField label="skillId" value={newSkill.skillId} onChange={(value) => setNewSkill((current) => ({ ...current, skillId: value }))} />
              <InputField label="name" value={newSkill.name} onChange={(value) => setNewSkill((current) => ({ ...current, name: value }))} />
              <InputField label="category" value={newSkill.category} onChange={(value) => setNewSkill((current) => ({ ...current, category: value }))} />
              <InputField label="allowedTools" value={newSkill.allowedTools} onChange={(value) => setNewSkill((current) => ({ ...current, allowedTools: value }))} placeholder="comma,separated,tools" />
            </div>
            <div className="grid gap-3">
              <TextAreaField label="description" value={newSkill.description} onChange={(value) => setNewSkill((current) => ({ ...current, description: value }))} />
              <TextAreaField label="content" value={newSkill.content} onChange={(value) => setNewSkill((current) => ({ ...current, content: value }))} rows={8} />
              {formError && <div className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{formError}</div>}
              <button
                onClick={() => void createSkill()}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white"
              >
                <Sparkles size={16} />
                创建 Skill
              </button>
            </div>
          </div>
        </PageSection>
      </div>
    </PageScaffold>
  );
}

function EmptySkillState() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] px-4 py-8 text-sm text-[var(--color-text-soft)]">
      <Sparkles size={16} />
      暂无 skill
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows = 5,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
      />
    </label>
  );
}
