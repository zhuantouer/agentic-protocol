# Project Commands

## Setup
- Install deps: No package manager setup detected.

## Development
- Validate plugin structure (every host): `node scripts/validate-template.mjs`
- Hook and packaging tests (Python unittest; packaging cases also require Node/Bash): `python3 scripts/test-hooks.py`

## Validation Profile
- Plugin rules, skills, hooks, manifests or docs: `node scripts/validate-template.mjs` — it validates the single `plugin/` package; there are no marketplace indexes to check.
- Always-applied rule edits: the validator fails if the whole rule file exceeds 6000 characters, the CodeBuddy injection budget, because an over-budget rule is dropped silently while still reported as loaded. It warns past 5700 with the remaining margin. Compress wording or move on-demand detail into a skill; never raise the limit to fit. A passing check does not prove the text reached the model — confirm in a fresh chat after an authorized reload.
- Hook script changes: the validator, plus `python3 scripts/test-hooks.py`, plus `bash -n` on the `.sh` entries. The smoke tests below stay useful for eyeballing real output, but the test suite is what must pass.
- Release metadata/installer changes: the same suite checks cross-host manifest version mismatches, the single-package layout (no `plugins/` nesting, no marketplace index at the root) and generated-file exclusion using temporary repositories/HOME; it never installs into the user's real HOME. Also run `bash -n scripts/install-local.sh`.
- `update-progress` template changes: the suite checks map/log partition and selected text contracts for goal ownership, retained acceptance criteria, independent evidence writes and map-only compactness. These are not acting-agent behavior tests. Use [Goal and evidence replay](../plugin/README.md#goal-and-evidence-replay) for fixed-input cases; inspect actual record changes in isolated tool-enabled sessions before claiming behavioral acceptance.
- Prompt-edit test constraints: retain the two `markdown` template fences and recovery headings. The suite also pins `# Work Log — YYYY-MM-DD`, the example `## Pilot`, and requires any line containing `touched files` to include `do not list touched files` (case-insensitive). These are current test assertions, not a reason to freeze unrelated prose or `verified against` capitalization.
- History migration: compare every source entry and deferred detail with destination text before removing it; verify local linked files and headings, including ambiguous dates/ranges. Do not treat counts alone as content preservation.
- Goal-alignment and execution-efficiency behavior: start with `plugin/README.md#minimal-decision-replay`; tools-disabled output is only a preflight. Full behavior acceptance still requires tool-enabled isolated tasks through actual plugin loading after authorized installation/reload. Compare spontaneous discovery, safe action, preserved results and total cost; automated checks do not prove judgment or savings.
- Docs-only changes: manual review; run structure validation if plugin metadata, skills, hooks, or rules changed.

## Hook Smoke Tests
Run from the repository root with `S=plugins/agentic-protocol/hooks/scripts` and `R=$PWD`.

- Codex session start (expect `hookSpecificOutput.additionalContext` containing the protocol body — the rule minus frontmatter, no work-record content; measured against the configured 10000 approximate-token threshold, not a character cap; current upstream estimates `ceil(UTF-8 bytes / 4)`, checked with ASCII and multibyte fixtures):
  `echo "{\"cwd\":\"$R\"}" | python3 $S/session-context.py codex`
- Cursor and CodeBuddy configure no hooks (`hooks.json` and `codebuddy-hooks.json` are `{"hooks": {}}`) — both load the rule through `rules/`. Nothing to smoke-test here; verify instead that a fresh session actually receives the rule.

## Verifying a Live Codex Install
The smoke tests only prove the scripts work, not that Codex runs them. To check the real install:
- Install state, the first thing to check: `codex plugin list` (CLI lives at `/Applications/ChatGPT.app/Contents/Resources/codex`). Expect `agentic-protocol@personal  installed, enabled`. A status of `not installed` means the marketplace entry exists but Codex never snapshotted the plugin, and the desktop UI hides it — fix with `codex plugin add agentic-protocol@personal`.
- Marketplace discovery: `codex plugin marketplace list` — `personal` with root `$HOME` must be listed.
- The bytes Codex actually runs live in `~/.codex/plugins/cache/personal/agentic-protocol/<version>/`, not in `~/.codex/plugins/agentic-protocol/`. Smoke-test that copy when debugging a live install.
- Plugin load errors: `sqlite3 ~/.codex/logs_2.sqlite "SELECT datetime(ts,'unixepoch','localtime'), level, substr(feedback_log_body,1,150) FROM logs WHERE target LIKE '%plugins%' AND level='WARN' ORDER BY id DESC LIMIT 10;"` — a `configured non-curated plugin no longer exists in discovered marketplaces` warning means `~/.codex/config.toml` enables a plugin name the marketplace does not declare.
- Enabled names must match: compare `rg 'agentic-protocol' ~/.codex/config.toml` against the `name` in `~/.agents/plugins/marketplace.json`.
- In the app: the plugin appears under Plugins, and a new session flashes the `statusMessage` from `hooks/codex-hooks.json` ("加载 Agentic 方法论").
- Behavioral: ask where current conclusions and detailed history belong. Expect `PROGRESS.md` for goal/now/milestones, `worklog/YYYY-MM-DD.md` for evidence, no daily handoff or write on unchanged status. Run the linked replay, including date gaps and interleaved tasks.

## Build & Deploy
- Build: No build step detected.
- Local install: `./scripts/install-local.sh [cursor|codex|codebuddy|all]` (defaults to `cursor`).

## Custom Scripts
- `./scripts/install-local.sh` — copies the plugin to `~/.cursor/plugins/local/` (Cursor), `~/.codex/plugins/` plus a merged entry in `~/.agents/plugins/marketplace.json` (Codex), and/or `~/.codebuddy/plugins/marketplaces/agentic-protocol-marketplace/plugins/agentic-protocol/` (CodeBuddy). The CodeBuddy `marketplace.json` source is `./plugins/agentic-protocol`; a path that leaves the marketplace directory is rejected by CodeBuddy 5.0. The script updates only the `agentic-protocol-marketplace` key in `~/.codebuddy/plugins/known_marketplaces.json`, and runs `codebuddy plugin install` when the CLI is on `PATH`. Never point that marketplace at the repository: a directory marketplace is used in place, so the rule would load from the source tree.
- `node scripts/validate-template.mjs` — validates every host's manifests, marketplaces, rules, skills, hooks, and referenced assets; asserts shared content stays host-neutral and that host event names do not cross over.

## Command Notes
- Run commands from the repository root unless a command states otherwise.
- Cursor needs "Developer: Reload Window" after reinstalling; Codex needs a restart and an explicit hook-trust approval before its hooks run; CodeBuddy needs `/reload-plugins` (or an IDE restart).
- The validator checks structure and reports the always-applied rule's size: a review warning past 4200 chars and a stronger warning past 6000. Neither size warning fails the run; only objective structure/drift errors do. Hook behaviour is covered by `scripts/test-hooks.py`, which builds a throwaway git repo per test.
- `scripts/test-hooks.py` commits its fixture before asserting: git collapses an untracked directory into a single `?? .agent-context/` entry, which hides which file a turn actually touched.
