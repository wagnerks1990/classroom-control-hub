#!/usr/bin/env bash
set -Eeuo pipefail

HUB_ROOT="${CLASSROOM_HUB_DIR:-/opt/classroom-hub}"
STATE_DIR=/var/lib/classroom-hub
STATE_FILE="$STATE_DIR/app-update-status.json"
REQUEST_FILE="$STATE_DIR/app-update-request.json"
LOCK_FILE=/run/classroom-control-hub-app-update.lock
mkdir -p "$STATE_DIR"

write_state(){
  local phase="$1" message="$2" ok="${3:-null}"
  PHASE="$phase" MESSAGE="$message" OK="$ok" STATE_FILE="$STATE_FILE" python3 - <<'PY'
import datetime,json,os
p=os.environ['STATE_FILE']
try: state=json.load(open(p))
except Exception: state={}
raw=os.environ.get('OK','null')
state.update({'phase':os.environ['PHASE'],'message':os.environ['MESSAGE'],'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok':None if raw=='null' else raw=='true'})
with open(p+'.tmp','w') as f: json.dump(state,f,indent=2)
os.replace(p+'.tmp',p)
PY
}

set_state_fields(){
  STATE_FILE="$STATE_FILE" python3 - "$@" <<'PY'
import json,os,sys
p=os.environ['STATE_FILE']
try: state=json.load(open(p))
except Exception: state={}
for item in sys.argv[1:]:
    key,value=item.split('=',1)
    if value=='true': value=True
    elif value=='false': value=False
    elif value=='null': value=None
    state[key]=value
with open(p+'.tmp','w') as f: json.dump(state,f,indent=2)
os.replace(p+'.tmp',p)
PY
}

health_check(){
  local expected="$1"
  for _ in $(seq 1 90); do
    local published_port=""
    published_port="$(docker compose port classroom-hub 3000 2>/dev/null | tail -n 1 | sed 's/.*://')"
    if [[ -z "$published_port" && -f .env ]]; then
      published_port="$(sed -n 's/^[[:space:]]*HUB_PORT[[:space:]]*=[[:space:]]*//p' .env | tail -n 1 | tr -d '\r' | tr -d "\"'")"
    fi
    [[ "$published_port" =~ ^[0-9]+$ ]] || published_port=3000
    if body="$(curl -fsS --max-time 10 "http://127.0.0.1:${published_port}/health" 2>/dev/null)" && \
       EXPECTED="$expected" BODY="$body" python3 -c 'import json,os; j=json.loads(os.environ["BODY"]); raise SystemExit(0 if j.get("ok") and (not os.environ["EXPECTED"] or j.get("version")==os.environ["EXPECTED"]) else 1)'; then return 0; fi
    sleep 2
  done
  return 1
}

appliance_health_check(){
  local expected="$1"
  health_check "$expected" || return 1
  docker compose ps --status running --services | grep -qx classroom-hub || return 1
  docker compose ps --status running --services | grep -qx maintenance-agent || return 1
  docker compose exec -T maintenance-agent node -e "fetch('http://127.0.0.1:3010/health',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(r=>r.json()).then(j=>{if(!j.ok||j.version!==process.argv[1]||!j.hostAgent?.ok||j.hostAgent.version!==process.argv[1])process.exit(1)}).catch(()=>process.exit(1))" "$expected" || return 1
}

capture_recovery_image(){
  local container="$1" label="$2" id ref
  id="$(docker inspect --format '{{.Image}}' "$container")"
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  ref="classroom-control-hub-recovery:${label}"
  docker image tag "$id" "$ref"
  printf '%s' "$id"
}

activate_image_id(){
  local id="$1" service="$2" ref
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  docker image inspect "$id" >/dev/null
  ref="$(SERVICE="$service" docker compose config --format json | python3 -c 'import json,os,sys; print(json.load(sys.stdin)["services"][os.environ["SERVICE"]]["image"])')"
  [[ -n "$ref" ]] || return 1
  docker image tag "$id" "$ref"
}

