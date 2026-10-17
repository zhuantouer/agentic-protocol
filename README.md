# agentic-protocol

**Keep the goal, the conclusions, and the work that led there.** `agentic-protocol` gives AI-assisted projects a durable work record in plain Markdown, shared by [Cursor](https://cursor.com/cn/docs/plugins), Codex, [CodeBuddy](https://www.codebuddy.cn/docs/cli/plugins), and [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

One protocol, three skills, and lightweight Python-standard-library hooks. No index, database, daemon or MCP server. The agent maintains `.agent-context/PROGRESS.md`; new sessions read its current sections directly. There is no separate handoff to prepare or keep in sync.

## What it solves

| Pain point | How agentic-protocol fixes it |
|------------|---------------------------|
| API keys / config forgotten mid-session | `.agent-context/CONFIG.md` persists key locations, loaded on demand; never secret values |
| Agent re-reads the entire codebase every time | `.agent-context/ARCHITECTURE.md` gives a project map |
| Commands re-discovered through trial & error | `.agent-context/COMMANDS.md` caches commands plus the validation profile |
| Research produces branches instead of progress | `.agent-context/PROGRESS.md` preserves the objective, success criteria, subgoal expectations and remaining gaps |
| New chats remember the task but forget its purpose | The protocol makes the agent read `PROGRESS.md` at startup — the file itself, not a second snapshot |
| Agent misses local project habits | `.agent-context/CONVENTIONS.md` stores style, workflow, boundaries, and user preferences |
| Agent hallucinates or free-wheels | Built-in confirmation guardrails |
| Hard-won lessons disappear after the chat | `.agent-context/MEMORY.md` captures project decisions, user corrections, failures, and mistakes to avoid |

## How it works

The agent keeps a short state map, dated evidence logs and only useful supporting knowledge:

```
.agent-context/
├── PROGRESS.md       ← goal, current state, next check, coarse milestones and relevant links
├── worklog/
│   └── YYYY-MM-DD.md ← meaningful work, experiments and decision evidence by task
├── ARCHITECTURE.md   ← project map and boundaries, when useful
├── COMMANDS.md       ← reusable commands and validation profile
├── CONFIG.md         ← env names and secret locations, never values
├── CONVENTIONS.md    ← durable preferences and boundaries
└── MEMORY.md         ← reusable lessons and decision rationale
```

`PROGRESS.md` answers “where are we now?”; daily logs explain “what happened and why?”. At the start of a session the agent reads `Objective`, optional `Constraints`, `Current State` and optional `Next Check` from `PROGRESS.md` itself, including a few task-relevant links. `Milestones` summarizes coarse outcomes, not every day or task. Neither logs nor milestones are automatically loaded; there is no full log index in PROGRESS. The [update-progress templates](plugin/skills/update-progress/SKILL.md) define both formats.

For example, a record can say: the goal is shorter query latency; the current conclusion is that A meets the latency limit but recall is unmeasured; the next check measures recall and determines whether to select A; the dated log explains which experiment established the latency result. This is useful working knowledge, not an extra handoff ritual.

**You do not maintain these files manually.** Record meaningful results in the day's log first; update PROGRESS only when its state, milestone or relevant link changes. A new date alone triggers nothing. Current task links may point to Friday on Monday, or to an older task even when another task has a newer log. If the map suffices, continue without opening logs; otherwise read the linked task section. Never copy yesterday into today or create an empty daily file. Simple questions and unchanged status require no writes.

Commit useful work records and shared knowledge intentionally, excluding sensitive information. Do not ignore `PROGRESS.md` merely because the old handoff was local state. At a validated milestone the agent recommends a commit and names its scope; it commits only when asked.

## Staying on the main line

For multi-step work and open-ended research, connect **outcome → gap/hypothesis → useful check → expected evidence → resulting decision**. Expand plans only enough to choose the next step, not into a mandatory goal tree. Reassess before substantial extra time, resources or user effort, and when repeated work yields no decision-relevant evidence.

Before a consequential recommendation, the agent explains why it advances the goal, what it is expected to change, its main cost/risk and what it defers. For example: “We can choose A or B once latency is measured. I recommend one representative benchmark; a broader method survey is deferred because it cannot settle that gap.” Agreement approves that described scope, not an unlimited exploration mandate.

This is not an approval gate for every action. Routine steps remain autonomous; useful exploration gets a decision question and a stop/return condition. New evidence can justify revising the plan. Stage completion compares expected and actual outcomes, rather than counting tasks as goal attainment. No mandatory goal tree, extra planning file, every-turn report or forced continuation hook is added.

Execution efficiency is part of that goal: before costly work or a long wait, look for unnecessary serialization, repeated computation and valid reusable results. Implement safe in-scope improvements without waiting for the user to notice, while preserving outputs, coverage and resource limits. Avoid replacing waiting with an open-ended optimization project.

See the [behavior acceptance scenarios](plugin/README.md#behavior-acceptance), including the [lossless-efficiency replay](plugin/README.md#lossless-efficiency-replay), for both progress and restraint checks. Preserving goal text is automatically tested; proactive judgment and actual savings still need live-session validation.

## How to know it's working

You should notice practical changes in agent behavior:

- New chats recover the goal and current conclusion from the work record.
- Agents use `.agent-context/ARCHITECTURE.md` to locate relevant modules instead of scanning everything.
- Validation results explain what was checked and what remains unknown.
- Work history explains why a conclusion changed; next checks explain what decision they will inform.
- Lessons from mistakes show up in `.agent-context/MEMORY.md` instead of disappearing with the chat.
- Diffs stay focused because the core rule tells agents to keep edits tied to the user's request.

## Installation

Install with the script — it is the only supported path:

```bash
git clone https://github.com/zhuantouer/agentic-protocol.git ~/workspace/agentic-protocol
cd ~/workspace/agentic-protocol
./scripts/install-local.sh          # Cursor (default)
./scripts/install-local.sh codebuddy
./scripts/install-local.sh dsh      # DeepSeek Harness (every profile)
./scripts/install-local.sh all      # Cursor + Codex + CodeBuddy
```

**Cursor:** copies into `~/.cursor/plugins/local/`. Cursor **rejects symlinks** to paths outside that directory (`0 plugins loaded` in Cursor Plugins log). Re-run after editing, then **Developer: Reload Window**. Verify under **Settings → Plugins → Installed**.

**CodeBuddy:** copies into `~/.codebuddy/plugins/marketplaces/agentic-protocol-marketplace/plugins/agentic-protocol/` and registers that directory marketplace in `known_marketplaces.json`. The plugin source in `marketplace.json` is `./plugins/agentic-protocol`, which stays inside the marketplace. CodeBuddy 5.0 rejects a source that resolves outside it, and a directory marketplace is used in place, so the marketplace must not point at this repository either. If `codebuddy` is on `PATH`, the script also runs `plugin marketplace add` and `plugin install`. Then `/reload-plugins`. The protocol comes from the plugin's `rules/*.mdc`; the 5.0 build that dropped `.mdc` plugin rules needs the host fix before those rules load. No session hook is needed.

**Codex:** copies into `~/.codex/plugins/` and runs `codex plugin add agentic-protocol@personal`. Restart Codex and trust plugin hooks; Codex has no `rules/` slot, so without trust there is no protocol injection.

**DeepSeek Harness:** the bundle at [`dsh/`](dsh/README.md) is a Cordis plugin rather than a rules directory. The installer copies it to `$DSH_HOME/plugins/agentic-protocol`, links it into every profile that has a `package.json`, and adds it to `dsh.profile.bundles`. The rule body then registers as a system-prompt section and the three skills join the session catalog through `ctx.skills`. The app can apply the profile live; if a new session does not show the section, quit and reopen DeepSeek Harness.

## Skills

Skills follow the [Agent Skills](https://cursor.com/cn/docs/skills) format (`skills/<name>/SKILL.md`). The agent invokes them automatically when relevant, or you can trigger them manually with `/skill-name` in chat.

| Skill | Auto trigger | Manual |
|-------|--------------|--------|
| `bootstrap-context` | Missing context before substantive work; knowledge updates (structure, commands, config, conventions, decisions) | `/bootstrap-context` |
| `update-progress` | Goal/plan changes, stage outcomes; status queries without rewriting unchanged state | `/update-progress` |
| `run-review` | Before an irreversible or costly execution, after landing work, or before a claim enters project memory — dispatches an independent review of the raw artifacts | `/run-review` |

## Rules

| Rule | Scope | Description |
|------|-------|-------------|
| `agentic-protocol-core.mdc` | `alwaysApply: true` | Minimal operating protocol — recovery order, canonical file ownership, safety checks, and memory hygiene |

See [Cursor Rules docs](https://cursor.com/cn/docs/rules) for how `alwaysApply` rules are injected into every session.

## Hooks

- `sessionStart` is registered for Codex only, which has no `rules/` slot: it delivers the protocol text. The work record is never injected — the protocol tells the agent to read `PROGRESS.md` itself, so there is one source of truth instead of an excerpt that can silently omit a constraint.

## Upgrading older projects

Update the plugin and reload the host first. Old progress files and `HANDOFF.md` remain readable; `Current State` still identifies authoritative current state, so dated logs do not require a new recovery format. On a substantive update or explicit migration, `update-progress` moves embedded history to dated logs, verifies preserved entries and links, then replaces detail with coarse milestones. Keep original dates; ambiguous dates/ranges remain labelled in an import section, not falsely attributed to today. Existing daily entries must not be overwritten or duplicated.

The plugin was renamed from `agent-context` to `agentic-protocol`. The project record directory keeps its name, so `.agent-context/` needs no migration. After reinstalling, delete the stale `agent-context` copies under `~/.cursor/plugins/local/`, `~/.codex/plugins/` and `~/.codebuddy/plugins/` if a host still lists them; the Codex installer drops the old marketplace entry on its own.

No hook or installer edits project records. Legacy files can remain untouched; delete one only after its useful content is preserved and cleanup is authorized. The handoff skill is retired. Older plugin versions do not recover the unified record, so downgrading is not a reason to maintain duplicate state.

## Development

Validate plugin structure and hook behavior:

```bash
node scripts/validate-template.mjs
python3 scripts/test-hooks.py
./scripts/bump-version.sh --check
```

CI (`.github/workflows/ci.yml`) runs the same three commands on pushes to `main` and on pull requests.

The shipped version lives in `VERSION`; `./scripts/bump-version.sh 2.0.2` writes it and all three host manifests at once. Do not hand-edit a manifest `version` — `--check` and CI fail on drift.

Bootstrap avoids Unix-only scan commands in generated guidance. Prefer Cursor file tools, `rg`, or `git ls-files` so the workflow works across macOS, Linux, and Windows-style environments.

## TODO — more hosts

Cursor, Codex, and CodeBuddy work today. Claude Code, OpenCode, and Pi do not yet. PRs welcome; keep changes small and follow the invariants below.

| Host | Rough approach |
|------|----------------|
| **Claude Code** | Closest to CodeBuddy's hook I/O. Add `.claude-plugin/plugin.json`, point hooks at the existing Python scripts. No session hook is needed. |
| **OpenCode** | Thin JS/TS plugin in `opencode.json`. Deliver the protocol via `experimental.chat.messages.transform`, register `skills/` via the `config` hook (same pattern as [Superpowers for OpenCode](https://github.com/obra/superpowers/blob/main/docs/README.opencode.md)). Spawn the existing Python hooks instead of rewriting them. |
| **Pi** | A pi package (`pi.skills` + `pi.extensions`). Deliver the protocol on `before_agent_start`, advisory nudge on `agent_settled`. Again: call the Python hooks; don't fork the protocol. |

**Invariants for any host PR:** one canonical `rules/agentic-protocol-core.mdc` (every host reads it; none restate it); the work record is read by the agent, never injected; skills stay host-neutral; if a host adds a Stop/settled nudge it stays advisory (no forced continuation) — no host registers one today.

## Philosophy

Inspired by AgenticMetaEngineering (Tencent-internal, by r***hou), [Superpowers](https://github.com/obra/superpowers) and [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills), but **radically simplified**:

- **No 8-stage workflow.** No gate audits. No mandatory worktrees.
- **No 20+ plugins.** One plugin, one rule file, three skills.
- **No per-requirement directory scaffolding.** Just `.agent-context/`.
- **The agent maintains the context, not you.** You just code.

The key insight from AME: **LLM context window is "working memory"; files are the "hard drive."** Move everything that needs to persist out of the conversation and into files. But unlike AME, we don't wrap that in a heavy process framework — just a lightweight rule that tells the agent to do it automatically.

Optimize for useful work, not paperwork: keep one short state map, load dated evidence and supporting knowledge only when needed, and evaluate both goal progress and unnecessary reads, writes and approval requests. No prompt or hook can prove that a research direction is valuable; that requires observable decisions and outcomes.

## License

[MIT](LICENSE)
