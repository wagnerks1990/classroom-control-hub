#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${CLASSROOM_HUB_DIR:-/opt/classroom-hub}"
WAIT_SECONDS="${ROOMGOBLIN_IMAGE_WAIT_SECONDS:-300}"
POLL_SECONDS="${ROOMGOBLIN_IMAGE_POLL_SECONDS:-10}"

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

COMMIT="$(git rev-parse HEAD)"
VERSION="$(tr -d '\r\n' < VERSION)"
TAG="sha-${COMMIT}"
HUB_IMAGE="ghcr.io/wagnerks1990/classroom-control-hub:${TAG}"
MAINT_IMAGE="ghcr.io/wagnerks1990/classroom-control-hub-maintenance:${TAG}"

echo "Waiting for CI-published RoomGoblin images for ${VERSION} (${COMMIT}) ..."
deadline=$((SECONDS + WAIT_SECONDS))
while true; do
  if docker pull "$HUB_IMAGE" >/dev/null 2>&1 && docker pull "$MAINT_IMAGE" >/dev/null 2>&1; then
    break
  fi
  (( SECONDS < deadline )) || fail "validated CI images were not available within ${WAIT_SECONDS}s; no local build was attempted"
  sleep "$POLL_SECONDS"
done

if grep -q '^CLASSROOM_CONTROL_HUB_TAG=' .env 2>/dev/null; then
  sed -i "s/^CLASSROOM_CONTROL_HUB_TAG=.*/CLASSROOM_CONTROL_HUB_TAG=${TAG}/" .env
else
  printf '\nCLASSROOM_CONTROL_HUB_TAG=%s\n' "$TAG" >> .env
fi
chmod 0600 .env

export CLASSROOM_CONTROL_HUB_TAG="$TAG"
echo "Deploying immutable CI images ..."
docker compose up -d --no-build --force-recreate --remove-orphans maintenance-agent classroom-hub

for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:${HUB_PORT:-3000}/health >/tmp/roomgoblin-health.json 2>/dev/null; then
    break
  fi
  sleep 2
done

python3 - "$VERSION" </tmp/roomgoblin-health.json <<'PY'
import json,sys
expected=sys.argv[1]
j=json.load(sys.stdin)
if not j.get('ok'):
    raise SystemExit('health endpoint is not ok')
if j.get('version') != expected:
    raise SystemExit(f"version mismatch: expected={expected} actual={j.get('version')}")
print(f"RoomGoblin healthy: {j.get('version')}")
PY

docker compose ps
