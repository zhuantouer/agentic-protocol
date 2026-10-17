#!/usr/bin/env node

/**
 * Generate the DeepSeek Harness bundle's own copies of the shared plugin content.
 *
 * The bundle at `dsh/` is installed as a standalone package directory, so it
 * cannot read `plugin/` at runtime: `plugin/skills/` and `plugin/rules/` are
 * projected into `dsh/skills/` and `dsh/rules/`. Those copies are committed, so
 * CI can prove the projection is current and a bare checkout installs without a
 * build step — and `plugin/` stays the only authored copy, because
 * `validate-template.mjs` fails on any byte-level drift between the two.
 *
 *   node scripts/sync-dsh-bundle.mjs            # write the generated copies
 *   node scripts/sync-dsh-bundle.mjs --check    # fail on drift, write nothing
 *   node scripts/sync-dsh-bundle.mjs --root DIR # operate on another checkout
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const IGNORED_NAMES = new Set(["__pycache__", ".DS_Store"]);
const IGNORED_SUFFIXES = [".pyc", ".pyo", ".bak"];

/** One projection: an authored directory and the generated directory that mirrors it. */
const PROJECTIONS = [
  { source: "plugin/skills", target: "dsh/skills", key: "skills" },
  { source: "plugin/rules", target: "dsh/rules", key: "rules" },
];

function parseArgs(argv) {
  let root = process.cwd();
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      check = true;
    } else if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) {
        console.error("--root needs a directory");
        process.exit(2);
      }
      root = path.resolve(value);
      index += 1;
    } else {
      console.error(`unknown argument: ${argument}`);
      process.exit(2);
    }
  }
  return { root, check };
}

function isIgnored(name) {
  return IGNORED_NAMES.has(name) || IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** Collect one directory tree as a map of slash-joined relative path to bytes. */
async function collect(dir, base = dir, files = new Map()) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return files;
    throw error;
  }
  for (const entry of entries) {
    if (isIgnored(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(absolute, base, files);
    } else if (entry.isFile()) {
      files.set(path.relative(base, absolute).split(path.sep).join("/"), await fs.readFile(absolute));
    }
  }
  return files;
}

/** The single path-keyed map both sides are compared through: `skills/...`, `rules/...`. */
async function expectedFiles(root) {
  const expected = new Map();
  for (const projection of PROJECTIONS) {
    for (const [relative, bytes] of await collect(path.join(root, projection.source))) {
      expected.set(`${projection.key}/${relative}`, bytes);
    }
  }
  return expected;
}

/** Read the generated trees, reporting any target directory that was never generated. */
async function actualFiles(root) {
  const actual = new Map();
  const missing = [];
  for (const projection of PROJECTIONS) {
    const targetDir = path.join(root, projection.target);
    try {
      await fs.access(targetDir);
    } catch {
      missing.push(projection.target);
      continue;
    }
    for (const [relative, bytes] of await collect(targetDir)) {
      actual.set(`${projection.key}/${relative}`, bytes);
    }
  }
  return { actual, missing };
}

function compare(expected, actual) {
  const drift = [];
  for (const [relative, bytes] of expected) {
    const found = actual.get(relative);
    if (found === undefined) drift.push(`missing    ${relative}`);
    else if (!found.equals(bytes)) drift.push(`differs    ${relative}`);
  }
  for (const relative of actual.keys()) {
    if (!expected.has(relative)) drift.push(`unexpected ${relative}`);
  }
  return drift.sort();
}

async function write(root) {
  // Rebuild rather than merge: a removed skill must not survive as stale content.
  for (const projection of PROJECTIONS) {
    await fs.rm(path.join(root, projection.target), { recursive: true, force: true });
    await fs.cp(path.join(root, projection.source), path.join(root, projection.target), {
      recursive: true,
      filter: (from) => !isIgnored(path.basename(from)),
    });
  }
}

async function main() {
  const { root, check } = parseArgs(process.argv.slice(2));
  const expected = await expectedFiles(root);
  if (expected.size === 0) {
    console.error(`no authored content under ${PROJECTIONS.map((p) => p.source).join(", ")} in ${root}`);
    process.exit(1);
  }

  const { actual, missing } = await actualFiles(root);
  const drift = compare(expected, actual);
  const missingNote = missing.length > 0 ? ` (never generated: ${missing.join(", ")})` : "";

  if (check) {
    if (drift.length > 0) {
      console.error(`dsh bundle drift${missingNote}:`);
      for (const line of drift) console.error(`  ${line}`);
      console.error(`\nFix with: node scripts/sync-dsh-bundle.mjs --root ${root}`);
      process.exit(1);
    }
    console.log(`dsh bundle in sync: ${expected.size} file(s)`);
    return;
  }

  await write(root);
  console.log(`dsh bundle generated: ${expected.size} file(s) → ${PROJECTIONS.map((p) => p.target).join(", ")}`);
}

await main();
