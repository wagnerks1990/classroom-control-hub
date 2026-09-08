#!/usr/bin/env bash
set -Eeuo pipefail
STATE_DIR=/var/lib/classroom-hub
STATE_FILE="$STATE_DIR/update-status.json"
LOCK_FILE=/run/classroom-control-hub-host-update.lock
HUB_ROOT="${CLASSROOM_HUB_DIR:-/opt/classroom-hub}"
mkdir -p "$STATE_DIR"
write_state(){
  local phase="$1" message="$2" ok="${3:-null}"
  PHASE="$phase" MESSAGE="$message" OK="$ok" python3 - <<'PY2'
import json,os,datetime
p='/var/lib/classroom-hub/update-status.json'
ok=os.environ.get('OK','null')
obj={'phase':os.environ['PHASE'],'message':os.environ['MESSAGE'],'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'ok': None if ok=='null' else ok=='true','rebootRequired':os.path.exists('/var/run/reboot-required')}
open(p,'w').write(json.dumps(obj,indent=2))
PY2
}
exec 9>"$LOCK_FILE"
if ! flock -n 9; then write_state failed "Another host update job is already running." false; exit 30; fi
trap 'rc=$?; if [ $rc -ne 0 ]; then write_state failed "Host update failed with exit code $rc. Review the update log and run dpkg --audit / apt-get check before retrying." false; fi' EXIT
export DEBIAN_FRONTEND=noninteractive
write_state preflight "Checking dpkg/APT health and package-manager locks." null
if [ -n "$(dpkg --audit 2>/dev/null)" ]; then echo "dpkg --audit reported problems"; dpkg --audit; exit 31; fi
apt-get check
for f in /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock /var/lib/apt/lists/lock; do
  if command -v fuser >/dev/null 2>&1 && fuser "$f" >/dev/null 2>&1; then echo "Package manager lock in use: $f"; exit 32; fi
done
write_state refreshing "Refreshing Ubuntu package metadata." null
apt-get update
write_state installing "Installing available package updates. Automatic autoremove is intentionally disabled." null
apt-get -y upgrade
write_state verifying "Verifying package database and Classroom Control Hub health." null
dpkg --audit
apt-get check
cd "$HUB_ROOT"
published_port="$(docker compose port classroom-hub 3000 2>/dev/null | tail -n 1 | sed 's/.*://' || true)"
if [[ ! "$published_port" =~ ^[0-9]+$ ]] && [[ -f .env ]]; then published_port="$(sed -n 's/^[[:space:]]*HUB_PORT[[:space:]]*=[[:space:]]*//p' .env | tail -n 1 | tr -d '\r' | tr -d "\"'")"; fi
[[ "$published_port" =~ ^[0-9]+$ ]] || published_port=3000
curl -fsS --max-time 15 "http://127.0.0.1:${published_port}/health" >/dev/null
write_state completed "Host update completed successfully." true
trap - EXIT
