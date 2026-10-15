#!/usr/bin/env bash
# Install agentic-protocol locally for testing.
#
#   ./scripts/install-local.sh [cursor|codex|codebuddy|all]   (default: cursor)
#
# Cursor rejects symlinks whose target is outside ~/.cursor/plugins/local/
# (see Cursor Plugins log: loadUserLocalPlugin ... rejected: symlink target is outside).
# Use this script after plugin changes, then reload the host.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_SRC="${REPO_ROOT}/plugin"
PLUGIN_NAME="agentic-protocol"
# Personal marketplace entries are resolved relative to $HOME.
CODEX_MARKETPLACE="${HOME}/.agents/plugins/marketplace.json"
CODEX_SOURCE_PATH="./.codex/plugins/${PLUGIN_NAME}"
# Names this plugin shipped under before: the pre-merge Cursor/Codex package and
# the pre-rename plugin id. A reinstall drops those marketplace entries so the
# renamed plugin does not sit next to a stale copy.
LEGACY_PLUGIN_NAMES="agent-context agent-context-codex"
CODEBUDDY_MARKETPLACE_NAME="agentic-protocol-marketplace"
# A directory marketplace is referenced in place, so the manifest must not live
# in this repository. CodeBuddy 5.0 also rejects a plugin source that resolves
# outside the marketplace directory (the UI only shows a generic error). Match
# the official marketplace layout: the plugin copy sits inside the marketplace,
# and marketplace.json points at ./plugins/<name>.
CODEBUDDY_MARKETPLACE_DIR="${HOME}/.codebuddy/plugins/marketplaces/${CODEBUDDY_MARKETPLACE_NAME}"
CODEBUDDY_PLUGIN_DIR="${CODEBUDDY_MARKETPLACE_DIR}/plugins/${PLUGIN_NAME}"
LEGACY_CODEBUDDY_MARKETPLACES="agent-context-marketplace"

copy_plugin() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  python3 - "$PLUGIN_SRC" "$dest" <<'PY'
import shutil
import sys

shutil.copytree(
    sys.argv[1], sys.argv[2], symlinks=True,
    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo", ".DS_Store", ".plugins-cache.json*", "*.bak"),
)
PY
}

install_cursor() {
  local dest="${HOME}/.cursor/plugins/local/${PLUGIN_NAME}"
  copy_plugin "$dest"
  echo "Installed ${PLUGIN_NAME} for Cursor: ${dest}"
  echo "  Next: Developer → Reload Window"
  echo "  Verify: Settings → Plugins → Installed (Agentic Protocol)"
}

register_codex_marketplace() {
  MARKETPLACE_PATH="$CODEX_MARKETPLACE" \
  PLUGIN_NAME="$PLUGIN_NAME" \
  SOURCE_PATH="$CODEX_SOURCE_PATH" \
  LEGACY_NAMES="$LEGACY_PLUGIN_NAMES" \
  python3 - <<'PY'
import json
import os
import pathlib

path = pathlib.Path(os.environ["MARKETPLACE_PATH"])
name = os.environ["PLUGIN_NAME"]
legacy = set(os.environ["LEGACY_NAMES"].split())

data = {"name": "personal", "interface": {"displayName": "Personal"}, "plugins": []}
if path.exists():
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            data = loaded
    except json.JSONDecodeError as error:
        raise SystemExit(f"{path} is not valid JSON, refusing to overwrite: {error}")

plugins = [
    entry
    for entry in data.get("plugins", [])
    if isinstance(entry, dict) and entry.get("name") not in legacy | {name}
]
dropped = len(data.get("plugins", [])) - len(plugins)
plugins.append(
    {
        "name": name,
        "source": {"source": "local", "path": os.environ["SOURCE_PATH"]},
        "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
        "category": "Productivity",
    }
)
data["plugins"] = plugins
data.setdefault("name", "personal")

path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(f"  Marketplace '{data['name']}' updated: {path} ({len(plugins)} plugin(s), {dropped} replaced)")
PY
}

