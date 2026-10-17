/**
 * Agentic Protocol for DeepSeek Harness — a native Cordis bundle.
 *
 * Two surfaces, both fed from files inside this package:
 *
 *   - `skills/` registers the authored skills — `bootstrap-context`,
 *     `update-progress` and `run-review` — on `ctx.skills`, so they join the
 *     session catalog and load on demand.
 *   - `rules/agentic-protocol-core.mdc` is registered as one system-prompt
 *     section on `ctx.systemPrompt` — the same canonical text the Codex host
 *     receives from its session hook, never a restatement written for this host.
 *
 * The section placement is deliberate, not cosmetic. `dsh-compaction-basic`
 * selects its compactable range with `firstIdx = systemHead(...) === undefined
 * ? 0 : 1`, so surface node 0 is never shadowed when it holds the system
 * message, and the prompt registry re-renders that node for every request. A
 * session-start `agent.inject()` message is instead ordinary history: nothing in
 * the host re-injects it after condensation, and no `'compact'` session-start is
 * ever emitted (both verified against the installed host on 2026-09-21). The
 * section is what makes the protocol survive a long session.
 *
 * The text is read once at mount and registered as a **static string**, which is
 * load-bearing twice over: a per-assembly function would re-read a file on every
 * request, and a section whose rendered text changes mid-series is *appended* as
 * a new system message on an `in-history` route — duplicating the prompt in the
 * request and destroying the provider's reusable prefix. A module-level read
 * also means a rule edit needs a plugin reload rather than reaching the next
 * session; `install-local.sh` copies the files at install time, so this changes
 * little in practice.
 *
 * `{{` is refused rather than registered. Section text passes through the
 * registry's `interpolate()`, which throws on an unknown or malformed
 * `{{name}}` group, and rendering runs once per request — so a rule body
 * containing one would fail every step of every session. The host has no escape
 * syntax, and a broken prompt is a far worse outcome than a missing one, so this
 * warns and registers nothing. `scripts/validate-template.mjs` and the bundle
 * tests reject the same shape at the source, where it can actually be fixed.
 *
 * The work record (`.agent-context/`) is never injected: the protocol tells the
 * agent to read `PROGRESS.md` itself, so there is one source of truth instead of
 * an excerpt that can silently omit a constraint.
 *
 * This module imports nothing but Node builtins on purpose. A profile installs
 * the bundle outside its own package tree (`dsh plugin --profile <name> add`
 * forwards to `pnpm add`, which links the package directory), so a bare import
 * of a `@deepseek-ai/*` host package would resolve from this package's real path
 * and fail. The prompt section is contributed through the injected
 * `ctx.systemPrompt` service, which needs no import at all.
 *
 * @module dsh-agentic-protocol
 */

import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** Cordis plugin name; also the `plugin` field of every injected message source. */
const name = "agentic-protocol";

/**
 * Services this bundle needs. `skills` carries the catalog; `systemPrompt` is
 * the registry the protocol section is contributed to, and both are present in
 * any composition that runs agents.
 */
const inject = ["skills", "systemPrompt"];

/** Provider name registered on `ctx.skills`. */
const PROVIDER_NAME = "agentic-protocol";

/** Skill source label reported to the registry. */
const SKILL_SOURCE = "agentic-protocol";

/**
 * Provider rank. The filesystem provider scans project roots at 100–200, custom
 * roots at 300 and user roots at 400–500, and the bundled `dsh-badge` provider
 * sits at `BUNDLED_SKILL_RANK` (600). 550 keeps a project's or user's own copy
 * of a skill authoritative while staying clear of the bundled provider.
 */
const SKILL_RANK = 550;

/** The one canonical protocol text, relative to this package root. */
const PROTOCOL_RELATIVE_PATH = join("rules", "agentic-protocol-core.mdc");

/**
 * Prompt-section name, namespaced like every first-party section
 * (`harness:identity`, `deployment:persona-prefix`, `plan:policy`). Stable on
 * purpose: a deployment that wants a different method can register a same-named
 * section through an agent scope and shadow this one.
 */
const PROTOCOL_SECTION_NAME = "agentic-protocol:core";

