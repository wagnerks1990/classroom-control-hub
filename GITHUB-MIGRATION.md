# Migrating an Existing RoomGoblin Installation

The public GitHub repository intentionally contains generic defaults. Do not overwrite production `.env`, databases, hardware mappings, media, backups, private keys, or secrets with repository examples.

## Standard production layout

The current standard production checkout is:

```text
/opt/classroom-hub
```

The Host Agent socket is:

```text
/run/classroom-control-hub/host-agent.sock
```

Older migration-era references to `/opt/classroom-control-hub` are stale unless a deployment intentionally chose that as a custom `CLASSROOM_HUB_DIR`.

## Before switching to Git

Create a complete pre-Git snapshot:

```bash
sudo cp -a /opt/classroom-hub "/opt/classroom-hub-backup-before-git-$(date +%Y%m%d-%H%M%S)"
```

Keep these production files/data outside Git:

- `.env`
- `data/` and production SQLite databases
- uploads/media/presentation data
- private keys and master keys
- backups
- site-specific hardware mappings
- local credentials and tokens

## Initial Git migration

If `/opt/classroom-hub` already contains the legacy application, preserve it first, then clone the repository into the standard path and restore only runtime state.

Example approach:

```bash
cd /opt
sudo mv classroom-hub classroom-hub-legacy
sudo git clone https://github.com/wagnerks1990/RoomGoblin.git /opt/classroom-hub
```

Restore the production `.env`, persistent data, uploads/backups, and required secret mounts from the preserved installation. Do not copy old tracked application source over the Git checkout.

Then install/reconcile the Host Agent and containers using `install.sh` or the documented deployment steps.

## Host Agent migration check

A common migration failure is a stale systemd unit still pointing at an older install directory or socket. Verify:

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

The native service and maintenance container must both use `/run/classroom-control-hub/host-agent.sock`.

## Integration configuration check

Git defaults are intentionally generic. After migration, verify local environment values for integrations such as:

- `MQTT_URL`
- `PLUTO_URL`
- `MUSIC_ASSISTANT_URL`
- `VEYON_WEBAPI_URL`
- Morning Announcements stream/player configuration

A missing optional integration must not be treated as an application failure, and one integration's failure must not make unrelated integrations appear offline.

## Normal Git update workflow

After migration, use:

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

Before deploying, confirm the working tree is clean except for intentionally local ignored runtime files:

```bash
git status --short
```

## Development clone

```bash
git clone https://github.com/wagnerks1990/RoomGoblin.git
cd RoomGoblin
cp .env.example .env
```

For production, edit `.env` locally and never commit it.

## AI/contributor context

AI assistants and contributors should read `AGENTS.md` and `docs/AI-CONTEXT.md` before making changes. Those files document the known-good behavioral invariants, production layout, release rules, and documentation contract.
