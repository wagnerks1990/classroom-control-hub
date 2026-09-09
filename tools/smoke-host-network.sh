#!/usr/bin/env bash
# Requires the two :test images built by Validate. Never run against production.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
work="$(mktemp -d)"
main="hub-network-main-$$"
maint="hub-network-maint-$$"
fixture=""
cleanup(){
  rc=$?
  if [[ $rc -ne 0 ]]; then docker logs "$main" || true; docker logs "$maint" || true; fi
  docker rm -f "$main" "$maint" >/dev/null 2>&1 || true
  [[ -z "$fixture" ]] || kill "$fixture" 2>/dev/null || true
  sudo rm -rf "$work"
}
trap cleanup EXIT
chmod 0755 "$work"
mkdir -p "$work/data/backups" "$work/services"
cp VERSION "$work/VERSION"
openssl rand -hex 32 > "$work/master.key"
# Match install.sh: maintenance is root with all capabilities dropped, while
# the unprivileged application writes data through its 10001 group. Backups
# stay root-owned and private rather than relaxing security for the fixture.
sudo chown root:10001 "$work/data" "$work/data/backups" "$work/master.key"
sudo chmod 0770 "$work/data"
sudo chmod 0700 "$work/data/backups"
sudo chmod 0640 "$work/master.key"
python3 tools/fixtures/host-agent-network.py "$work/agent.sock" "$(cat VERSION)" &
fixture=$!
for _ in $(seq 1 30); do [[ ! -S "$work/agent.sock" ]] || break; sleep 1; done
[[ -S "$work/agent.sock" ]]
# Non-default actual listeners prove that host networking is not port mapping.
hub_port=37300
maint_port=37310
common=(--network host --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp -e HUB_NETWORK_MODE=host -e MAINTENANCE_TOKEN=ci-network-maintenance)
docker run -d --name "$maint" "${common[@]}" \
  -e PORT="$maint_port" -e BIND_ADDRESS=0.0.0.0 \
  -e MAIN_APP_PORT="$hub_port" -e MAIN_APP_BIND_ADDRESS=0.0.0.0 \
  -e HOST_AGENT_SOCKET=/fixture/agent.sock --tmpfs /work/uploads \
  -v "$work:/fixture:ro" -v "$work:/managed/classroom-hub" \
  -v "$work/services:/managed/services" \
  classroom-control-hub-maintenance:test >/dev/null
# Startup health must work before the main application exists.
for _ in $(seq 1 30); do
  curl -fsS --max-time 3 -H 'x-maintenance-token: ci-network-maintenance' "http://127.0.0.1:$maint_port/host/agent/health" >/dev/null && break
  sleep 1
done
curl -fsS -H 'x-maintenance-token: ci-network-maintenance' "http://127.0.0.1:$maint_port/host/agent/health" >/dev/null
docker run -d --name "$main" "${common[@]}" \
  -e PORT="$hub_port" -e BIND_ADDRESS=0.0.0.0 \
  -e MAINTENANCE_PROXY_ENABLED=true -e MAINTENANCE_URL="http://127.0.0.1:$maint_port" \
  -e MASTER_KEY_FILE=/run/secrets/master.key -e SETUP_TOKEN=ci-network-setup \
  -v "$work/master.key:/run/secrets/master.key:ro" -v "$work/data:/app/data" \
  classroom-control-hub:test >/dev/null
for _ in $(seq 1 60); do
  curl -fsS --max-time 3 "http://127.0.0.1:$hub_port/health" >/dev/null && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$hub_port/health" >/dev/null
curl -fsS -H 'x-maintenance-token: ci-network-maintenance' "http://127.0.0.1:$maint_port/health" \
  | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>{const j=JSON.parse(s);if(!j.ok||!j.application?.ok)process.exit(1)})'
curl -fsS -c "$work/cookies" -H 'X-Setup-Token: ci-network-setup' -H 'Content-Type: application/json' \
  --data '{"username":"network-admin","displayName":"CI Network","password":"CI-Network!Password#37300"}' \
  "http://127.0.0.1:$hub_port/api/v1/setup/administrator" >/dev/null
curl -fsS -b "$work/cookies" "http://127.0.0.1:$hub_port/api/v1/maintenance/health" >/dev/null
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$maint_port/health")" == 401 ]]
# Authentication must run before rate accounting. Use an unknown integration
# to exercise the real middleware without starting or stopping any add-on.
[[ "$(curl -sS -X POST -o /dev/null -w '%{http_code}' "http://127.0.0.1:$maint_port/modules/ci-unknown/deploy")" == 401 ]]
for _ in $(seq 1 30); do
  [[ "$(curl -sS -X POST -H 'x-maintenance-token: ci-network-maintenance' -o /dev/null -w '%{http_code}' "http://127.0.0.1:$maint_port/modules/ci-unknown/deploy")" == 404 ]]
done
# Both the legacy route and extension-wrapped route must be blocked, regardless
# of a forged forwarding header. Neither request is allowed to reach deployment.
for integration in ci-unknown govee2mqtt; do
  [[ "$(curl -sS -X POST -H 'x-maintenance-token: ci-network-maintenance' -H 'X-Forwarded-For: 198.51.100.99' -D "$work/limit-headers" -o /dev/null -w '%{http_code}' "http://127.0.0.1:$maint_port/modules/$integration/deploy")" == 429 ]]
  grep -Eiq '^Retry-After: [0-9]+' "$work/limit-headers"
done
[[ ! -e "$work/services/govee2mqtt" ]]
curl -fsS -H 'x-maintenance-token: ci-network-maintenance' "http://127.0.0.1:$maint_port/health" >/dev/null
for name in "$main" "$maint"; do
  [[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$name")" == host ]]
  [[ "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$name")" == 0 ]]
done
host_ip="$(hostname -I | awk '{print $1}')"
[[ -n "$host_ip" ]]
curl --noproxy '*' -fsS --max-time 5 "http://$host_ip:$hub_port/health" >/dev/null
if curl --noproxy '*' -sS --max-time 3 "http://$host_ip:$maint_port/health" >/dev/null 2>&1; then
  echo 'Maintenance incorrectly reachable on a non-loopback host interface' >&2; exit 1
fi
echo 'Host-network smoke passed: custom listeners, bidirectional proxy, startup order, token auth, mutation rate limits and loopback-only maintenance.'
