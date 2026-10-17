#!/usr/bin/env node

/**
 * Install the DeepSeek Harness bundle into the local harness home.
 *
 * The desktop app boots a profile under `$DSH_HOME/profiles` (the running app
 * uses `desktop`) and resolves every name in `dsh.profile.bundles` from the
 * profile's own `node_modules` or from the harness installation. There is no
 * `dsh` binary on PATH in a desktop install, so this script performs the three
 * steps `dsh plugin add <path>` would take:
 *
 *   1. copy `dsh/` to `$DSH_HOME/plugins/agentic-protocol`;
 *   2. record the `link:` dependency and add the bundle name to the profile;
 *   3. link the package into the profile's `node_modules`.
 *
 * Generated copies under `dsh/skills` and `dsh/rules` are refreshed first, so an
 * install never ships stale projections.
 *
 *   node scripts/install-dsh.mjs                    # every profile with a manifest
 *   node scripts/install-dsh.mjs --profile desktop  # one profile
 *   node scripts/install-dsh.mjs --dry-run
 */

import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIR = path.join(REPO_ROOT, "dsh");
const PACKAGE_NAME = "dsh-agentic-protocol";
const INSTALL_NAME = "agentic-protocol";
const IGNORED = new Set(["node_modules", ".git", "__pycache__", ".DS_Store"]);

function parseArgs(argv) {
  const options = { home: process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), profiles: [], dryRun: false, sync: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--profile") {
      const value = argv[index + 1];
      if (!value) throw new Error("--profile needs a name");
      options.profiles.push(value);
      index += 1;
    } else if (argument === "--home") {
      const value = argv[index + 1];
      if (!value) throw new Error("--home needs a directory");
      options.home = path.resolve(value);
      index += 1;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--no-sync") {
      options.sync = false;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

/** POSIX-style path for pnpm's `link:` value, which is portable across hosts. */
function linkValue(target) {
  return `link:${target.split(path.sep).join("/")}`;
}

function ignored(name) {
  return IGNORED.has(name) || name.endsWith(".pyc") || name.endsWith(".pyo") || name.endsWith(".bak");
}

async function copyBundle(destination, dryRun) {
  const source = await fs.readFile(path.join(SOURCE_DIR, "package.json"), "utf8").then(JSON.parse);
  if (source.name !== PACKAGE_NAME) throw new Error(`dsh/package.json declares ${source.name}, expected ${PACKAGE_NAME}`);
  if (dryRun) {
    console.log(`dry-run: copy ${SOURCE_DIR} -> ${destination}`);
    return;
  }
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(SOURCE_DIR, destination, {
    recursive: true,
    filter: (from) => !ignored(path.basename(from)),
  });
  console.log(`Copied bundle: ${destination}`);
}

/** Every profile directory that already holds a manifest. */
async function discoverProfiles(home) {
  const root = path.join(home, "profiles");
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const profiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const dir = path.join(root, entry.name);
    try {
      await fs.access(path.join(dir, "package.json"));
      profiles.push(dir);
    } catch {
      // A directory without a manifest is not a profile the loader can boot.
    }
  }
  return profiles.sort();
}

async function ensureLink(profileDir, target, dryRun) {
  const modules = path.join(profileDir, "node_modules");
  const link = path.join(modules, PACKAGE_NAME);
  let stats;
  try {
    stats = await fs.lstat(link);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (stats !== undefined && !stats.isSymbolicLink()) {
    throw new Error(`${link} exists and is not a link; remove it and re-run`);
  }
  const current = stats === undefined ? undefined : path.resolve(modules, await fs.readlink(link));
  if (current !== undefined && current === path.resolve(target)) return false;
  if (dryRun) {
    console.log(`dry-run: link ${link} -> ${target}`);
    return true;
  }
  await fs.mkdir(modules, { recursive: true });
  if (stats !== undefined) await fs.unlink(link);
  await fs.symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  return true;
}

async function installProfile(profileDir, bundleDir, options) {
  const manifestPath = path.join(profileDir, "package.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const name = path.basename(profileDir);
  const dependency = linkValue(bundleDir);

  manifest.dependencies = { ...(manifest.dependencies ?? {}) };
  manifest.dependencies[PACKAGE_NAME] = dependency;
  manifest.dsh = { ...(manifest.dsh ?? {}) };
  manifest.dsh.profile = { ...(manifest.dsh.profile ?? {}) };
  const bundles = Array.isArray(manifest.dsh.profile.bundles) ? [...manifest.dsh.profile.bundles] : [];
  if (!bundles.includes(PACKAGE_NAME)) bundles.push(PACKAGE_NAME);
  manifest.dsh.profile.bundles = bundles;

  if (options.dryRun) {
    console.log(`dry-run: update ${manifestPath}`);
  } else {
    const backup = `${manifestPath}.agentic-protocol.bak`;
    try {
      await fs.access(backup);
    } catch {
      await fs.writeFile(backup, raw, "utf8");
    }
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log(`Updated profile '${name}': ${manifestPath}`);
  }
  const linked = await ensureLink(profileDir, bundleDir, options.dryRun);
  if (linked && !options.dryRun) console.log(`  linked ${PACKAGE_NAME} into node_modules`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.sync) {
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "sync-dsh-bundle.mjs")], {
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error("sync-dsh-bundle.mjs failed");
  }

  const bundleDir = path.join(options.home, "plugins", INSTALL_NAME);
  await copyBundle(bundleDir, options.dryRun);

  const available = await discoverProfiles(options.home);
  const selected = options.profiles.length > 0
    ? options.profiles.map((name) => path.join(options.home, "profiles", name))
    : available;

  for (const profileDir of selected) {
    try {
      await fs.access(path.join(profileDir, "package.json"));
    } catch {
      throw new Error(`profile '${path.basename(profileDir)}' has no package.json under ${options.home}/profiles`);
    }
    await installProfile(profileDir, bundleDir, options);
  }

  if (!options.dryRun) {
    console.log("");
    console.log("The running app can apply the profile live. If a new session does not");
    console.log("show the protocol section, quit and reopen DeepSeek Harness.");
    console.log("New sessions then carry the section and see the three skills.");
  }
}

await main();
