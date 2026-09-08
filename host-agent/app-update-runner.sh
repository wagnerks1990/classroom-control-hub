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
    key,value=item.split('=',1); state[key]=value
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

refresh_host_agent(){
  install -D -m 0644 "$HUB_ROOT/host-agent/classroom-control-hub-host-agent.service" /etc/systemd/system/classroom-hub-host-agent.service
  if [[ "$HUB_ROOT" != /opt/classroom-hub ]]; then sed -i "s#/opt/classroom-hub#$HUB_ROOT#g" /etc/systemd/system/classroom-hub-host-agent.service; fi
  python3 -m py_compile "$HUB_ROOT/host-agent/server.py"
  chmod 0755 "$HUB_ROOT/host-agent/update-runner.sh" "$HUB_ROOT/host-agent/app-update-runner.sh"
  systemctl daemon-reload
  systemctl restart classroom-hub-host-agent.service
}

restore_safety_backup(){
  local backup="$1"
  [[ -n "$backup" ]] || return 0
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
for key in ('action','targetRef','targetCommit','expectedVersion','backupName','failureBackupName','githubToken'):
    print(key.upper()+'='+shlex.quote(str(j.get(key) or '')))
PY
)"
rm -f "$REQUEST_FILE"
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
CURRENT_COMMIT="$(git rev-parse HEAD)"
CURRENT_VERSION="$(tr -d '\r\n' < VERSION 2>/dev/null || true)"
set_state_fields "action=$ACTION" "previousCommit=$CURRENT_COMMIT" "previousVersion=$CURRENT_VERSION" "targetRef=$TARGETREF" "backupName=$BACKUPNAME"

rollback(){
  local rc=$?
  trap - ERR
  write_state rollback "Update failed; restoring the previous source and matching safety backup." null
  local rollback_ok=true
  git checkout --detach "$CURRENT_COMMIT" || rollback_ok=false
  refresh_host_agent || rollback_ok=false
  docker compose build classroom-hub maintenance-agent || rollback_ok=false
  docker compose up -d --remove-orphans || rollback_ok=false
  restore_safety_backup "$FAILUREBACKUPNAME" || rollback_ok=false
  health_check "$CURRENT_VERSION" || rollback_ok=false
  if [[ "$rollback_ok" == true ]]; then
    set_state_fields "rollback=true" "activeCommit=$CURRENT_COMMIT" "activeVersion=$CURRENT_VERSION"
    write_state rolled-back "Update failed and the previous version was restored successfully." false
  else
    set_state_fields "rollback=failed"
    write_state rollback-failed "Update failed and automatic rollback needs administrator attention." false
  fi
  exit "$rc"
}
trap rollback ERR

write_state preflight "Checking the Git checkout and resolving the verified release target." null
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "Tracked source has local changes"; exit 32; }
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
refresh_host_agent

write_state building "Building the application and maintenance images for $ACTUAL_VERSION." null
docker compose build --pull classroom-hub maintenance-agent
write_state deploying "Recreating appliance containers while preserving persistent state." null
docker compose up -d --remove-orphans
write_state verifying "Waiting for application and database health verification." null
health_check "$ACTUAL_VERSION"

if [[ "$ACTION" == revert ]]; then restore_safety_backup "$BACKUPNAME"; health_check "$ACTUAL_VERSION"; fi
trap - ERR
set_state_fields "activeCommit=$RESOLVED" "activeVersion=$ACTUAL_VERSION" "rollback=false"
write_state completed "Classroom Control Hub $ACTUAL_VERSION deployed and verified successfully." true