ensure_runtime_layout(){
  local value
  install -d -m 0770 -o root -g 10001 "$HUB_ROOT/data"
  install -d -m 0700 -o root -g 10001 "$HUB_ROOT/data/backups"
  [[ -f .env ]] || cp .env.example .env
  value="$(sed -n 's/^MAINTENANCE_TOKEN=//p' .env | tail -n 1)"
  if [[ -z "$value" ]]; then
    value="$(openssl rand -hex 32)"
    if grep -q '^MAINTENANCE_TOKEN=' .env; then sed -i "s/^MAINTENANCE_TOKEN=.*/MAINTENANCE_TOKEN=${value}/" .env; else printf 'MAINTENANCE_TOKEN=%s\n' "$value" >> .env; fi
  fi
  sed -i '/^HUB_TLS_HOST=/d;/^HUB_HTTPS_PORT=/d;/^HUB_HTTP_PORT=/d' .env
  if grep -q '^HUB_BIND_ADDRESS=' .env; then sed -i 's/^HUB_BIND_ADDRESS=.*/HUB_BIND_ADDRESS=0.0.0.0/' .env; else echo 'HUB_BIND_ADDRESS=0.0.0.0' >> .env; fi
  if grep -q '^TRUST_PROXY_HOPS=' .env; then sed -i 's/^TRUST_PROXY_HOPS=.*/TRUST_PROXY_HOPS=0/' .env; else echo 'TRUST_PROXY_HOPS=0' >> .env; fi
  chmod 0600 .env
  install -d -m 0750 -o root -g 10001 /etc/classroom-control-hub
  if [[ ! -s /etc/classroom-control-hub/master.key && -s /etc/classroom-hub/master.key ]]; then
    install -m 0640 -o root -g 10001 /etc/classroom-hub/master.key /etc/classroom-control-hub/master.key
  fi
  if [[ ! -s /etc/classroom-control-hub/master.key ]]; then
    openssl rand -hex 32 > /etc/classroom-control-hub/master.key
    chown root:10001 /etc/classroom-control-hub/master.key
    chmod 0640 /etc/classroom-control-hub/master.key
  fi
}

refresh_host_agent(){
  install -D -m 0644 "$HUB_ROOT/host-agent/classroom-control-hub-host-agent.service" /etc/systemd/system/classroom-hub-host-agent.service
  if [[ "$HUB_ROOT" != /opt/classroom-hub ]]; then sed -i "s#/opt/classroom-hub#$HUB_ROOT#g" /etc/systemd/system/classroom-hub-host-agent.service; fi
  python3 -m py_compile "$HUB_ROOT/host-agent/server.py"
  chmod 0755 "$HUB_ROOT/host-agent/update-runner.sh" "$HUB_ROOT/host-agent/app-update-runner.sh"
  systemctl daemon-reload
  systemctl restart classroom-hub-host-agent.service
}

restore_safety_backup(){
  local backup="$1" expected_sha="${2:-}"
  [[ -n "$backup" ]] || return 0
  if [[ -n "$expected_sha" ]]; then
    local actual_sha
    actual_sha="$(sha256sum "$HUB_ROOT/data/backups/$backup" | awk '{print $1}')"
    [[ "$actual_sha" == "$expected_sha" ]] || { echo "Safety backup checksum mismatch" >&2; return 1; }
  fi
  docker exec -i -e BACKUP_NAME="$backup" classroom-control-hub-maintenance node - <<'NODE'
const name=process.env.BACKUP_NAME,token=process.env.MAINTENANCE_TOKEN;
fetch(`http://127.0.0.1:3010/backup/${encodeURIComponent(name)}/restore`,{method:'POST',headers:{'content-type':'application/json','x-maintenance-token':token},body:JSON.stringify({mode:'configuration-data',confirm:'RESTORE'})})
  .then(async r=>{const text=await r.text();if(!r.ok)throw Error(text);console.log(text)})
  .catch(e=>{console.error(e.message);process.exit(1)});
NODE
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then write_state failed "Another application update is already running." false; exit 30; fi
[[ -s "$REQUEST_FILE" ]] || { write_state failed "Application update request is missing." false; exit 31; }
eval "$(REQUEST_FILE="$REQUEST_FILE" python3 - <<'PY'
import json,os,shlex
j=json.load(open(os.environ['REQUEST_FILE']))
for key in ('action','targetRef','targetCommit','expectedVersion','rollbackCommit','rollbackVersion','backupName','backupSha256','failureBackupName','failureBackupSha256','previousHubImage','previousMaintenanceImage','githubToken'):
    print(key.upper()+'='+shlex.quote(str(j.get(key) or '')))
PY
)"
ASKPASS_FILE="" TOKEN_FILE=""
cleanup_credentials(){ [[ -z "$ASKPASS_FILE" ]] || rm -f "$ASKPASS_FILE"; [[ -z "$TOKEN_FILE" ]] || rm -f "$TOKEN_FILE"; }
trap cleanup_credentials EXIT
if [[ -n "$GITHUBTOKEN" ]]; then
  ASKPASS_FILE="$(mktemp /run/classroom-hub-git-askpass.XXXXXX)"; TOKEN_FILE="$(mktemp /run/classroom-hub-git-token.XXXXXX)"
  chmod 0700 "$ASKPASS_FILE"; chmod 0600 "$TOKEN_FILE"; printf '%s' "$GITHUBTOKEN" >"$TOKEN_FILE"
  printf '#!/bin/sh\ncase "$1" in *Username*) printf "%%s\\n" x-access-token;; *) cat %q;; esac\n' "$TOKEN_FILE" >"$ASKPASS_FILE"
  export GIT_ASKPASS="$ASKPASS_FILE" GIT_TERMINAL_PROMPT=0
