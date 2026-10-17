#!/usr/bin/env node

/**
 * Functional tests for the DeepSeek Harness bundle at `dsh/`.
 *
 * These drive the real module — the skill provider and the protocol prompt
 * section — against a fake Cordis context, and compare both surfaces with the
 * authored `plugin/` copies. They are the only check that proves the bundle
 * actually publishes every authored skill and registers the one canonical protocol
 * body; the Python suite covers projection drift and the installer instead.
 *
 *   node scripts/test-dsh-bundle.mjs            # test the checkout in cwd
 *   node scripts/test-dsh-bundle.mjs --root DIR # test another checkout
 */

import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  let root = process.cwd();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      const value = argv[index + 1];
      if (!value) {
        console.error("--root needs a directory");
        process.exit(2);
      }
      root = path.resolve(value);
      index += 1;
    } else {
      console.error(`unknown argument: ${argv[index]}`);
      process.exit(2);
    }
  }
  return root;
}

/**
 * Independent strip: locate the closing delimiter by line, then drop the block
 * and its leading blank lines. Returns LF-joined text, so every comparison also
 * normalizes the module's verbatim body — `core.autocrlf` means the same
 * authored file is CRLF in a Windows checkout and LF in CI.
 */
function stripFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  assert.equal(lines[0].trim(), "---", "expected a frontmatter block");
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  assert.ok(close > 0, "expected a closing frontmatter delimiter");
  return lines.slice(close + 1).join("\n").replace(/^(?:[ \t]*\n)+/, "");
}

/** Compare model-facing text without letting the checkout's line endings decide the result. */
function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

const root = parseArgs(process.argv.slice(2));
const bundleDir = path.join(root, "dsh");
const pluginDir = path.join(root, "plugin");

let passed = 0;
const failures = [];

async function check(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures.push(label);
    console.log(`  FAIL ${label}`);
    console.log(`       ${String(error.message).split("\n")[0]}`);
  }
}

/**
 * The two host surfaces the bundle touches. `on` is deliberately absent: the
 * bundle must contribute a prompt section rather than listen for a lifecycle
 * event, so a regression back to session-start injection fails here loudly
 * instead of passing quietly.
 */
function fakeContext() {
  const providers = [];
  const sections = [];
  const warnings = [];
  return {
    providers,
    sections,
    warnings,
    ctx: {
      skills: { registerProvider: (factory) => providers.push(factory) },
      systemPrompt: { section: (section) => sections.push(section) },
      logger: { warn: (message) => warnings.push(message) },
    },
  };
}

const bundle = await import(pathToFileURL(path.join(bundleDir, "index.mjs")).href);

/**
 * Derive the expected catalog from the authored tree instead of restating it,
 * so adding a skill under `plugin/skills/` cannot leave the bundle's published
 * set silently behind the source.
 */
