#!/usr/bin/env bash
# Suggest next free local dev listen port (3000–3999) for a new app.
lab_suggest_dev_listen_port() {
  local template_root="${1:-$TEMPLATE_ROOT}"
  local monorepo=""
  if [[ -d "$template_root/../packages/lab-platform-config" ]]; then
    monorepo="$(cd "$template_root/.." && pwd)"
    if [[ -f "$monorepo/packages/lab-platform-config/suggestDevListenPort.mjs" ]]; then
      node "$monorepo/packages/lab-platform-config/suggestDevListenPort.mjs" "$monorepo" 2>/dev/null && return
    fi
  fi
  if [[ -f "$template_root/scripts/lib/suggest-dev-port.mjs" ]]; then
    node "$template_root/scripts/lib/suggest-dev-port.mjs" 2>/dev/null && return
  fi
  echo "3003"
}