fi

cd "$HUB_ROOT"
CURRENT_COMMIT="${ROLLBACKCOMMIT:-$(git rev-parse HEAD)}"
CURRENT_VERSION="${ROLLBACKVERSION:-$(tr -d '\r\n' < VERSION 2>/dev/null || true)}"
CURRENT_HUB_IMAGE="$(capture_recovery_image classroom-control-hub "hub-${CURRENT_COMMIT:0:12}")"
CURRENT_MAINTENANCE_IMAGE="$(capture_recovery_image classroom-control-hub-maintenance "maintenance-${CURRENT_COMMIT:0:12}")"
if [[ "$ACTION" == update ]]; then
  set_state_fields "action=$ACTION" "previousCommit=$CURRENT_COMMIT" "previousVersion=$CURRENT_VERSION" "previousHubImage=$CURRENT_HUB_IMAGE" "previousMaintenanceImage=$CURRENT_MAINTENANCE_IMAGE" "targetRef=$TARGETREF" "backupName=$BACKUPNAME" "backupSha256=$BACKUPSHA256"
else
  set_state_fields "action=$ACTION" "targetRef=$TARGETREF"
fi

rollback(){
  local rc=$?
  trap - ERR
  write_state rollback "Update failed; restoring the previous source and matching safety backup." null
  local rollback_ok=true
  git checkout --detach "$CURRENT_COMMIT" || rollback_ok=false
  ensure_runtime_layout || rollback_ok=false
  refresh_host_agent || rollback_ok=false
  activate_image_id "$CURRENT_HUB_IMAGE" classroom-hub || rollback_ok=false
  activate_image_id "$CURRENT_MAINTENANCE_IMAGE" maintenance-agent || rollback_ok=false
  docker compose stop classroom-hub || true
  docker compose up --no-start --no-deps --force-recreate classroom-hub || rollback_ok=false
  restore_safety_backup "$FAILUREBACKUPNAME" "$FAILUREBACKUPSHA256" || rollback_ok=false
  docker compose up -d --no-build --remove-orphans || rollback_ok=false
  appliance_health_check "$CURRENT_VERSION" || rollback_ok=false
  if [[ "$rollback_ok" == true ]]; then
    set_state_fields "rollback=true" "activeCommit=$CURRENT_COMMIT" "activeVersion=$CURRENT_VERSION"
    write_state rolled-back "Update failed and the previous version was restored successfully." false
  else
    set_state_fields "rollback=failed"
    write_state rollback-failed "Update failed and automatic rollback needs administrator attention." false
  fi
  rm -f "$REQUEST_FILE"
  exit "$rc"
}
trap rollback ERR

