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

## Clean-machine one-command installation

The supported appliance target is a clean Ubuntu Server 24.04 LTS machine on `amd64` or `arm64`. Docker does not need to be installed first.

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/wagnerks1990/classroom-control-hub/main/deploy/bootstrap.sh \
  -o /tmp/classroom-hub-bootstrap.sh
sudo bash /tmp/classroom-hub-bootstrap.sh
```

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
5. Installs/reloads the native Host Agent and verifies `/run/classroom-control-hub/host-agent.sock`.
6. Builds and starts the Classroom Control Hub and maintenance-agent containers.
7. Validates component version convergence and `/health` before reporting success.

Existing Mosquitto, Govee2MQTT, Node-RED, Music Assistant, Veyon, and other external services are not deleted by the installer.

## Git-first production deployment

For the current production model, clone directly into the standard path:

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

After the initial migration, use Git rather than replacing the application tree with ZIP contents:

```bash
cd /opt/classroom-hub
sudo git fetch origin
sudo git pull --ff-only origin main
cat VERSION
sudo docker compose build --no-cache
sudo docker compose up -d
sudo docker compose ps
curl -fsS http://localhost:3000/health
```

Take a backup first. Do not overwrite local `.env`, databases, data, uploads, backups, private keys, or master-key material.

## Host Agent verification

After installation or migration:

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock && echo "Host Agent socket OK"
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

The host and maintenance container must both see `host-agent.sock`.

## Rollback

The installer prints the pre-migration backup directory. If a migration fails, stop the new stack, restore the matching application/runtime snapshot, restore any database backup required by that version, and start the previous Compose configuration.

See `GITHUB-MIGRATION.md` and `docs/DEPLOYMENT.md` for the full production workflow.
