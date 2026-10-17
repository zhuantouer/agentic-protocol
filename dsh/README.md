# Agentic Protocol for DeepSeek Harness

A native [DSH](https://github.com/deepseek-ai/deepseek-harness) Cordis bundle for the
[agentic-protocol](../README.md) plugin. It has no daemon, no MCP server and no
dependencies beyond Node builtins.

## What it mounts

| Surface | How |
|---|---|
| Skills | `bootstrap-context`, `update-progress` and `run-review` register on `ctx.skills`, so they join the session catalog and load on demand — including as `/bootstrap-context`, `/update-progress` and `/run-review`. |
| Protocol | `rules/agentic-protocol-core.mdc` is registered as one system-prompt section — `agentic-protocol:core`, order 100 — on `ctx.systemPrompt`. |

The protocol is a **prompt section, not session context**, and that distinction is the
whole point. The loop re-renders the prompt for every request into surface node 0,
which `dsh-compaction-basic` never shadows: its compactable range starts at node 1
whenever node 0 holds the system message. A message injected with `agent.inject()` at
`agent/session-start` is ordinary history instead — nothing in the host re-injects it
after condensation, so a long session would silently replace the protocol with a
summary. The section is also where Cursor and CodeBuddy already load the same text:
an always-applied rule.

Order 100 puts it after the deployment persona (0) and before every policy and tool
section (500 and up), so the method is read before tool guidance, and its tokens sit
ahead of the sections that can change. The text is read once at mount and registered
as a **static string**: a per-assembly function would re-read a file on every request,
and a section whose rendered text changes mid-series is *appended* as a new system
message on an `in-history` route, duplicating the prompt and destroying the provider's
reusable prefix. A consequence worth knowing: a rule edit needs a plugin reload rather
than reaching the next session.

Section text is interpolated by the prompt registry, which treats `{{name}}` as a
variable group and throws when it is unresolved — with no escape syntax. So the rule
body must stay free of `{{`. `scripts/validate-template.mjs` rejects it at the source,
and the bundle refuses to register such a body rather than fail every request.

The work record is never injected. The protocol tells the agent to read
`PROGRESS.md` itself, which keeps one source of truth instead of an excerpt that can
silently omit a constraint.

## Install

The desktop app runs the `desktop` profile and installs no `dsh` binary on `PATH`, so
the repository ships a Node installer that edits the profile directly:

```bash
node scripts/install-dsh.mjs                    # every profile under $DSH_HOME/profiles
node scripts/install-dsh.mjs --profile desktop  # only the desktop app
node scripts/install-dsh.mjs --dry-run
```

On macOS and Linux the same installer runs through `./scripts/install-local.sh dsh`.

It refreshes `skills/` and `rules/` from `plugin/`, copies the bundle to
`$DSH_HOME/plugins/agentic-protocol`, records
`"dsh-agentic-protocol": "link:<bundle>"` in the profile's `package.json`, adds the
package to `dsh.profile.bundles`, and links it into the profile's `node_modules`.
Those are the three steps `dsh plugin --profile <name> add <path>` takes; the
installer performs them itself because a desktop install has no CLI on `PATH`.

**The profile is not cosmetic.** The host composes `dsh.profile.bundles` from each
profile's own `package.json`, so a bundle mounted in one profile is invisible to every
other — the desktop app boots `desktop`, `dsh web` boots `web`, and a Tauri build
boots `tauri`.

The running app can apply a profile change live — the section appeared without a
restart during verification. If a new session does not show it, quit and reopen
DeepSeek Harness: the protocol section is read once when the plugin mounts, and
skill discovery picks the provider up at the same time.

Installing from a checkout without copying also works through the app's own
installer, which additionally writes `pnpm-lock.yaml` and runs the bundle
compatibility preflight: the Plugins page (**Add plugin**) accepts an absolute
directory path, and the desktop carrier CLI does the same while the app is closed
(default Windows install):

```powershell
$env:ELECTRON_RUN_AS_NODE=1
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe" --expose-internals `
  "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add "$PWD\dsh"
```

The plain `dsh` CLI refuses `desktop` — the app owns that profile — and so does
`--dump-config` for it; verify the install from the Plugins page or the profile's
`package.json`.

## Layout

| Path | Role |
|---|---|
| `index.mjs` | Plugin entry: `name`, `inject`, `apply`, plus the exported units the tests drive |
| `cordis.patch.yml` | The `insert:` patch the loader applies for this bundle |
| `package.json` | Declares `dsh.bundle.patch`; its `version` tracks the root `VERSION` |
| `skills/`, `rules/` | Committed copies of `../plugin/skills` and `../plugin/rules`, written by `scripts/sync-dsh-bundle.mjs` |

`index.mjs` imports Node builtins only. A profile links this package from outside
its own package tree, so an import of a `@deepseek-ai/*` host package would resolve
from this package's real path and fail. The prompt section is contributed through the
injected `ctx.systemPrompt` service, which needs no import at all. Both
`scripts/validate-template.mjs` and the test suite enforce that ban.

`skills/` and `rules/` are generated, never edited by hand: `node
scripts/sync-dsh-bundle.mjs` rewrites them from `plugin/`, `--check` fails on drift,
and CI runs that check before validating.

## Why not the hook bridge

DSH ships `@deepseek-ai/dsh-hooks-codex`, which can run the plugin's existing
`hooks/codex-hooks.json`. It is a worse fit here: the command string relies on
`${PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}`, which the Codex bridge does not substitute and
does not inject as a plugin environment, so the path resolves to `/hooks/scripts/...`
and the hook fails silently. `SessionStart` there also runs detached, so its context
can miss the first request. The bundle registers a prompt section directly and needs
no hook at all.

## Verification

```bash
node scripts/test-dsh-bundle.mjs          # drives the real module against a fake Cordis context
node scripts/sync-dsh-bundle.mjs --check  # proves the committed projection is current
```

The functional suite covers the catalog, the loaded bodies, the registered prompt
section, the strict invocation grammar, and the three fault paths (unreadable rule
file, an interpolated rule body, absent generated skills). It is a contract-level
check against the host API as published in `@deepseek-ai/dsh-skill` and
`@deepseek-ai/dsh-system-prompt`; a live-session acceptance run in DSH is still the
only way to observe the behavior end to end.

## Scope

Skills and the protocol prompt section are supported. Hooks are not registered, and
the bundle publishes nothing to npm — this repository installs from a local copy only.
