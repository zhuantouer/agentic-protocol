# Project Conventions

## Coding Style
- Keep plugin guidance concise and operational.
- Prefer Markdown/JSON changes that preserve existing structure and tone.
- Avoid Unix-only command examples in generated guidance; prefer Cursor file tools, `rg`, or portable git commands.
- Keep agent-facing content (the always-applied rule and the skills) in Chinese with English domain terms kept verbatim; the Chinese rule is what keeps the always-on file at ~half the characters the host's 6000-char injection budget measures. Localized explanatory docs stay outside the execution protocol.

## User Preferences
- User wants observable success signals, surgical edits and verifiable next actions without boilerplate forms. The 2026-09-16 goal-alignment request permits a purposeful objective summary; avoid a mandatory goal tree.
- Reduce total unnecessary work and token cost without losing capability or decisive context. Proactively consider algorithm, implementation and workflow efficiency throughout tasks. Weigh likely cumulative reuse savings against investigation, coding/change scope, equivalence-validation difficulty, risk, maintenance and restart costs. Optimize safe in-scope opportunities when worthwhile; short waits may be better than costly changes. Do not invent future reuse or wait for the user to spot waste.
- At each validated milestone the agent commits by default, scoped to that milestone's changes, so work stays traceable; push only on explicit user request (user decision 2026-10-12, supersedes recommend-only).
- Evaluate the whole design, not isolated clause patches. Findings carry recommendations; when reviewers disagree, distinguish accepted points, rejected points with reasons and decisions requiring the user.
- 常驻规则与通用方法论 skill 保存跨场景原则，不按单个案例累加特例；领域知识或 skill 可保存有适用范围与证据支持的具体流程、命令及 checklist；一次事故的经过归 worklog。通用性按是否覆盖同类问题判断，不以是否出现具体名词判断（2026-10-16 用户纠正及 A review）。
- 用户希望 agent 主动沉淀并按需复用所接触领域的可靠知识来源、工作方法与 pipeline、常用动作、动作前后 checklist 和复核条件，不把领域学习仅当作失败后的 MEMORY/worklog；不限定为程序或命令。生命周期风险应计入已知下游用途，但不扩成普遍复核（2026-10-16 用户方向）。2026-10-17 用户进一步要求方法论像资深从业者一样积累资料、数据、环境、工具、故障与实验经验并据此改进方法，已以 `knowledge/<domain>.md` 实施；路由方式与跨项目共享尚待用户确认。[原话与设计边界](worklog/2026-10-16.md#domain-knowledge-discovery-and-reuse)，[实施](worklog/2026-10-17.md#domain-knowledge-capture-implemented)
- 领域记忆、文献与用户经验是参考而非能力上限；agent 应结合自身知识与推理，必要时跳出历史方案、审视关键假设与抽象层次。以目标贡献决定是否探索，不强制每任务创新，也不把背景知识冒充查证/实测。用户已采纳适用范围内复用及条件差异/未知冲突分别保留的原则（2026-10-17）。[用户决定与实现](worklog/2026-10-17.md#open-reasoning-and-scoped-knowledge)

## Project Boundaries
- `PROGRESS.md` is the sole current-state map: goal, now, coarse milestones and a few relevant links. Detailed work belongs in `worklog/YYYY-MM-DD.md`. Resume by task, not yesterday's date; no empty daily files or copied handoffs.
- Never store secret values in `.agent-context/CONFIG.md`.
- Keep behavioral guidance lightweight; avoid turning the plugin into a heavy workflow framework.
- 本仓库 skill 源头是 `plugin/skills/<name>/`；规则源头是 `plugin/rules/agentic-protocol-core.mdc`。安装脚本的同步目标为 `~/.cursor/plugins/local/agentic-protocol/`、`~/.codebuddy/plugins/marketplaces/agentic-protocol-marketplace/plugins/agentic-protocol/` 及 `~/.codex/plugins/agentic-protocol/`（Codex 另由 CLI 快照到 cache）。CodeBuddy 的插件源必须留在该市场目录内。这是目标映射，不是实时安装状态或执行授权。范围内发现实测矛盾时先改已授权源头；未授权的源头修复/同步留证据及待办，不单改安装副本，不自动安装/reload。其他仓库的 skill 映射须在其所属项目确认，不把用户案例路径当本仓库源头。
- Independent review **is** a core capability since 2026-09-23 (`run-review`), overturning the earlier ban on review as a plugin feature. Reviewers receive raw artifacts, not the acting agent's summary; findings are adjudicated item by item. Gates trigger by risk, never as mandatory ceremony — this is the boundary that keeps the previous "no heavy workflow" constraint intact. Subagent review is the default vehicle; the plugin still does not orchestrate multiple models or vendors.

## Review and Validation Habits
- Run `node scripts/validate-template.mjs` for plugin structure changes.
- Keep current validation conclusions/limitations in `PROGRESS.md`; detailed checks and results belong in dated worklog entries, linked only where useful to the current task.
- Before recording a rule change as shipped, confirm it with `git show HEAD:<file>`; the installed copy under `~/.cursor/plugins/local/` diverges.

## Domain Vocabulary
- State map: PROGRESS.md carries goal/now/milestones and relevant links. Work logs: dated evidence by task, read on demand. Recovery is a read view, not a daily handoff artifact.
- Validation profile: reusable checks stored in `.agent-context/COMMANDS.md`.
- Surgical edits: changed lines should trace to the user request or cleanup caused by that change.
- Single-owner routing: each durable fact has one canonical `.agent-context/` file.
