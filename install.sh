#!/usr/bin/env bash
set -euo pipefail

# GitHub/bootstrap source retrieval remains HTTPS; this does not enable appliance TLS.
# https://github.com/wagnerks1990/classroom-control-hub
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

# Resolve the host-side group before changing data or installing secrets.
source "$SOURCE/deploy/host-group.sh"
HUB_INSTALL_GROUP="$(ensure_hub_install_group)" || fail "Host group preflight failed"
printf 'Using host group: %s (GID 10001)\n' "$HUB_INSTALL_GROUP"

mkdir -p "$BACKUP_ROOT"
if [[ -f "$TARGET/.env" || -d "$TARGET/data" ]]; then
  echo "Existing Classroom Control Hub detected at $TARGET"
  mkdir -p "$BACKUP"
  echo "Creating pre-migration backup at $BACKUP ..."
  rsync -a \
    --exclude data/backups/ \
    --exclude 'data/*.db' \
    --exclude 'data/*.db-wal' \
    --exclude 'data/*.db-shm' \
    "$TARGET/" "$BACKUP/classroom-hub/"
  if [[ -d "$TARGET/data" ]]; then
    mkdir -p "$BACKUP/classroom-hub/data"
    while IFS= read -r -d '' db; do
      db_name="$(basename "$db")"
      echo "Creating SQLite-safe backup for $db_name ..."
      sqlite3 "$db" ".backup '$BACKUP/classroom-hub/data/$db_name'"
    done < <(find "$TARGET/data" -maxdepth 1 -type f -name '*.db' -print0)
  fi
  if [[ -d "$SERVICES" ]]; then rsync -a "$SERVICES/" "$BACKUP/services/"; fi
  docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' > "$BACKUP/docker-containers.txt" || true
  docker image ls > "$BACKUP/docker-images.txt" || true
fi

mkdir -p "$TARGET"
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
chown root:10001 "$TARGET/data" "$TARGET/data/backups"
chmod 0770 "$TARGET/data"
chmod 0700 "$TARGET/data/backups"
if [[ "$SOURCE_REAL" != "$TARGET_REAL" ]]; then
  if [[ -d "$SOURCE/config/schema" ]]; then rsync -a "$SOURCE/config/schema/" "$TARGET/config/schema/"; fi
  if [[ -f "$SOURCE/config/integrations.catalog.json" ]]; then cp -f "$SOURCE/config/integrations.catalog.json" "$TARGET/config/"; fi
  if [[ ! -f "$TARGET/config/devices.json" && -f "$SOURCE/config/devices.json" ]]; then cp "$SOURCE/config/devices.json" "$TARGET/config/"; fi
  if [[ ! -f "$TARGET/config/hardware.json" && -f "$SOURCE/config/hardware.json" ]]; then cp "$SOURCE/config/hardware.json" "$TARGET/config/"; fi
fi

if [[ ! -f "$TARGET/.env" ]]; then cp "$TARGET/.env.example" "$TARGET/.env"; fi
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
[[ -n "$APPLIANCE_ADDRESS" ]] || APPLIANCE_ADDRESS="$(hostname -f)"
set_env_path(){
  local name="$1" value="$2"
  if grep -q "^${name}=" "$TARGET/.env"; then sed -i "s#^${name}=.*#${name}=${value}#" "$TARGET/.env"; else echo "${name}=${value}" >> "$TARGET/.env"; fi
}
set_env_path HOST_CLASSROOM_HUB_DIR "$TARGET"
set_env_path HOST_SERVICES_DIR "$SERVICES"
set_env_path HOST_BACKUP_DIR "$BACKUP_ROOT"
sed -i '/^HUB_TLS_HOST=/d;/^HUB_HTTPS_PORT=/d;/^HUB_HTTP_PORT=/d' "$TARGET/.env"
CURRENT_BIND="$(sed -n 's/^HUB_BIND_ADDRESS=//p' "$TARGET/.env" | tail -n 1)"
if [[ -z "$CURRENT_BIND" ]]; then set_env_path HUB_BIND_ADDRESS "0.0.0.0"; fi
set_env_path TRUST_PROXY_HOPS "0"

# Alpha.70 could leave two SQLite database names on disk. Preserve the explicitly
# configured active database. If the env setting is missing and classroom-hub.db
# exists, prefer it even when the stale classroom-control-hub.db also exists,
# because alpha.70 live installations could run on classroom-hub.db before a
# recreation silently fell back to the other filename.
CURRENT_DATABASE="$(sed -n 's/^DATABASE_FILE=//p' "$TARGET/.env" | tail -n 1)"
if [[ -z "$CURRENT_DATABASE" ]]; then
  if [[ -f "$TARGET/data/classroom-hub.db" ]]; then
    CURRENT_DATABASE=/app/data/classroom-hub.db
  else
    CURRENT_DATABASE=/app/data/classroom-control-hub.db
  fi
