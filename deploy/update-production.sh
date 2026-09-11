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

HEALTH_FILE="$(mktemp /tmp/roomgoblin-health.XXXXXX.json)"
trap 'rm -f "$HEALTH_FILE"' EXIT
health_ok=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${HUB_PORT:-3000}/health" >"$HEALTH_FILE" 2>/dev/null; then
    health_ok=1
    break
  fi
  sleep 2
done

(( health_ok == 1 )) || fail "health endpoint did not become available within 180 seconds"
[[ -s "$HEALTH_FILE" ]] || fail "health endpoint returned an empty response"

python3 - "$VERSION" "$HEALTH_FILE" <<'PY'
import json
import sys

expected = sys.argv[1]
health_file = sys.argv[2]

try:
    with open(health_file, encoding="utf-8") as f:
        health = json.load(f)
except (OSError, json.JSONDecodeError) as exc:
    raise SystemExit(f"invalid health response: {exc}") from exc

if not health.get("ok"):
    raise SystemExit("health endpoint is not ok")
if not health.get("ready"):
    raise SystemExit("health endpoint is not ready")
if health.get("version") != expected:
    raise SystemExit(
        f"version mismatch: expected={expected} actual={health.get('version')}"
    )

print(f"RoomGoblin healthy: {health.get('version')}")
PY

docker compose ps