/**
 * Prompt placement, as a literal number because `getSectionOrder()` is a lookup
 * into the registry's own `SECTION_ORDERS` table and returns `undefined` for a
 * name it does not own — which `section()` then rejects as a non-finite order.
 *
 * That table runs `HARNESS_IDENTITY` −1000, `DEPLOYMENT_PERSONA_PREFIX` 0,
 * `PLAN_POLICY` 500, `TEAM_POLICY` 600, tool guidance 1000–2900, `TOOLS_SDK`
 * 5000, `HARNESS_SOURCE` 10000, `WEB_SURFACE` 10100,
 * `DEPLOYMENT_PERSONA_SUFFIX` 10200. 100 is the deliberate gap between the
 * deployment persona and the first policy: the method is read before any tool
 * guidance, and its tokens sit ahead of every section that can change, so later
 * prompt churn no longer invalidates them.
 */
const PROTOCOL_SECTION_ORDER = 100;

/**
 * The opening of a prompt-variable group. Section text is interpolated by the
 * registry, so this sequence anywhere in the rule body would make every prompt
 * render throw; the host offers no escape syntax. See the module doc.
 */
const PROMPT_VARIABLE_OPEN = "{{";

/** Frontmatter keys whose value must be a boolean in DSH's documented grammar. */
const BOOLEAN_FORMS = new Map([
  ["true", true],
  ["yes", true],
  ["on", true],
  ["1", true],
  ["false", false],
  ["no", false],
  ["off", false],
  ["0", false],
]);

/** Kebab-case skill name, the shape the registry accepts. */
const SKILL_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * A frontmatter block: `---` on the first line, closed by `---` on its own line.
 * `\r?\n` throughout, because the same authored file reaches this module as LF
 * on a Linux checkout and as CRLF on a Windows one (`core.autocrlf`).
 */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function warn(ctx, message) {
  try {
    ctx?.logger?.warn?.(message);
  } catch {
    // Logging must never be the reason protocol delivery fails.
  }
}

/**
 * Split YAML frontmatter from a body, leading blank lines removed.
 * @param text - complete file content.
 * @returns the raw frontmatter and the body, or `undefined` when there is no block.
 */
function splitFrontmatter(text) {
  const match = FRONTMATTER.exec(text);
  if (!match) return undefined;
  return { source: match[1], body: text.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, "") };
}

/**
 * Parse the flat `key: value` subset of YAML the skill format uses — the same
 * subset the first-party filesystem provider accepts.
 * @param text - complete file content.
 * @returns the flat metadata plus the body, or `undefined` when there is no frontmatter.
 */
function parseFrontmatter(text) {
  const split = splitFrontmatter(text);
  if (!split) return undefined;

  const metadata = {};
  for (const rawLine of split.source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    metadata[key] = value;
  }

  return { metadata, body: split.body };
}

/**
 * Resolve one optional invocation key against DSH's strict boolean grammar.
 * @param metadata - parsed frontmatter.
 * @param key - frontmatter key name.
 * @returns the boolean, `undefined` when the key is absent, or `null` when the
 * spelling is rejected — an invalid value must drop the skill rather than
 * silently permit a surface it tried to close.
 */
function readInvocationFlag(metadata, key) {
  const raw = metadata[key];
  if (raw === undefined) return undefined;
  const parsed = BOOLEAN_FORMS.get(raw.toLowerCase());
  return parsed === undefined ? null : parsed;
}

/**
 * Build one catalog candidate from a skill file.
 * @param text - complete `SKILL.md` content.
 * @returns the candidate fields plus the parsed body, or `undefined` when the
 * skill is not publishable.
 */
function parseSkill(text) {
  const parsed = parseFrontmatter(text);
  if (!parsed) return undefined;
  const { metadata, body } = parsed;

  const skillName = metadata.name;
  const description = metadata.description;
  if (!skillName || !SKILL_NAME.test(skillName) || !description) return undefined;

  const modelDisabled = readInvocationFlag(metadata, "disable-model-invocation");
  const userInvocable = readInvocationFlag(metadata, "user-invocable");
  if (modelDisabled === null || userInvocable === null) return undefined;

  return {
    metadata,
    body,
    name: skillName,
    description,
    ...(metadata.whenToUse ? { whenToUse: metadata.whenToUse } : {}),
    invocation: {
      modelInvocable: modelDisabled !== true,
      userInvocable: userInvocable !== false,
    },
  };
}

/**
 * Create the skill provider for one `skills/` root.
 * @param skillsRoot - directory holding one `<name>/SKILL.md` bundle per skill.
 * @param log - warning sink for entries that are skipped.
 * @returns a provider the skill registry can call.
 */