codex_cli() {
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi
  local bundled="/Applications/ChatGPT.app/Contents/Resources/codex"
  if [ -x "$bundled" ]; then
    echo "$bundled"
    return 0
  fi
  return 1
}

# Codex only reads a plugin from its own versioned snapshot under
# ~/.codex/plugins/cache/. Copying the source and declaring the marketplace
# entry leaves the plugin "not installed", which the desktop UI hides entirely.
# `plugin add` re-copies even when the version is unchanged, so run it always.
activate_codex_plugin() {
  local cli
  if ! cli="$(codex_cli)"; then
    echo "  codex CLI not found; run 'codex plugin add ${PLUGIN_NAME}@personal' yourself" >&2
    return 0
  fi
  "$cli" plugin add "${PLUGIN_NAME}@personal" 2>&1 | sed 's/^/  /'
}

install_codex() {
  local dest="${HOME}/.codex/plugins/${PLUGIN_NAME}"
  copy_plugin "$dest"
  echo "Installed ${PLUGIN_NAME} for Codex: ${dest}"
  register_codex_marketplace
  activate_codex_plugin
  echo "  Next: restart Codex"
  echo "  Verify: codex plugin list  (expect 'agentic-protocol@personal  installed, enabled')"
  echo "  Codex asks you to trust plugin hooks before they run; without trust there is no protocol injection"
}

codebuddy_cli() {
  if command -v codebuddy >/dev/null 2>&1; then
    command -v codebuddy
    return 0
  fi
  return 1
}

# CodeBuddy installs through a marketplace, and a directory marketplace is used
# in place rather than cloned. The plugin source has to stay inside that
# directory; a relative path that escapes it is rejected by the 5.0 path check.
write_codebuddy_marketplace() {
  MARKETPLACE_DIR="$CODEBUDDY_MARKETPLACE_DIR" \
  MARKETPLACE_NAME="$CODEBUDDY_MARKETPLACE_NAME" \
  PLUGIN_NAME="$PLUGIN_NAME" \
  PLUGIN_SRC="$PLUGIN_SRC" \
  python3 - <<'PY'
import json
import os
import pathlib

plugin = json.loads(
    pathlib.Path(os.environ["PLUGIN_SRC"], ".codebuddy-plugin", "plugin.json").read_text(encoding="utf-8")
)
source = "./plugins/" + os.environ["PLUGIN_NAME"]
marketplace = pathlib.Path(os.environ["MARKETPLACE_DIR"]).resolve()
resolved = (marketplace / source).resolve()
if marketplace != resolved and marketplace not in resolved.parents:
    raise SystemExit(f"plugin source escapes the marketplace: {source} -> {resolved}")
data = {
    "name": os.environ["MARKETPLACE_NAME"],
    "owner": {"name": "local"},
    "metadata": {
        "description": "Local marketplace serving the installed copy of " + os.environ["PLUGIN_NAME"],
        "version": plugin["version"],
    },
    "plugins": [
        {
            "name": os.environ["PLUGIN_NAME"],
            "source": source,
            "description": plugin["description"],
            "version": plugin["version"],
            "category": "Productivity",
        }
    ],
}
root = marketplace / ".codebuddy-plugin"
root.mkdir(parents=True, exist_ok=True)
path = root / "marketplace.json"
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(f"  Local marketplace manifest written: {path}")
print(f"  Plugin source stays inside the marketplace: {resolved}")
PY
}

# The pre-5.0 install kept the plugin beside marketplaces/ and the manifest
# under plugin-marketplaces/, then pointed source at ../../plugins/<name>.
# Drop those copies so a reload cannot keep resolving the rejected path.
retire_codebuddy_legacy_paths() {
  local legacy
  rm -rf "${HOME}/.codebuddy/plugins/${PLUGIN_NAME}"
  rm -rf "${HOME}/.codebuddy/plugin-marketplaces/${CODEBUDDY_MARKETPLACE_NAME}"
  for legacy in $LEGACY_CODEBUDDY_MARKETPLACES; do
    rm -rf "${HOME}/.codebuddy/plugin-marketplaces/${legacy}"
    rm -rf "${HOME}/.codebuddy/plugins/${legacy}"
  done
  if [ -d "${HOME}/.codebuddy/plugin-marketplaces" ]; then
    rmdir "${HOME}/.codebuddy/plugin-marketplaces" 2>/dev/null || true
  fi
}

