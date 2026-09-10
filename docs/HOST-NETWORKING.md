# Host networking and migration

## Supported architecture

The Linux appliance uses host networking for both `classroom-hub` and `maintenance-agent`, including their Compose build networks. All supported Hub-managed Docker deployment templates use `--network host`: Mosquitto, Govee2MQTT, Music Assistant, and optional Node-RED. Native Veyon and the native Host Agent already use the host; do not deploy a second Veyon WebAPI container alongside the native service.

This changes the containers' network namespace, not their ownership or filesystem privileges. The core containers retain read-only roots, dropped capabilities, no-new-privileges, scoped mounts, and no Docker socket. Host Agent communication remains authenticated over its Unix socket. Host networking does reduce network isolation: containers can reach host-local services, and listeners bound to all interfaces are directly exposed on host interfaces.

The supported deployment is Docker Engine on the Linux appliance. Docker Desktop opt-in host networking and rootless Docker do not guarantee equivalent physical-LAN discovery behavior. Do not assume that a Desktop/VM host-network test validates the classroom LAN.

Authenticated maintenance mutations share an appliance-wide limit of 30 requests per 60 seconds, enforced after token authentication and before both legacy and extension-wrapped routes. Excess writes return HTTP 429 with a Retry-After header; GET/HEAD/OPTIONS polling and health checks do not consume this budget. Forwarding headers cannot create new budgets. The counter is in memory and resets on a maintenance process restart.

## Listeners and addresses

| Component | Default listener | Configuration / boundary |
| --- | --- | --- |
| Controller, API, display WebSocket | `0.0.0.0:3000` | `HUB_BIND_ADDRESS`, `HUB_PORT`; trusted classroom/admin LAN only |
| Maintenance API | `127.0.0.1:3010` | `MAINTENANCE_PORT`; loopback binding enforced in application code |
| Mosquitto | TCP `1883` | Managed broker `port` writes the actual `listener` value; authentication remains required |
| Govee2MQTT | Integration-specific discovery/control | Outbound MQTT defaults to `127.0.0.1`; native LAN discovery is preserved |
| Music Assistant | UI/API `8095`, stream service normally `8097` | Preserve the service's own configuration and discovery requirements |
| Node-RED | TCP `1880` | Managed `port` becomes `PORT`; persistent custom `settings.js` must honor `process.env.PORT` |
| Native Veyon WebAPI | TCP `11080` | Hub uses `http://127.0.0.1:11080`; native service binding/firewall remains administrator-managed |
| Native Host Agent | Unix socket | `/run/classroom-control-hub/host-agent.sock`; not a TCP API |

There are no runtime `ports:`, service `networks:`, Docker service-name DNS dependencies, or host-gateway entries in the shipped Compose stack. Docker port publishing does not translate ports in host mode. A previous mapping `3800:3000` must become an actual application listener on `3800`, not a new `ports:` entry.

Core health checks, updater verification, and the maintenance-to-application connection use effective listener ports and bind addresses. `HUB_PORT` and `MAINTENANCE_PORT` must be different. The installer preserves explicit loopback and LAN bindings rather than widening them to `0.0.0.0`.

## Saved settings and browser links

When `HUB_NETWORK_MODE=host` (set by Compose), integration URL resolution maps the exact old hostname `host.docker.internal` to `127.0.0.1`. Known integration aliases such as `mosquitto`, `music-assistant-server`, and the old core service names are translated only in their applicable connection context. Remote IPs, school DNS names, ports, and paths remain unchanged. This compatibility layer does not rewrite credentials or the SQLite database. New defaults and controller placeholders use loopback directly.

Loopback is a **server-side** address. Displays and administrator browsers on other machines still use the appliance's LAN address. The Open Music Assistant action substitutes the current appliance hostname for a host-local API URL; do not enter `127.0.0.1` as a display's Hub address. A saved old core URL with a custom port still needs the correct actual port; compatibility resolution changes hostnames, not guessed ports.

## Installer stops with invalid group 10001

The host installer must resolve the application group independently of the Docker image. The reported `install: invalid group: '10001'` occurs at a host-side key/directory installation operation, before the image build and container recreation steps. It is not a Docker-network error. The exact host install implementation must be checked before attributing its numeric-ID behavior to a particular coreutils version.

`install.sh` now runs `deploy/host-group.sh` before runtime backup/data/secret operations. It queries host GID 10001 through `getent`, reuses its existing group name, or creates the system group `classroom-hub` with exactly GID 10001 when both the ID and name are free. `install` receives the resolved name; numeric file ownership remains unchanged. It does not create a host login account, add members, renumber groups or use `groupadd --force`/`--non-unique`. An occupied name with a different GID, an NSS lookup error, or a failed group creation stops installation. Reusing an existing GID does not validate its membership; administrators must keep host GID 10001 restricted to trusted principals because it can read mounted Hub secrets.

Recovery: retain the existing source and migration backups, preserve local edits, update the clean main checkout with `git pull --ff-only origin main`, and rerun `sudo bash install.sh`. No source-file workaround or key/database deletion is required for this group-resolution error. Rerunning the installer performs its normal backups and remaining setup; it is not a rollback and it will interrupt the Hub when it reaches container recreation. The earlier partial attempt may already have changed data permissions and canonical database configuration, so do not assume the whole installation was untouched. Never regenerate a populated master key to address this error.

