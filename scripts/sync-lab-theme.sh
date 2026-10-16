#!/usr/bin/env bash
# Sync lab-theme into this app's vendor/ folder.
# Prefer monorepo packages/lab-theme when present; otherwise keep existing vendor.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SOURCE="${LAB_THEME_SOURCE:-}"
if [[ -z "$SOURCE" ]]; then
  for candidate in \
    "$ROOT/../packages/lab-theme" \
    "$ROOT/../../packages/lab-theme" \
    "$ROOT/../Lab Hub System/packages/lab-theme"
  do
    if [[ -d "$candidate/src" ]]; then
      SOURCE="$candidate"
      break
    fi
  done
fi

if [[ -n "${1:-}" ]]; then
  TARGET="$1"
elif [[ -d "$ROOT/scaffold" ]]; then
  TARGET="$ROOT/scaffold/vendor/lab-theme"
else
  TARGET="$ROOT/vendor/lab-theme"
fi

if [[ -n "$SOURCE" && -d "$SOURCE/src" ]]; then
  mkdir -p "$TARGET"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude dist \
    "$SOURCE/" "$TARGET/"
  echo "Synced lab-theme → $TARGET"
  exit 0
fi

if [[ -d "$TARGET/src" ]]; then
  echo "lab-theme already vendored at $TARGET (no upstream source; set LAB_THEME_SOURCE to refresh)"
  exit 0
fi

echo "error: lab-theme not found (tried LAB_THEME_SOURCE / packages/lab-theme) and no vendor at $TARGET" >&2
exit 1
