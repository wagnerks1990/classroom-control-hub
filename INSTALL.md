# Installation and Migration

## Standard production path

The standard production checkout is:

```text
/opt/classroom-hub
```

The standard backup root is:

```text
/opt/classroom-hub-backups
```

The native Host Agent listens on:

```text
/run/classroom-control-hub/host-agent.sock
```

## Current transport mode

Classroom Control Hub is temporarily deployed as direct HTTP while HTTPS/TLS is redesigned. The previous Caddy service is not part of the current Compose stack.

Default access:

```text
http://APPLIANCE-IP:3000/controller/
```

Default environment values:

```text
HUB_BIND_ADDRESS=0.0.0.0
HUB_PORT=3000
TRUST_PROXY_HOPS=0
```

Restrict TCP/3000 to the trusted classroom/admin network. Do not expose the HTTP-only appliance directly to the public Internet.

## Clean-machine one-command installation

The supported appliance target is a clean Ubuntu Server 24.04 LTS machine on `amd64` or `arm64`. Docker does not need to be installed first.

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/wagnerks1990/classroom-control-hub/main/deploy/bootstrap.sh \
  -o /tmp/classroom-hub-bootstrap.sh
sudo bash /tmp/classroom-hub-bootstrap.sh
```

The HTTPS command above securely retrieves the bootstrap from GitHub; the installed Hub currently uses HTTP.

Review the downloaded script before executing it. The bootstrap installs Docker Engine and Compose from Docker's signed apt repository, checks out the public repository, generates separate setup/control/display/lab/maintenance secrets, delegates to `install.sh`, and prints a first-time setup URL. Treat that URL as a temporary administrator secret; its token is unusable after the first administrator is created.

Optional environment overrides are `CLASSROOM_HUB_REF`, `CLASSROOM_HUB_DIR`, and `CLASSROOM_HUB_REPOSITORY_URL`. The bootstrap will not replace an existing deployment unless `CLASSROOM_HUB_REINSTALL=true` is deliberately set; established appliances should normally be updated or reverted from the web controller.

## Existing Classroom Control Hub deployment

From a checked-out release or staging clone, run:

```bash
sudo bash install.sh
```

The installer:

1. Uses `/opt/classroom-hub` by default, or `CLASSROOM_HUB_DIR` when explicitly overridden.
2. Creates `/opt/classroom-hub-backups/migration-<timestamp>/` by default.
3. Preserves the existing `.env`, `data/`, `config/devices.json`, and `config/hardware.json`.
4. Leaves the existing services-stack runtime data in place.
5. Ensures setup/control/display/lab/maintenance secrets are non-empty.
6. Preserves the older `/etc/classroom-hub/master.key` when migrating to `/etc/classroom-control-hub/master.key`.
7. Establishes the shared data-root ownership required by the app and maintenance service.
8. Installs/restarts the native Host Agent and verifies `/run/classroom-control-hub/host-agent.sock`.
9. Removes obsolete `HUB_TLS_HOST`, `HUB_HTTP_PORT`, and `HUB_HTTPS_PORT` values and configures direct HTTP exposure.
10. Builds and starts the Classroom Control Hub and maintenance-agent containers.
11. Removes the legacy `classroom-control-hub-tls` container when upgrading from a Caddy-based release.
12. Validates backend/database/scheduler health plus application, maintenance, and Host Agent version convergence before reporting success.

Existing Mosquitto, Govee2MQTT, Node-RED, Music Assistant, Veyon, and other external services are not deleted by the installer.

## Git-first production deployment

Clone directly into the standard path:

```bash
sudo git clone https://github.com/wagnerks1990/classroom-control-hub.git /opt/classroom-hub
cd /opt/classroom-hub
sudo cp .env.example .env
```

Edit `.env` for the local site before starting the stack. Keep the production `.env` local and never commit it.

Then install/start (do not bypass the installer with a raw first-run Compose command):

```bash
sudo bash install.sh
```

## Normal production updates

Use Git rather than replacing the application tree with ZIP contents:

```bash
cd /opt/classroom-hub
sudo git fetch origin
sudo git pull --ff-only origin main
cat VERSION
sudo bash install.sh
```

For development rebuilds after the installer has established host state:

```bash
sudo docker compose build --no-cache
sudo docker compose up -d --remove-orphans
sudo docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

Take a backup first. Do not overwrite local `.env`, databases, data, uploads, backups, private keys, or master-key material.

## Required runtime permissions

Verify:

```bash
stat -c '%n uid=%u gid=%g mode=%a' \
  /opt/classroom-hub/data \
  /opt/classroom-hub/data/backups
```

Expected shared roots:

```text
/opt/classroom-hub/data          uid=0 gid=10001 mode=770
/opt/classroom-hub/data/backups  uid=0 gid=10001 mode=700
```

Application-owned files inside `data/` remain `10001:10001`.

## Host Agent verification

After installation or migration:

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock && echo "Host Agent socket OK"
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

The host and maintenance container must both see `host-agent.sock`.

Verify maintenance readiness without printing the token:

```bash
docker exec classroom-control-hub-maintenance \
  node -e "fetch('http://127.0.0.1:3010/ready',{headers:{'x-maintenance-token':process.env.MAINTENANCE_TOKEN}}).then(async r=>console.log(r.status,await r.text())).catch(console.error)"
```

## Windows lab agents

During the HTTP-only phase, agent enrollment requires explicit acknowledgement:

```powershell
.\Install-Agent.ps1 -HubUrl http://APPLIANCE-IP:3000 -AllowHttp
```

Use this only on a trusted network.

## Rollback

The installer prints the pre-migration backup directory. If a migration fails, stop the new stack, restore the matching application/runtime snapshot, restore any database backup required by that version, and start the previous Compose configuration.

When moving forward from a release that contained Caddy, use `docker compose up -d --remove-orphans` or the supported installer so the obsolete TLS container is removed.

See `GITHUB-MIGRATION.md` and `docs/DEPLOYMENT.md` for the full workflow.