write_state preflight "Checking the Git checkout and resolving the verified release target." null
TRACKED_CHANGES="$(git status --porcelain --untracked-files=no)"
if [[ -n "$TRACKED_CHANGES" ]]; then
  if [[ -z "$(printf '%s\n' "$TRACKED_CHANGES" | awk '{print $2}' | grep -Ev '^config/(devices|hardware)\.json$')" ]]; then
    legacy_dir="$HUB_ROOT/data/legacy-config-migration/$(date -u +%Y%m%dT%H%M%SZ)"
    install -d -m 0700 -o 10001 -g 10001 "$legacy_dir"
    for legacy in config/devices.json config/hardware.json; do [[ ! -f "$legacy" ]] || install -m 0600 -o 10001 -g 10001 "$legacy" "$legacy_dir/$(basename "$legacy")"; done
    git checkout -- config/devices.json config/hardware.json
  else
    echo "Tracked source has unsupported local changes"; git status --short --untracked-files=no; exit 32
  fi
fi
ORIGIN_URL="$(git remote get-url origin)"
case "$ORIGIN_URL" in
  https://github.com/wagnerks1990/classroom-control-hub|https://github.com/wagnerks1990/classroom-control-hub.git|git@github.com:wagnerks1990/classroom-control-hub.git) ;;
  *) echo "Refusing update from unexpected origin: $ORIGIN_URL"; exit 36 ;;
esac
git fetch --force --prune --tags origin
if [[ "$ACTION" == revert ]]; then
  [[ "$TARGETCOMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid rollback commit"; exit 33; }
  RESOLVED="$TARGETCOMMIT"
else
  [[ "$TARGETREF" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || { echo "Only semantic-version release tags are accepted"; exit 34; }
  RESOLVED="$(git rev-parse --verify "refs/tags/$TARGETREF^{commit}")"
fi
git merge-base --is-ancestor "$RESOLVED" origin/main || { echo "Selected release is not in the trusted origin/main history"; exit 37; }
set_state_fields "targetCommit=$RESOLVED"

write_state switching "Switching the appliance source to the selected release." null
git checkout --detach "$RESOLVED"
ACTUAL_VERSION="$(tr -d '\r\n' < VERSION)"
[[ -z "$EXPECTEDVERSION" || "$ACTUAL_VERSION" == "$EXPECTEDVERSION" ]] || { echo "Release VERSION does not match GitHub metadata"; exit 35; }
ensure_runtime_layout
refresh_host_agent

if [[ "$ACTION" == revert && -n "$PREVIOUSHUBIMAGE" && -n "$PREVIOUSMAINTENANCEIMAGE" ]]; then
  write_state building "Activating the immutable images saved for $ACTUAL_VERSION." null
  activate_image_id "$PREVIOUSHUBIMAGE" classroom-hub
  activate_image_id "$PREVIOUSMAINTENANCEIMAGE" maintenance-agent
else
  write_state building "Building the application and maintenance images for $ACTUAL_VERSION." null
  docker compose build --pull classroom-hub maintenance-agent
fi
if [[ "$ACTION" == revert ]]; then
  write_state restoring "Restoring the matching pre-upgrade state before the older application starts." null
  docker compose stop classroom-hub || true
  docker compose up --no-start --no-deps --force-recreate classroom-hub
  restore_safety_backup "$BACKUPNAME" "$BACKUPSHA256"
fi
write_state deploying "Recreating HTTP appliance containers while preserving persistent state." null
docker compose up -d --no-build --remove-orphans
# Remove the legacy Caddy container from releases that included the TLS gateway.
docker rm -f classroom-control-hub-tls >/dev/null 2>&1 || true
write_state verifying "Waiting for backend HTTP, maintenance, Host Agent, and version convergence." null
appliance_health_check "$ACTUAL_VERSION"

trap - ERR
if [[ "$ACTION" == revert ]]; then
  set_state_fields "activeCommit=$RESOLVED" "activeVersion=$ACTUAL_VERSION" "rollback=false" "revertAvailable=false" "previousCommit=" "previousVersion=" "previousHubImage=" "previousMaintenanceImage=" "backupName=" "backupSha256="
else
  set_state_fields "activeCommit=$RESOLVED" "activeVersion=$ACTUAL_VERSION" "rollback=false" "revertAvailable=true"
fi
install -D -m 0755 "$HUB_ROOT/host-agent/update-runner.sh" /usr/local/libexec/classroom-control-hub/update-runner.sh
install -D -m 0755 "$HUB_ROOT/host-agent/app-update-runner.sh" /usr/local/libexec/classroom-control-hub/app-update-runner.sh
rm -f "$REQUEST_FILE"
write_state completed "Classroom Control Hub $ACTUAL_VERSION deployed and verified successfully over HTTP." true
