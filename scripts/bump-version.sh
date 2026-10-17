#!/usr/bin/env bash
# scripts/bump-version.sh — keep VERSION, the three host manifests and the DSH bundle in lockstep.
#
#   ./scripts/bump-version.sh --check               # fail if anything drifted
#   ./scripts/bump-version.sh 2.0.2                 # set VERSION and every manifest
#   ./scripts/bump-version.sh --check --root DIR    # used by the test suite
#
# One version lives in five places: VERSION, the Cursor, CodeBuddy and Codex
# manifests, and the DSH bundle's package.json. Hand-editing is how one of them
# ships stale, so VERSION is the source of truth and this script is the only
# writer. MANIFESTS below is the registry: a manifest that is not listed here is
# invisible to both --check and a bump. Only the first "version" field of each
# file is rewritten, so key order and formatting survive.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="check"
NEW=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check)
      MODE="check"
      shift
      ;;
    --root)
      if [ "$#" -lt 2 ]; then
        echo "Usage: $0 [--check] [<version>] [--root DIR]" >&2
        exit 2
      fi
      ROOT="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--check] [<version>] [--root DIR]"
      exit 0
      ;;
    -*)
      echo "Usage: $0 [--check] [<version>] [--root DIR]" >&2
      exit 2
      ;;
    *)
      NEW="$1"
      MODE="set"
      shift
      ;;
  esac
done

ROOT="$ROOT" MODE="$MODE" NEW="$NEW" python3 - <<'PY'
import json
import os
import pathlib
import re
import sys

root = pathlib.Path(os.environ["ROOT"])
mode = os.environ["MODE"]
new = os.environ.get("NEW", "")

VERSION_FILE = "VERSION"
MANIFESTS = (
    "plugin/.cursor-plugin/plugin.json",
    "plugin/.codebuddy-plugin/plugin.json",
    "plugin/.codex-plugin/plugin.json",
    "dsh/package.json",
)
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
VERSION_FIELD = re.compile(r'("version"\s*:\s*")[^"]*(")')


def read_version(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        return None, f"{path.name}: invalid JSON: {error}"
    version = data.get("version") if isinstance(data, dict) else None
    if not isinstance(version, str) or not version.strip():
        return None, f"{path.name}: missing top-level string 'version'"
    return version.strip(), None


version_path = root / VERSION_FILE
problems = []

if mode == "check":
    if not version_path.is_file():
        sys.exit(f"{VERSION_FILE} not found in {root}: it is the source of truth for the shipped version")
    expected = version_path.read_text(encoding="utf-8").strip()
    if not SEMVER.match(expected):
        sys.exit(f"{VERSION_FILE}: '{expected}' is not a semantic version")
    for name in MANIFESTS:
        path = root / name
        if not path.is_file():
            problems.append(f"{name}: manifest not found")
            continue
        actual, error = read_version(path)
        if error:
            problems.append(error)
        elif actual != expected:
            problems.append(f"{name}: version {actual} != {VERSION_FILE} {expected}")
    if problems:
        print("Version lockstep check failed:")
        for problem in problems:
            print(f"  - {problem}")
        print(f"\nFix with: ./scripts/bump-version.sh {expected}")
        sys.exit(1)
    print(f"Version lockstep OK: {expected} in {VERSION_FILE} and {len(MANIFESTS)} manifest(s)")
    sys.exit(0)

if not SEMVER.match(new):
    sys.exit(f"'{new}' is not a semantic version (expected X.Y.Z)")

version_path.write_text(new + "\n", encoding="utf-8")
print(f"{VERSION_FILE}: {new}")

for name in MANIFESTS:
    path = root / name
    if not path.is_file():
        problems.append(f"{name}: manifest not found, skipped")
        continue
    text = path.read_text(encoding="utf-8")
    updated = VERSION_FIELD.sub(lambda m: m.group(1) + new + m.group(2), text, count=1)
    if updated == text:
        problems.append(f"{name}: no 'version' field to rewrite")
        continue
    path.write_text(updated, encoding="utf-8")
    # The rewrite is textual so formatting survives; re-read to prove it landed on
    # the top-level field and nowhere else.
    actual, error = read_version(path)
    if error or actual != new:
        problems.append(error or f"{name}: expected {new}, file now says {actual}")
        continue
    print(f"{name}: {new}")

if problems:
    print("\nProblems:")
    for problem in problems:
        print(f"  - {problem}")
    sys.exit(1)
print("\nRe-run ./scripts/install-local.sh all and reinstall the DSH bundle so installed copies pick up the new version.")
PY