const canonicalSkills = (await fs.readdir(path.join(pluginDir, "skills"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

console.log(`Testing the DSH bundle in ${root}\n`);

await check("apply() registers one skill provider and one protocol prompt section", () => {
  const { ctx, providers, sections, warnings } = fakeContext();
  bundle.apply(ctx);
  assert.equal(providers.length, 1, "one skill provider");
  assert.equal(typeof providers[0], "function", "the provider is deferred behind a factory");
  assert.equal(sections.length, 1, "one prompt section");
  assert.equal(sections[0].name, "agentic-protocol:core");
  assert.equal(sections[0].order, 100, "a literal order: getSectionOrder owns only its own table");
  assert.equal(warnings.length, 0);
  assert.equal(bundle.name, "agentic-protocol");
  assert.deepEqual([...bundle.inject].sort(), ["skills", "systemPrompt"]);
});

await check("the catalog publishes exactly the authored skills", async () => {
  const { ctx, providers } = fakeContext();
  bundle.apply(ctx);
  const catalog = await providers[0]().list({});
  assert.deepEqual(
    catalog.map((entry) => entry.name).sort(),
    [...canonicalSkills].sort(),
  );
  for (const entry of catalog) {
    assert.ok(entry.description.length > 0, `${entry.name} has a description`);
    assert.equal(entry.provider, "agentic-protocol");
    assert.equal(entry.source, "agentic-protocol");
    assert.equal(entry.rank, 550);
    assert.deepEqual(entry.invocation, { modelInvocable: true, userInvocable: true });
  }
});

await check("a loaded skill body equals the authored SKILL.md without frontmatter", async () => {
  const { ctx, providers } = fakeContext();
  bundle.apply(ctx);
  const provider = providers[0]();
  const catalog = await provider.list({});
  for (const name of canonicalSkills) {
    const candidate = catalog.find((entry) => entry.name === name);
    assert.ok(candidate, `${name} is in the catalog`);
    const loaded = await provider.get(candidate, {});
    const authored = await fs.readFile(path.join(pluginDir, "skills", name, "SKILL.md"), "utf8");
    assert.equal(normalize(loaded.content), stripFrontmatter(authored), `${name} body`);
    assert.ok(!/^\s/.test(loaded.content), `${name} body starts at its first content line, with no stray CR or blank line`);
    assert.deepEqual(loaded.resourceBase, { kind: "directory", path: candidate.locator });
    assert.equal(loaded.metadata.name, name);
  }
});

await check("the registered section carries the canonical protocol as static text", () => {
  const { ctx, sections } = fakeContext();
  bundle.apply(ctx);
  const section = sections[0];
  const authored = readFileSync(path.join(pluginDir, "rules", "agentic-protocol-core.mdc"), "utf8");

  assert.equal(typeof section.text, "string", "static text, never a per-assembly function that could change mid-series");
  assert.equal(normalize(section.text), stripFrontmatter(authored).trim(), "the section text is the canonical rule body");
  assert.ok(!/^\s/.test(section.text), "the section text starts at its first content line");
  assert.ok(!/alwaysApply|^description:/m.test(section.text), "no rule frontmatter leaks into the prompt");
  assert.ok(!section.text.includes("{{"), "no prompt-variable group the registry would interpolate and reject");
  assert.ok(!("complete" in section), "not a complete prompt: every other section stays");
});

await check("an unreadable rule file registers nothing and warns instead of failing", () => {
  const { ctx, sections, warnings } = fakeContext();
  const missing = path.join(root, "no-such-package-root");
  assert.equal(bundle.readProtocol(missing), "");
  assert.equal(bundle.registerProtocol(ctx, missing), undefined);
  assert.equal(sections.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /sync-dsh-bundle/);
});

await check("a rule body the prompt registry would interpolate is refused, not registered", async () => {
  const fixtures = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-bundle-guard-"));
  try {
    await fs.mkdir(path.join(fixtures, "rules"), { recursive: true });
    await fs.writeFile(path.join(fixtures, "rules", "agentic-protocol-core.mdc"), "Work on {{cwd}} only.\n", "utf8");
    const { ctx, sections, warnings } = fakeContext();
    assert.equal(bundle.registerProtocol(ctx, fixtures), undefined);
    assert.equal(sections.length, 0, "an interpolated section would throw on every request, so register nothing");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /\{\{/);
  } finally {
    await fs.rm(fixtures, { recursive: true, force: true });
  }
});

await check("a missing generated skills directory lists nothing and warns", async () => {
  const messages = [];
  const provider = bundle.createProvider(path.join(root, "no-such-skills-root"), (message) => messages.push(message));
  assert.deepEqual(await provider.list({}), []);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /sync-dsh-bundle/);
});

await check("an aborted catalog request stops early without throwing", async () => {
  const { ctx, providers } = fakeContext();
  bundle.apply(ctx);
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await providers[0]().list({ signal: controller.signal }), []);
});

await check("the strict invocation grammar is applied and an invalid spelling drops the skill", async () => {
  const fixtures = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-bundle-test-"));
  const messages = [];
  try {
    const write = async (directory, frontmatter) => {
      await fs.mkdir(path.join(fixtures, directory), { recursive: true });
      await fs.writeFile(
        path.join(fixtures, directory, "SKILL.md"),
        `---\n${frontmatter}\n---\n\n# ${directory}\n`,
        "utf8",
      );
    };
    await write("plain", "name: plain\ndescription: A plain skill.");
    await write("closed-to-model", "name: closed-to-model\ndescription: Hidden from the model.\ndisable-model-invocation: Yes");
    await write("closed-to-humans", "name: closed-to-humans\ndescription: Hidden from commands.\nuser-invocable: 'off'");
    await write("bad-boolean", "name: bad-boolean\ndescription: Rejected spelling.\nuser-invocable: maybe");
    await write("bad-name", "name: Bad_Name\ndescription: Not kebab-case.");
    await write("no-description", "name: no-description");

    const provider = bundle.createProvider(fixtures, (message) => messages.push(message));
    const catalog = await provider.list({});
    assert.deepEqual(catalog.map((entry) => entry.name).sort(), ["closed-to-humans", "closed-to-model", "plain"]);
    const byName = new Map(catalog.map((entry) => [entry.name, entry]));
    assert.deepEqual(byName.get("plain").invocation, { modelInvocable: true, userInvocable: true });
    assert.deepEqual(byName.get("closed-to-model").invocation, { modelInvocable: false, userInvocable: true });
    assert.deepEqual(byName.get("closed-to-humans").invocation, { modelInvocable: true, userInvocable: false });
    assert.equal(messages.length, 3, "every skipped skill is reported");

    const withWhenToUse = await bundle.parseSkill("---\nname: x\ndescription: d.\nwhenToUse: When x.\n---\n\nbody\n");
    assert.equal(withWhenToUse.whenToUse, "When x.");
    assert.equal(bundle.parseSkill("no frontmatter"), undefined);
  } finally {
    await fs.rm(fixtures, { recursive: true, force: true });
  }
});

await check("the bundle imports no host package, so a linked install can resolve it from anywhere", async () => {
  const source = await fs.readFile(path.join(bundleDir, "index.mjs"), "utf8");
  for (const pattern of [/from\s+["']@deepseek-ai\//, /import\(\s*["']@deepseek-ai\//, /require\(\s*["']@deepseek-ai\//]) {
    assert.ok(!pattern.test(source), `index.mjs must not import a host package (${pattern})`);
  }
});

await check("the bundle manifest declares the patch the loader mounts", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(bundleDir, "package.json"), "utf8"));
  const patchRelative = manifest.dsh?.bundle?.patch;
  assert.equal(patchRelative, "./cordis.patch.yml");
  const patch = await fs.readFile(path.join(bundleDir, patchRelative), "utf8");
  assert.match(patch, /insert:/);
  assert.ok(patch.includes(`name: '${manifest.name}'`), "the patch mounts the package by its own name");
  assert.ok(patch.includes(`id: ${bundle.name}`), "the patch id matches the Cordis plugin name");
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const label of failures) console.log(`  failed: ${label}`);
  process.exit(1);
}
