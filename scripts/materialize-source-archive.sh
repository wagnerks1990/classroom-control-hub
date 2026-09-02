#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p src maintenance-agent public/display public/controller

materialize_gzip() {
  local src="$1" dst="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    gzip -dc "$src" > "$dst"
    echo "materialized $dst"
  fi
}

materialize_b64_gzip() {
  local src="$1" dst="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dst")"
    base64 -d "$src" | gzip -dc > "$dst"
    echo "materialized $dst"
  fi
}

materialize_parts_b64_gzip() {
  local pattern="$1" dst="$2"
  shopt -s nullglob
  local parts=( $pattern )
  shopt -u nullglob
  if (( ${#parts[@]} )); then
    mkdir -p "$(dirname "$dst")"
    cat "${parts[@]}" | base64 -d | gzip -dc > "$dst"
    echo "materialized $dst from ${#parts[@]} part(s)"
  fi
}

materialize_gzip source-archive/public-display-index.html.gz public/display/index.html
materialize_gzip source-archive/public-controller-veyon.html.gz public/controller/veyon.html
materialize_gzip source-archive/public-controller-display.html.gz public/controller/display.html
materialize_gzip source-archive/public-controller-lab.html.gz public/controller/lab.html
materialize_gzip source-archive/maintenance-agent-storage.js.gz maintenance-agent/storage.js
materialize_b64_gzip source-archive/maintenance-agent-server.js.gz.b64 maintenance-agent/server.js

materialize_parts_b64_gzip 'source-archive/chunks/src__storage.js.gz.b64.part*' src/storage.js
materialize_parts_b64_gzip 'source-archive/chunks/src__server.js.gz.b64.part*' src/server.js
materialize_parts_b64_gzip 'source-archive/chunks/public__controller__index.html.gz.b64.part*' public/controller/index.html

# Basic integrity checks for any direct files that now exist.
[[ ! -f src/storage.js ]] || node --check src/storage.js
[[ ! -f src/server.js ]] || node --check src/server.js
[[ ! -f maintenance-agent/storage.js ]] || node --check maintenance-agent/storage.js
[[ ! -f maintenance-agent/server.js ]] || node --check maintenance-agent/server.js

echo "Source archive materialization complete."
