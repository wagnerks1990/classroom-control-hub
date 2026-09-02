#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p src maintenance-agent public/display public/controller

warn_skip() {
  echo "::warning::$1"
}

materialize_gzip() {
  local src="$1" dst="$2"
  if [[ -f "$src" ]]; then
    if ! gzip -t "$src" 2>/dev/null; then
      warn_skip "Skipping corrupt gzip archive: $src"
      return 0
    fi
    mkdir -p "$(dirname "$dst")"
    gzip -dc "$src" > "$dst"
    echo "materialized $dst"
  fi
}

materialize_b64_gzip() {
  local src="$1" dst="$2" tmp
  if [[ -f "$src" ]]; then
    tmp="$(mktemp)"
    if ! base64 -d "$src" > "$tmp" 2>/dev/null || ! gzip -t "$tmp" 2>/dev/null; then
      rm -f "$tmp"
      warn_skip "Skipping invalid base64/gzip archive: $src"
      return 0
    fi
    mkdir -p "$(dirname "$dst")"
    gzip -dc "$tmp" > "$dst"
    rm -f "$tmp"
    echo "materialized $dst"
  fi
}

materialize_parts_b64_gzip() {
  local pattern="$1" dst="$2" tmp
  shopt -s nullglob
  local parts=( $pattern )
  shopt -u nullglob
  if (( ${#parts[@]} )); then
    tmp="$(mktemp)"
    if ! cat "${parts[@]}" | base64 -d > "$tmp" 2>/dev/null || ! gzip -t "$tmp" 2>/dev/null; then
      rm -f "$tmp"
      warn_skip "Chunk set is not complete/valid yet for $dst (${#parts[@]} part(s)); leaving existing direct file unchanged."
      return 0
    fi
    mkdir -p "$(dirname "$dst")"
    gzip -dc "$tmp" > "$dst"
    rm -f "$tmp"
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