function createProvider(skillsRoot, log = () => {}) {
  async function readSkills(signal) {
    let entries;
    try {
      entries = await readdir(skillsRoot, { withFileTypes: true });
    } catch {
      log(`no generated skills at ${skillsRoot}; run node scripts/sync-dsh-bundle.mjs`);
      return [];
    }

    const skills = [];
    for (const entry of entries) {
      if (signal?.aborted) return skills;
      if (!entry.isDirectory()) continue;
      const directory = join(skillsRoot, entry.name);
      const path = join(directory, "SKILL.md");
      let text;
      try {
        text = await readFile(path, "utf8");
      } catch {
        log(`skill '${entry.name}' has no readable SKILL.md; skipped`);
        continue;
      }
      const skill = parseSkill(text);
      if (!skill) {
        log(`skill '${entry.name}' is not publishable (name, description or invocation value); skipped`);
        continue;
      }
      skills.push({ ...skill, directory, path });
    }
    return skills;
  }

  /** Registry fields shared by the catalog entry and the loaded body. */
  function catalogFields(skill) {
    return {
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
      invocation: skill.invocation,
      source: SKILL_SOURCE,
      provider: PROVIDER_NAME,
      rank: SKILL_RANK,
    };
  }

  return {
    name: PROVIDER_NAME,
    async list(options = {}) {
      const skills = await readSkills(options.signal);
      return skills.map((skill) => ({ ...catalogFields(skill), locator: skill.directory, path: skill.path }));
    },
    async get(candidate, options = {}) {
      if (options.signal?.aborted) return undefined;
      let text;
      try {
        text = await readFile(candidate.path, "utf8");
      } catch {
        return undefined;
      }
      const skill = parseSkill(text);
      if (!skill) return undefined;
      return {
        ...catalogFields(skill),
        resourceBase: { kind: "directory", path: candidate.locator },
        path: candidate.path,
        metadata: skill.metadata,
        content: skill.body,
      };
    },
  };
}

/**
 * Read the canonical protocol without its rule frontmatter — the same body the
 * Python session hook delivers to Codex. The read is synchronous on purpose: it
 * runs during mount, before any assembly, so the section is registered before
 * the first request can render. One read per host process is the whole cost.
 * @param packageRoot - this package's directory.
 * @returns the protocol text, or `''` when the file is absent.
 */
function readProtocol(packageRoot) {
  let text;
  try {
    text = readFileSync(join(packageRoot, PROTOCOL_RELATIVE_PATH), "utf8");
  } catch {
    return "";
  }
  const split = splitFrontmatter(text);
  return (split ? split.body : text).trim();
}

/**
 * Register the protocol as one system-prompt section. An absent or unreadable
 * rule file, or a body the prompt registry would interpolate, leaves the
 * composition otherwise untouched rather than failing the mount: the skills must
 * keep working, and no prompt at all is a better outcome than a prompt that
 * throws on every request.
 * @param ctx - Cordis context carrying `systemPrompt` and the logger.
 * @param packageRoot - this package's directory.
 * @returns the registration disposer, or `undefined` when nothing was registered.
 */
function registerProtocol(ctx, packageRoot) {
  const protocol = readProtocol(packageRoot);
  if (!protocol) {
    warn(ctx, `${name}: no readable ${PROTOCOL_RELATIVE_PATH}; run node scripts/sync-dsh-bundle.mjs`);
    return undefined;
  }
  if (protocol.includes(PROMPT_VARIABLE_OPEN)) {
    warn(
      ctx,
      `${name}: refusing to register ${PROTOCOL_RELATIVE_PATH} — it contains "${PROMPT_VARIABLE_OPEN}", which the prompt registry interpolates and rejects when unresolved; remove it or the section would fail every request`,
    );
    return undefined;
  }
  try {
    return ctx.systemPrompt.section({
      name: PROTOCOL_SECTION_NAME,
      order: PROTOCOL_SECTION_ORDER,
      text: protocol,
    });
  } catch (error) {
    warn(ctx, `${name}: protocol section registration failed: ${String(error)}`);
    return undefined;
  }
}

/**
 * Mount the bundle: register the skill provider and the protocol prompt section.
 * @param ctx - Cordis context.
 */
function apply(ctx) {
  const packageRoot = dirname(fileURLToPath(import.meta.url));

  ctx.skills.registerProvider(() => createProvider(join(packageRoot, "skills"), (message) => warn(ctx, `${name}: ${message}`)));

  registerProtocol(ctx, packageRoot);
}

export {
  apply,
  createProvider,
  inject,
  name,
  parseFrontmatter,
  parseSkill,
  readProtocol,
  registerProtocol,
};
export default { apply, name, inject };