# `codebuddy` is often absent from PATH inside the IDE app. Record the
# directory marketplace anyway, and leave every other marketplace entry as it
# was. A later CLI add of the same directory overwrites only this key.
register_codebuddy_marketplace() {
  HOME="$HOME" \
  MARKETPLACE_DIR="$CODEBUDDY_MARKETPLACE_DIR" \
  MARKETPLACE_NAME="$CODEBUDDY_MARKETPLACE_NAME" \
  LEGACY_NAMES="$LEGACY_CODEBUDDY_MARKETPLACES" \
  python3 - <<'PY'
import json
import os
import pathlib
from datetime import datetime, timezone

path = pathlib.Path(os.environ["HOME"]) / ".codebuddy" / "plugins" / "known_marketplaces.json"
marketplace_dir = str(pathlib.Path(os.environ["MARKETPLACE_DIR"]).resolve())
name = os.environ["MARKETPLACE_NAME"]
legacy = [item for item in os.environ["LEGACY_NAMES"].split() if item]

data = {}
if path.exists() and path.stat().st_size > 0:
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"{path} is not valid JSON, refusing to overwrite: {error}")
    if not isinstance(loaded, dict):
        raise SystemExit(f"{path} is not a JSON object, refusing to overwrite")
    data = loaded

for old in legacy:
    data.pop(old, None)
data[name] = {
    "type": "directory",
    "source": {"source": "directory", "path": marketplace_dir},
    "installLocation": marketplace_dir,
    "description": "Marketplace from " + marketplace_dir,
    "lastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
    "autoUpdate": False,
}
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(f"  Marketplace registry updated: {path} key {name}")
PY
}

# `plugin install` re-materializes even when the version is unchanged, so run
# it always. `--plugin-dir` is the no-CLI fallback.
activate_codebuddy_plugin() {
  local cli
  if ! cli="$(codebuddy_cli)"; then
    echo "  codebuddy CLI not found; marketplace files are in place. Reload plugins in CodeBuddy." >&2
    return 0
  fi
  local legacy
  for legacy in $LEGACY_CODEBUDDY_MARKETPLACES; do
    "$cli" plugin marketplace rm "$legacy" >/dev/null 2>&1 || true
  done
  "$cli" plugin marketplace rm "$CODEBUDDY_MARKETPLACE_NAME" >/dev/null 2>&1 || true
  "$cli" plugin marketplace add "$CODEBUDDY_MARKETPLACE_DIR" 2>&1 | sed 's/^/  /' || true
  "$cli" plugin install "${PLUGIN_NAME}@${CODEBUDDY_MARKETPLACE_NAME}" --scope user 2>&1 | sed 's/^/  /' || true
}

install_codebuddy() {
  copy_plugin "$CODEBUDDY_PLUGIN_DIR"
  echo "Installed ${PLUGIN_NAME} for CodeBuddy: ${CODEBUDDY_PLUGIN_DIR}"
  write_codebuddy_marketplace
  retire_codebuddy_legacy_paths
  register_codebuddy_marketplace
  activate_codebuddy_plugin
  echo "  Next: /reload-plugins in CodeBuddy, or restart CodeBuddy IDE"
  echo "  Verify: /plugin (Installed tab). Rules still need the CodeBuddy build that restores .mdc plugin rules."
  echo "  Protocol comes from the plugin's rules/; no session hook is needed"
}

HOST="${1:-cursor}"
case "$HOST" in
  cursor)
    install_cursor
    echo
    echo "Only Cursor was installed. Run '$0 codex', '$0 codebuddy', or '$0 all' for the others."
    ;;
  codex)
    install_codex
    ;;
  codebuddy)
    install_codebuddy
    ;;
  all)
    install_cursor
    echo
    install_codex
    echo
    install_codebuddy
    ;;
  *)
    echo "Usage: $0 [cursor|codex|codebuddy|all]" >&2
    exit 1
    ;;
esac
