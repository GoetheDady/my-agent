#!/usr/bin/env python3
"""Stop hook that requires module docs to stay in sync with code changes."""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


PROJECT_MAP = "docs/project-module-map.md"


@dataclass(frozen=True)
class ModuleRule:
    module_id: str
    name: str
    doc_path: str
    prefixes: tuple[str, ...]


MODULE_RULES: tuple[ModuleRule, ...] = (
    ModuleRule("M1", "Core Runtime", "docs/modules/m1-core-runtime.md", ("src/core/", "src/main.ts", "src/scripts/")),
    ModuleRule("M2", "Agent Identity & Config", "docs/modules/m2-agent-identity-config.md", ("src/agents/",)),
    ModuleRule("M3", "Task System", "docs/modules/m3-task-system.md", ("src/tasks/",)),
    ModuleRule("M4", "Runtime Execution", "docs/modules/m4-runtime-execution.md", ("src/runtime/",)),
    ModuleRule("M5", "Prompt & Context", "docs/modules/m5-prompt-context.md", ("src/prompts/",)),
    ModuleRule("M6", "Tool System", "docs/modules/m6-tool-system.md", ("src/tools/",)),
    ModuleRule("M7", "Memory System", "docs/modules/m7-memory-system.md", ("src/memory/",)),
    ModuleRule("M8", "Profile System", "docs/modules/m8-profile-system.md", ("src/profiles/",)),
    ModuleRule("M9", "Skill System", "docs/modules/m9-skill-system.md", ("src/skills/", "skills/builtin/")),
    ModuleRule("M10", "Event & Audit", "docs/modules/m10-event-audit.md", ("src/events/",)),
    ModuleRule("M11", "Channel System", "docs/modules/m11-channel-system.md", ("src/channels/",)),
    ModuleRule("M12", "Multi-Agent Collaboration", "docs/modules/m12-multi-agent-collaboration.md", ("src/delegations/", "src/collab/")),
    ModuleRule("M13", "Safety & Trust", "docs/modules/m13-safety-trust.md", ("src/guards/",)),
    ModuleRule("M15", "Runtime Control API", "docs/modules/m15-runtime-control-api.md", ("src/routes/",)),
    ModuleRule("M16", "Web Console", "docs/modules/m16-web-console.md", ("web/src/", "src/sessions/")),
)


CODE_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".json",
    ".toml",
    ".css",
}


def run_git(args: list[str]) -> str:
    return subprocess.check_output(["git", *args], text=True, stderr=subprocess.DEVNULL)


def repo_root() -> Path:
    return Path(run_git(["rev-parse", "--show-toplevel"]).strip())


def changed_paths() -> set[str]:
    output = run_git(["status", "--porcelain=v1", "--untracked-files=all"])
    paths: set[str] = set()
    for raw_line in output.splitlines():
        if not raw_line:
            continue
        path = raw_line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        paths.add(path)
    return paths


def is_code_path(path: str) -> bool:
    suffix = Path(path).suffix
    if suffix not in CODE_EXTENSIONS:
        return False
    if path.startswith(("docs/", ".codex/", ".my-agent/", "node_modules/", "web/node_modules/")):
        return False
    if path.endswith(".md"):
        return False
    return path.startswith(("src/", "web/src/", "skills/builtin/"))


def matching_modules(path: str) -> list[ModuleRule]:
    matches: list[ModuleRule] = []
    for rule in MODULE_RULES:
        if any(path == prefix.rstrip("/") or path.startswith(prefix) for prefix in rule.prefixes):
            matches.append(rule)
    return matches


def block(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


def main() -> int:
    try:
        root = repo_root()
        paths = changed_paths()
    except Exception as exc:
        block(f"无法检查模块文档同步状态：{exc}")
        return 0

    changed_code = sorted(path for path in paths if is_code_path(path))
    if not changed_code:
        return 0

    changed_docs = {path for path in paths if path.startswith("docs/") and path.endswith(".md")}
    changed_modules: dict[str, ModuleRule] = {}
    unmapped_code: list[str] = []
    for path in changed_code:
        modules = matching_modules(path)
        if not modules:
            unmapped_code.append(path)
            continue
        for module in modules:
            changed_modules[module.module_id] = module

    missing: list[str] = []
    if changed_modules and PROJECT_MAP not in changed_docs:
        missing.append(PROJECT_MAP)

    for module in changed_modules.values():
        module_doc = root / module.doc_path
        if module.doc_path not in changed_docs:
            missing.append(module.doc_path)
        if not module_doc.exists() and module.doc_path not in changed_docs:
            missing.append(f"{module.doc_path}（文件尚不存在，需要创建）")

    if missing or unmapped_code:
        lines = [
            "本轮修改了代码，但模块文档没有同步完成。",
            "",
        ]
        if changed_modules:
            lines.append("受影响模块：")
            for module in sorted(changed_modules.values(), key=lambda item: item.module_id):
                lines.append(f"- {module.module_id} {module.name}: {module.doc_path}")
            lines.append("")
        if missing:
            deduped_missing = list(dict.fromkeys(missing))
            lines.append("请更新这些文档后再结束：")
            for path in deduped_missing:
                lines.append(f"- {path}")
            lines.append("")
        if unmapped_code:
            lines.append("这些代码路径还没有配置模块映射，请更新 hook 映射或说明原因：")
            for path in unmapped_code:
                lines.append(f"- {path}")
            lines.append("")
        lines.append("文档要求：对应模块文档记录模块职责、当前状态、改动影响和下一步；project-module-map.md 更新整体状态或链接。")
        block("\n".join(lines))

    return 0


if __name__ == "__main__":
    sys.exit(main())
