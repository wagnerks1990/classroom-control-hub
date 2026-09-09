#!/usr/bin/env bash
# Package fonts already installed by the Dockerfile; no runtime CDN dependency.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${DISPLAY_FONT_SOURCE_DIR:-/usr/share/fonts/truetype/liberation}"
if [[ ! -f "$source_dir/LiberationSans-Regular.ttf" && -z "${DISPLAY_FONT_SOURCE_DIR:-}" ]]; then
  source_dir=/usr/share/fonts/truetype/liberation2
fi
mkdir -p "$root/public/display/fonts"
for name in LiberationSans-Regular.ttf LiberationSans-Bold.ttf; do
  [[ -f "$source_dir/$name" ]] || { echo "Missing $name: install fonts-liberation or set DISPLAY_FONT_SOURCE_DIR" >&2; exit 1; }
  cp "$source_dir/$name" "$root/public/display/fonts/$name"
done
if [[ -f /usr/share/doc/fonts-liberation/copyright ]]; then
  cp /usr/share/doc/fonts-liberation/copyright "$root/public/display/fonts/LICENSE.txt"
fi