fi
case "$CURRENT_DATABASE" in /app/data/*.db) ;; *) fail "DATABASE_FILE must identify a .db file beneath /app/data";; esac
CURRENT_DB_HOST="$TARGET/data/$(basename "$CURRENT_DATABASE")"
CANONICAL_DATABASE=/app/data/classroom-control-hub.db
CANONICAL_DB_HOST="$TARGET/data/classroom-control-hub.db"
if [[ "$CURRENT_DATABASE" != "$CANONICAL_DATABASE" ]]; then
  [[ -f "$CURRENT_DB_HOST" ]] || fail "Configured database $CURRENT_DATABASE does not exist"
  echo "Migrating active SQLite database $(basename "$CURRENT_DB_HOST") to canonical classroom-control-hub.db ..."
  (cd "$TARGET" && docker compose stop classroom-hub >/dev/null 2>&1) || true
  DB_STAGE="$TARGET/data/.classroom-control-hub.db.migrate-$STAMP"
  rm -f "$DB_STAGE"
  sqlite3 "$CURRENT_DB_HOST" ".backup '$DB_STAGE'"
  [[ "$(sqlite3 "$DB_STAGE" 'PRAGMA quick_check;' | tr -d '\r\n')" == "ok" ]] || { rm -f "$DB_STAGE"; fail "Canonical database migration failed SQLite integrity check"; }
  chown 10001:10001 "$DB_STAGE"
  chmod 0600 "$DB_STAGE"
  rm -f "$CANONICAL_DB_HOST-wal" "$CANONICAL_DB_HOST-shm"
  mv -f "$DB_STAGE" "$CANONICAL_DB_HOST"
  CURRENT_DATABASE="$CANONICAL_DATABASE"
fi
set_env_path DATABASE_FILE "$CANONICAL_DATABASE"
printf 'Using persistent database: %s\n' "$CANONICAL_DATABASE"
chmod 600 "$TARGET/.env"

mkdir -p /etc/classroom-control-hub
if [[ ! -s /etc/classroom-control-hub/master.key && -s /etc/classroom-hub/master.key ]]; then
  install -m 0640 -o root -g "$HUB_INSTALL_GROUP" /etc/classroom-hub/master.key /etc/classroom-control-hub/master.key
fi
if [[ ! -s /etc/classroom-control-hub/master.key ]]; then openssl rand -hex 32 > /etc/classroom-control-hub/master.key; fi
chown root:10001 /etc/classroom-control-hub/master.key
chmod 640 /etc/classroom-control-hub/master.key
if ! grep -q '^CLASSROOM_HUB_MASTER_KEY_FILE=' "$TARGET/.env"; then echo 'CLASSROOM_HUB_MASTER_KEY_FILE=/etc/classroom-control-hub/master.key' >> "$TARGET/.env"; fi

install -d -m 0750 -o root -g "$HUB_INSTALL_GROUP" /etc/classroom-control-hub/veyon
if [[ -d /etc/classroom-control-hub/veyon/private.pem ]]; then
  rmdir /etc/classroom-control-hub/veyon/private.pem 2>/dev/null || fail "Veyon key path is unexpectedly a non-empty directory"
fi
if [[ ! -e /etc/classroom-control-hub/veyon/private.pem ]]; then install -m 0640 -o root -g "$HUB_INSTALL_GROUP" /dev/null /etc/classroom-control-hub/veyon/private.pem; fi

command -v python3 >/dev/null 2>&1 || { apt-get update && apt-get install -y python3; }
install -D -m 0644 "$TARGET/host-agent/classroom-control-hub-host-agent.service" /etc/systemd/system/classroom-hub-host-agent.service
if [[ "$TARGET" != "/opt/classroom-hub" ]]; then sed -i "s#/opt/classroom-hub#$TARGET#g" /etc/systemd/system/classroom-hub-host-agent.service; fi
python3 -m py_compile "$TARGET/host-agent/server.py" "$TARGET/host-agent/start.py"
install -d -m 0750 /run/classroom-control-hub
chmod 0755 "$TARGET/host-agent/update-runner.sh" "$TARGET/host-agent/app-update-runner.sh"
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
[[ "$HUB_PORT_VALUE" =~ ^[0-9]+$ && "$HUB_PORT_VALUE" -ge 1 && "$HUB_PORT_VALUE" -le 65535 ]] || fail "HUB_PORT must be between 1 and 65535"
MIN_FREE_GB="${CLASSROOM_HUB_MIN_FREE_GB:-4}"
[[ "$MIN_FREE_GB" =~ ^[0-9]+$ ]] || fail "CLASSROOM_HUB_MIN_FREE_GB must be a non-negative integer"
AVAILABLE_KB="$(df -Pk "$TARGET" | awk 'NR==2 {print $4}')"
(( AVAILABLE_KB >= MIN_FREE_GB * 1024 * 1024 )) || fail "at least ${MIN_FREE_GB} GiB free is required beneath $TARGET"
echo "Validating source for $EXPECTED_VERSION ..."
docker run --rm --network host -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node --check src/server.js
docker run --rm --network host -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node --check src/storage.js
docker run --rm --network host -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node --check src/startup-recovery.js
docker run --rm --network host -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node --check maintenance-agent/server.js
docker run --rm --network host -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node --check maintenance-agent/extensions.js
docker run --rm --network host -v "$TARGET:/work:ro" -w /work node:22-bookworm-slim node tools/validate-controller.js public/controller/index.html
python3 -m py_compile host-agent/server.py host-agent/start.py

echo "Validating host-network listeners and building appliance components ..."
docker compose config --format json | python3 tools/validate-host-network.py
docker compose build classroom-hub maintenance-agent

echo "Starting maintenance layer ..."
docker compose up -d --force-recreate maintenance-agent
for _ in $(seq 1 30); do
  if docker compose exec -T maintenance-agent node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/host/agent/health',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(j=>{if(!j.ok)process.exit(2)})" >/dev/null 2>&1; then break; fi
  sleep 1
done
docker compose exec -T maintenance-agent node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/host/agent/health',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>r.json()).then(j=>{if(!j.ok){console.error(JSON.stringify(j));process.exit(1)}})" || { echo "Maintenance-to-Host-Agent verification failed." >&2; exit 1; }

echo "Starting Classroom Control Hub backend (HTTP) ..."
docker compose up -d --force-recreate --remove-orphans classroom-hub
docker rm -f classroom-control-hub-tls >/dev/null 2>&1 || true

HUB_HEALTH_URL="$(docker compose exec -T classroom-hub node -p "require('./src/network').localHttpUrl(process.env.PORT,process.env.BIND_ADDRESS)+'/health'")"
echo "Waiting for Classroom Control Hub health ..."
for _ in $(seq 1 90); do
  if curl -fsS "$HUB_HEALTH_URL" >/dev/null 2>&1; then break; fi
  sleep 2
done

MAIN_VERSION="$(curl -fsS "$HUB_HEALTH_URL" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))')" || { echo "Health check failed. Previous files are retained at $BACKUP" >&2; exit 1; }
MAINT_VERSION="$(docker compose exec -T maintenance-agent node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>r.json()).then(j=>console.log(j.version||''))")"
HOST_VERSION="$(docker compose exec -T maintenance-agent node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/host/agent/health',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>r.json()).then(j=>console.log(j.version||''))")"
if [[ "$MAIN_VERSION" != "$EXPECTED_VERSION" || "$MAINT_VERSION" != "$EXPECTED_VERSION" || "$HOST_VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "Version convergence failed: expected=$EXPECTED_VERSION backend=$MAIN_VERSION maintenance=$MAINT_VERSION host-agent=$HOST_VERSION" >&2
  exit 1
fi
echo "Verified component convergence: $EXPECTED_VERSION (backend, maintenance, host agent)"
echo
echo "Classroom Control Hub migration completed."
echo "Controller: http://${APPLIANCE_ADDRESS}:${HUB_PORT_VALUE}/controller/"
SETUP_TOKEN_VALUE="$(sed -n 's/^SETUP_TOKEN=//p' "$TARGET/.env" | tail -n 1)"
if [[ -n "$SETUP_TOKEN_VALUE" ]]; then
  echo "First-time setup: http://${APPLIANCE_ADDRESS}:${HUB_PORT_VALUE}/setup/#token=$SETUP_TOKEN_VALUE"
  echo "Treat the setup URL as a temporary administrator secret. It becomes unusable after the first administrator is created."
fi
echo "TLS/HTTPS is intentionally deferred. Restrict HTTP access to the trusted classroom/admin network."
[[ -d "$BACKUP" ]] && echo "Rollback snapshot: $BACKUP"
