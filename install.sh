#!/usr/bin/env bash
set -euo pipefail

TARGET="${CLASSROOM_HUB_DIR:-/opt/classroom-hub}"
SERVICES="${CLASSROOM_HUB_SERVICES_DIR:-/opt/services}"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_REAL="$(readlink -f "$SOURCE")"
TARGET_REAL="$(readlink -m "$TARGET")"
SERVICES_REAL="$(readlink -m "$SERVICES")"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${CLASSROOM_HUB_BACKUP_DIR:-/opt/classroom-hub-backups}"
BACKUP_ROOT_REAL="$(readlink -m "$BACKUP_ROOT")"
BACKUP="$BACKUP_ROOT/migration-$STAMP"

fail(){ echo "Classroom Control Hub installer failed: $*" >&2; exit 1; }
safe_managed_root(){
  local label="$1" raw="$2" resolved
  [[ "$raw" == /* ]] || fail "$label must be an absolute path"
  [[ ! -L "$raw" ]] || fail "$label may not be a symbolic link"
  [[ "$raw" =~ ^/opt/[A-Za-z0-9._/-]+$ ]] || fail "$label contains unsupported path characters"
  resolved="$(readlink -m "$raw")"
  case "$resolved" in /|/opt|/usr|/var|/etc|/home|/root|/tmp) fail "$label resolves to unsafe broad path $resolved";; esac
  [[ "$resolved" == /opt/* ]] || fail "$label must resolve beneath /opt"
}

safe_managed_root "CLASSROOM_HUB_DIR" "$TARGET"
safe_managed_root "CLASSROOM_HUB_SERVICES_DIR" "$SERVICES"
safe_managed_root "CLASSROOM_HUB_BACKUP_DIR" "$BACKUP_ROOT"
paths_overlap(){ [[ "$1" == "$2" || "$1" == "$2/"* || "$2" == "$1/"* ]]; }
! paths_overlap "$TARGET_REAL" "$SERVICES_REAL" || fail "application and services roots must be separate, non-nested directories"
! paths_overlap "$TARGET_REAL" "$BACKUP_ROOT_REAL" || fail "application and backup roots must be separate, non-nested directories"
! paths_overlap "$SERVICES_REAL" "$BACKUP_ROOT_REAL" || fail "services and backup roots must be separate, non-nested directories"
if [[ -d "$TARGET" ]] && find "$TARGET" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  [[ -f "$TARGET/.classroom-hub-installation" || ( -f "$TARGET/docker-compose.yml" && -f "$TARGET/VERSION" ) ]] || fail "$TARGET is not an identified Classroom Control Hub installation"
fi

if [[ $EUID -ne 0 ]]; then echo "Run this installer as root (sudo)." >&2; exit 1; fi

command -v docker >/dev/null 2>&1 || { echo "Docker is required. Install Docker Engine + Compose plugin first." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin is required." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { apt-get update && apt-get install -y openssl; }
command -v rsync >/dev/null 2>&1 || { apt-get update && apt-get install -y rsync; }
command -v zip >/dev/null 2>&1 || { apt-get update && apt-get install -y zip unzip; }
command -v sqlite3 >/dev/null 2>&1 || { apt-get update && apt-get install -y sqlite3; }

mkdir -p "$BACKUP_ROOT"
if [[ -f "$TARGET/.env" || -d "$TARGET/data" ]]; then
  echo "Existing Classroom Control Hub detected at $TARGET"
  mkdir -p "$BACKUP"
  echo "Creating pre-migration backup at $BACKUP ..."
  rsync -a \
    --exclude data/backups/ \
    --exclude data/classroom-control-hub.db \
    --exclude data/classroom-control-hub.db-wal \
    --exclude data/classroom-control-hub.db-shm \
    "$TARGET/" "$BACKUP/classroom-hub/"
  if [[ -f "$TARGET/data/classroom-control-hub.db" ]]; then
    mkdir -p "$BACKUP/classroom-hub/data"
    sqlite3 "$TARGET/data/classroom-control-hub.db" ".backup '$BACKUP/classroom-hub/data/classroom-control-hub.db'"
  fi
  if [[ -d "$SERVICES" ]]; then rsync -a "$SERVICES/" "$BACKUP/services/"; fi
  docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' > "$BACKUP/docker-containers.txt" || true
  docker image ls > "$BACKUP/docker-images.txt" || true
fi

mkdir -p "$TARGET"
# Preserve current runtime data, site hardware mappings, and secrets.
if [[ "$SOURCE_REAL" != "$TARGET_REAL" ]]; then
  rsync -a --delete \
    --exclude data/ \
    --exclude .env \
    --exclude config/devices.json \
    --exclude config/hardware.json \
    "$SOURCE/" "$TARGET/"
else
  echo "Installing from the production checkout in place; source synchronization is not required."
fi

mkdir -p "$TARGET/data/backups" "$TARGET/config/schema"
touch "$TARGET/.classroom-hub-installation"
chown -R 10001:10001 "$TARGET/data"
# New schema/catalog files are safe to merge into existing site configuration.
if [[ "$SOURCE_REAL" != "$TARGET_REAL" ]]; then
  if [[ -d "$SOURCE/config/schema" ]]; then rsync -a "$SOURCE/config/schema/" "$TARGET/config/schema/"; fi
  if [[ -f "$SOURCE/config/integrations.catalog.json" ]]; then cp -f "$SOURCE/config/integrations.catalog.json" "$TARGET/config/"; fi
  if [[ ! -f "$TARGET/config/devices.json" && -f "$SOURCE/config/devices.json" ]]; then cp "$SOURCE/config/devices.json" "$TARGET/config/"; fi
  if [[ ! -f "$TARGET/config/hardware.json" && -f "$SOURCE/config/hardware.json" ]]; then cp "$SOURCE/config/hardware.json" "$TARGET/config/"; fi
fi

if [[ ! -f "$TARGET/.env" ]]; then
  cp "$TARGET/.env.example" "$TARGET/.env"
fi
random_token(){ openssl rand -hex 32; }
ensure_secret(){
  local name="$1" value
  value="$(sed -n "s/^${name}=//p" "$TARGET/.env" | tail -n 1)"
  if [[ -z "$value" ]]; then
    value="$(random_token)"
    if grep -q "^${name}=" "$TARGET/.env"; then sed -i "s/^${name}=.*/${name}=${value}/" "$TARGET/.env"; else printf '%s=%s\n' "$name" "$value" >>"$TARGET/.env"; fi
  fi
}
ensure_secret SETUP_TOKEN
ensure_secret CONTROL_TOKEN
ensure_secret DISPLAY_TOKEN
ensure_secret LAB_AGENT_TOKEN
ensure_secret MAINTENANCE_TOKEN
APPLIANCE_ADDRESS="$(hostname -I | awk '{print $1}')"
CONFIGURED_TLS_HOST="$(sed -n 's/^HUB_TLS_HOST=//p' "$TARGET/.env" | tail -n 1)"
if [[ -z "$CONFIGURED_TLS_HOST" || "$CONFIGURED_TLS_HOST" == "localhost" ]]; then
  sed -i "s/^HUB_TLS_HOST=.*/HUB_TLS_HOST=${APPLIANCE_ADDRESS}/" "$TARGET/.env"
fi
if ! grep -q '^HOST_CLASSROOM_HUB_DIR=' "$TARGET/.env"; then echo "HOST_CLASSROOM_HUB_DIR=$TARGET" >> "$TARGET/.env"; fi
if ! grep -q '^HOST_SERVICES_DIR=' "$TARGET/.env"; then echo "HOST_SERVICES_DIR=$SERVICES" >> "$TARGET/.env"; fi
chmod 600 "$TARGET/.env"

# Master encryption key stays outside the application/database. It encrypts private
# keys and integration secrets stored in SQLite.
mkdir -p /etc/classroom-control-hub
if [[ ! -s /etc/classroom-control-hub/master.key ]]; then
  openssl rand -hex 32 > /etc/classroom-control-hub/master.key
fi
chown root:10001 /etc/classroom-control-hub/master.key
chmod 640 /etc/classroom-control-hub/master.key
if ! grep -q '^CLASSROOM_HUB_MASTER_KEY_FILE=' "$TARGET/.env"; then echo 'CLASSROOM_HUB_MASTER_KEY_FILE=/etc/classroom-control-hub/master.key' >> "$TARGET/.env"; fi
if ! grep -q '^DATABASE_FILE=' "$TARGET/.env"; then echo 'DATABASE_FILE=/app/data/classroom-control-hub.db' >> "$TARGET/.env"; fi

# Docker treats a missing bind-mounted file as a directory. Keep a secure empty
# migration placeholder until a Veyon key is saved through the controller.
install -d -m 0750 -o root -g 10001 /etc/classroom-control-hub/veyon
if [[ -d /etc/classroom-control-hub/veyon/private.pem ]]; then
  rmdir /etc/classroom-control-hub/veyon/private.pem 2>/dev/null || fail "Veyon key path is unexpectedly a non-empty directory"
fi
if [[ ! -e /etc/classroom-control-hub/veyon/private.pem ]]; then
  install -m 0640 -o root -g 10001 /dev/null /etc/classroom-control-hub/veyon/private.pem
fi

# Install the native host agent. It is intentionally outside Docker so systemd,
# journal and host filesystem inventory do not require privileged containers or
# namespace entry. Communication is local-only over /run/classroom-control-hub.
command -v python3 >/dev/null 2>&1 || { apt-get update && apt-get install -y python3; }
install -D -m 0644 "$TARGET/host-agent/classroom-control-hub-host-agent.service" /etc/systemd/system/classroom-hub-host-agent.service
if [[ "$TARGET" != "/opt/classroom-hub" ]]; then
  sed -i "s#/opt/classroom-hub#$TARGET#g" /etc/systemd/system/classroom-hub-host-agent.service
fi
python3 -m py_compile "$TARGET/host-agent/server.py"
# Keep the runtime directory inode stable because it is bind-mounted into the
# maintenance container. The Host Agent recreates only the socket file.
install -d -m 0750 /run/classroom-control-hub
chmod 0755 "$TARGET/host-agent/update-runner.sh"
chmod 0755 "$TARGET/host-agent/app-update-runner.sh"
install -D -m 0755 "$TARGET/host-agent/update-runner.sh" /usr/local/libexec/classroom-control-hub/update-runner.sh
install -D -m 0755 "$TARGET/host-agent/app-update-runner.sh" /usr/local/libexec/classroom-control-hub/app-update-runner.sh
cat >/etc/systemd/system/classroom-hub-update.service <<UNIT
[Unit]
Description=Classroom Control Hub Native Host Update Runner
After=network-online.target docker.service classroom-control-hub-host-agent.service
Wants=network-online.target
ConditionPathExists=$TARGET/host-agent/update-runner.sh

[Service]
Type=oneshot
User=root
Group=root
Environment=CLASSROOM_HUB_DIR=$TARGET
ExecStart=/usr/local/libexec/classroom-control-hub/update-runner.sh
TimeoutStartSec=0
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=6

[Install]
WantedBy=multi-user.target
UNIT
cat >/etc/systemd/system/classroom-hub-app-update.service <<UNIT
[Unit]
Description=Classroom Control Hub Verified Application Update Runner
After=network-online.target docker.service classroom-control-hub-host-agent.service
Wants=network-online.target
ConditionPathExists=$TARGET/host-agent/app-update-runner.sh

[Service]
Type=oneshot
User=root
Group=root
Environment=CLASSROOM_HUB_DIR=$TARGET
ExecStart=/usr/local/libexec/classroom-control-hub/app-update-runner.sh
TimeoutStartSec=0
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=6

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable classroom-hub-host-agent.service >/dev/null
systemctl restart classroom-hub-host-agent.service
for _ in $(seq 1 30); do [[ -S /run/classroom-control-hub/host-agent.sock ]] && break; sleep 0.5; done
[[ -S /run/classroom-control-hub/host-agent.sock ]] || { echo "Classroom Control Hub Host Agent socket was not created." >&2; systemctl status classroom-hub-host-agent.service --no-pager || true; exit 1; }

cd "$TARGET"
EXPECTED_VERSION="$(tr -d '\r\n' < VERSION)"
CONFIGURED_HUB_PORT="$(sed -n 's/^HUB_PORT=//p' "$TARGET/.env" | tail -n 1)"
HUB_PORT_VALUE="${HUB_PORT:-${CONFIGURED_HUB_PORT:-3000}}"
CONFIGURED_HTTPS_PORT="$(sed -n 's/^HUB_HTTPS_PORT=//p' "$TARGET/.env" | tail -n 1)"
HUB_HTTPS_PORT_VALUE="${HUB_HTTPS_PORT:-${CONFIGURED_HTTPS_PORT:-443}}"
echo "Validating source for $EXPECTED_VERSION ..."
docker run --rm -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node --check src/server.js
docker run --rm -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node --check src/storage.js
docker run --rm -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node --check maintenance-agent/server.js
docker run --rm -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node tools/validate-controller.js public/controller/index.html
python3 -m py_compile host-agent/server.py

echo "Building Classroom Control Hub appliance components ..."
docker compose build classroom-hub maintenance-agent

# Recreate maintenance after the native Host Agent is online so the bind mount
# sees the live Unix socket even on upgrades from older socket lifecycles.
echo "Starting maintenance layer ..."
docker compose up -d --force-recreate maintenance-agent
for _ in $(seq 1 30); do
  if docker compose exec -T maintenance-agent node -e "fetch('http://localhost:3010/health',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(j=>{if(!j.hostAgent?.ok)process.exit(2)})" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker compose exec -T maintenance-agent node -e "fetch('http://localhost:3010/health',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>r.json()).then(j=>{if(!j.ok||!j.hostAgent?.ok){console.error(JSON.stringify(j));process.exit(1)}})" || { echo "Maintenance-to-Host-Agent verification failed." >&2; exit 1; }

echo "Starting Classroom Control Hub backend and HTTPS gateway ..."
docker compose up -d --force-recreate classroom-hub caddy

echo "Waiting for Classroom Control Hub health ..."
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${HUB_PORT_VALUE}/health" >/dev/null 2>&1; then break; fi
  sleep 2
done

MAIN_VERSION="$(curl -fsS "http://127.0.0.1:${HUB_PORT_VALUE}/health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))')" || { echo "Health check failed. Previous files are retained at $BACKUP" >&2; exit 1; }
curl -kfsS --max-time 15 -H "Host: ${CONFIGURED_TLS_HOST}:${HUB_HTTPS_PORT_VALUE}" "https://127.0.0.1:${HUB_HTTPS_PORT_VALUE}/health" >/dev/null || { echo "HTTPS gateway health check failed. Previous files are retained at $BACKUP" >&2; docker compose ps; exit 1; }
MAINT_VERSIONS="$(docker compose exec -T maintenance-agent node -e "fetch('http://localhost:3010/health',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>r.json()).then(j=>console.log((j.version||'')+' '+(j.hostAgent?.version||'')))")"
MAINT_VERSION="${MAINT_VERSIONS%% *}"
HOST_VERSION="${MAINT_VERSIONS##* }"
if [[ "$MAIN_VERSION" != "$EXPECTED_VERSION" || "$MAINT_VERSION" != "$EXPECTED_VERSION" || "$HOST_VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "Version convergence failed: expected=$EXPECTED_VERSION backend=$MAIN_VERSION maintenance=$MAINT_VERSION host-agent=$HOST_VERSION" >&2
  exit 1
fi
echo "Verified component convergence: $EXPECTED_VERSION (backend, maintenance, host agent)"
echo
echo "Classroom Control Hub migration completed."
echo "Controller: https://${APPLIANCE_ADDRESS}:${HUB_HTTPS_PORT_VALUE}/controller/"
SETUP_TOKEN_VALUE="$(sed -n 's/^SETUP_TOKEN=//p' "$TARGET/.env" | tail -n 1)"
if [[ -n "$SETUP_TOKEN_VALUE" ]]; then
  echo "First-time setup: https://${APPLIANCE_ADDRESS}:${HUB_HTTPS_PORT_VALUE}/setup/#token=$SETUP_TOKEN_VALUE"
  echo "Treat the setup URL as a temporary administrator secret. It becomes unusable after the first administrator is created."
fi
echo "Local HTTPS uses an appliance-owned CA. Export it with: cd $TARGET && docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./classroom-hub-root-ca.crt"
[[ -d "$BACKUP" ]] && echo "Rollback snapshot: $BACKUP"