Inspect `getent group 10001` and `install --version` locally when resolution still fails. On success the installer prints `Using host group: <name> (GID 10001)`. Final acceptance remains the normal version/health checks and `network=host` for both core containers. A successful source pull alone does not establish a successful deployment.

Regression coverage: `test/installer-host-group.test.js` exercises missing/existing groups, alternate existing names, collisions, lookup/creation failures, idempotence and installer ordering with isolated command mocks. These tests do not mutate the developer machine's account database.

References: https://manpages.ubuntu.com/manpages/noble/man1/getent.1.html and https://manpages.ubuntu.com/manpages/noble/man8/groupadd.8.html

## Upgrade preflight

1. Schedule an interruption. Record the current Git commit and image IDs. Make a SQLite-safe/full operational backup and back up each add-on's persistent state. Save local source changes separately with restrictive file permissions; do not discard them with `git reset --hard` or overwrite a dirty checkout.
2. Review `docker inspect` mounts, environment, restart policy, and network mode for existing containers locally. Inspection output may contain secrets; do not attach it to public issues. Preserve custom mounts, MQTT credentials, Node-RED flows/settings, and Music Assistant data before recreating anything.
3. Review `ss -lntup` for host-port conflicts, including native services and existing published bridge ports. Check host firewall policy for every actual add-on listener. Never open maintenance port 3010 to the LAN; no Docker publishing boundary protects host-network listeners.
4. Reconcile local Compose overrides. Remove inherited `ports`, bridge `networks`, and obsolete host-gateway dependencies. The shipped preflight refuses conflicting effective configuration rather than silently ignoring it:

```bash
docker compose config --format json | python3 tools/validate-host-network.py
```

This validates effective configuration, including core port ranges, collisions, and maintenance isolation. It does **not** prove that arbitrary host ports are free. Rendered Compose includes secrets; pipe it directly to the validator and do not publish it.

After reconciling local changes and updating the checkout to the approved commit, run `sudo bash install.sh`. The installer backs up existing runtime data, refreshes the native Host Agent policy, builds images, and **recreates** the two core containers. A restart alone cannot change a container's networking. Existing `.env` integration aliases remain supported at runtime.

## Existing add-ons: explicit recreation

Code changes do not change existing containers' immutable network mode. The controller shows network mode in Docker inventory and integration cards, including a migration warning for existing non-host containers. **Adopt** remains non-destructive and does not migrate networking.

For a supported add-on already using the Hub's managed data layout, verify its saved settings and mounts, then use **Save & Recreate**. Confirm the interruption and check the resulting network mode and service health. Managed broker/Node-RED custom ports become real service listeners, not Docker translations. Settings validation happens before removal, but recreation is not an atomic rollback transaction; preserve a recovery definition and data backup first.

For an externally owned Compose stack, change its original Compose definition to `network_mode: host`, remove `ports`/`networks`, update actual listener settings and local dependency URLs, and recreate through that stack. Do not use a Hub template to replace an external container whose custom mounts/settings have not been migrated into the reviewed managed layout. Otherwise the original Compose stack may restore bridge mode on the next update.

Do not bulk-recreate arbitrary containers, disable Docker's daemon bridge globally, run network/volume prune, or remove unrelated stacks. This change covers the Hub deployment and reviewed add-on templates, not every unrelated Docker application on the server.

## Acceptance checks

```bash
docker inspect --format '{{.Name}} network={{.HostConfig.NetworkMode}}' \
  classroom-control-hub classroom-control-hub-maintenance
docker compose exec -T classroom-hub node -e \
  "fetch(require('./src/network').localHttpUrl(process.env.PORT,process.env.BIND_ADDRESS)+'/health').then(async r=>{console.log(r.status,await r.text());if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
docker compose exec -T maintenance-agent node -e \
  "fetch('http://127.0.0.1:'+process.env.PORT+'/health',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(async r=>{console.log(r.status,await r.text());if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
sudo ss -lntup
```

Both core modes must be `host`. Empty published-port columns are expected; inspect actual listeners. Maintenance must listen only on loopback and reject unauthenticated requests. From another machine, confirm maintenance is unreachable while the intended controller LAN address works. Verify stable display URL/WebSocket access (and enrollment if optional authentication is enabled), MQTT authentication, Govee control/discovery, Music Assistant playback/discovery, Veyon authentication/control, and a backup/restore health probe. Host networking does not repair VLAN isolation, Wi-Fi client isolation, firewalls, invalid credentials, or application/rendering bugs.

## Rollback and validation evidence

Rollback requires the previous source/Compose definition and image, followed by container recreation; also restore add-ons through their previous deployment definitions. Use the application's operational backup/revert mechanism when a database migration is involved. Retain `.env`, master keys, and persistent data. Do not replace a newer database with a stale copy casually.

Automated coverage is in `test/host-networking.test.js`, `tools/validate-host-network.py`, and `tools/smoke-host-network.sh`. The container smoke test uses a **fake native Host Agent fixture** to validate networking and authentication boundaries, not real host administration or physical device discovery. Passing CI is not proof of a successful live classroom migration.

## Upstream references

- Docker: https://docs.docker.com/engine/network/drivers/host/
- Compose: https://docs.docker.com/compose/how-tos/networking/
- Music Assistant: https://www.music-assistant.io/installation/
- Mosquitto listener configuration: https://mosquitto.org/man/mosquitto-conf-5.html
- Node-RED default settings: https://github.com/node-red/node-red/blob/main/packages/node_modules/node-red/settings.js
