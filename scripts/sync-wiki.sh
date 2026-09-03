#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIKI_SOURCE="$ROOT/wiki"

if [[ ! -d "$WIKI_SOURCE" ]]; then
  echo "Missing wiki source directory: $WIKI_SOURCE" >&2
  exit 1
fi

REMOTE="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
if [[ -z "$REMOTE" ]]; then
  echo "Could not determine origin remote." >&2
  exit 1
fi

if [[ "$REMOTE" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
else
  echo "Origin is not a recognized GitHub repository URL: $REMOTE" >&2
  exit 1
fi

WIKI_REMOTE="${WIKI_REMOTE:-https://github.com/${OWNER}/${REPO}.wiki.git}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WIKI_DIR="$TMP/wiki"
echo "Cloning Wiki: $WIKI_REMOTE"
git clone "$WIKI_REMOTE" "$WIKI_DIR"

# Make the Git-tracked mirror authoritative for Wiki Markdown content.
find "$WIKI_DIR" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$WIKI_SOURCE"/. "$WIKI_DIR"/

cd "$WIKI_DIR"
git add -A
if git diff --cached --quiet; then
  echo "GitHub Wiki is already synchronized."
  exit 0
fi

git commit -m "Sync Wiki from main repository"
git push origin HEAD

echo "GitHub Wiki synchronized successfully."
