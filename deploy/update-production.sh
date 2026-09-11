#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${CLASSROOM_HUB_DIR:-/opt/classroom-hub}"
fail(){ echo "RoomGoblin production update failed: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || fail "run with sudo or as root"
command -v git >/dev/null 2>&1 || fail "git is required"
command -v docker >/dev/null 2>&1 || fail "docker is required"
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is required"
[[ -d "$ROOT/.git" ]] || fail "$ROOT is not a Git checkout"

cd "$ROOT"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "tracked source has local changes; commit or revert them before updating"

echo "Fetching RoomGoblin source ..."
git fetch --prune origin main
git checkout main
git pull --ff-only origin main

echo "Delegating backup, runtime reconciliation, immutable-image deployment, and convergence checks to install.sh ..."
exec bash "$ROOT/install.sh"
