# Classroom Control Hub

Centralized classroom control and automation platform for displays, AV routing, lighting, media, announcements, schedules, and lab infrastructure.

> **Status:** `1.0.0-alpha.66` — current known-good alpha baseline. The project is being hardened and rebuilt specifically for classroom and education use.

## What it does

Classroom Control Hub provides a single web controller for classroom and lab operations, including:

- individually enrolled, revocable browser display clients and digital signage
- scheduled classroom automations
- priority live/morning announcements
- Background Music through Music Assistant
- AV routing and TV control integrations
- lighting integrations through MQTT
- class schedules, cycle days, closures, delays, half-days, and remote-day rules
- lab/client management integrations
- diagnostics, backup/recovery, and host-management tooling

## Architecture

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

The application and maintenance service run in containers. Host-level operations are delegated to a narrow systemd host agent instead of giving the main application broad host privileges.

## One-command appliance install

On a clean Ubuntu Server 24.04 LTS machine, download and run the reviewed bootstrap:

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://raw.githubusercontent.com/wagnerks1990/classroom-control-hub/main/deploy/bootstrap.sh \
  -o /tmp/classroom-hub-bootstrap.sh
sudo bash /tmp/classroom-hub-bootstrap.sh
```

It installs Docker Engine and Compose from Docker's signed package repository, clones the hub into `/opt/classroom-hub`, generates unique appliance credentials, installs the native Host Agent, starts the containers, verifies component health, and prints the secure first-time setup URL. Review the downloaded script before running it on a production machine.

Use the web controller for routine upgrades and rollback after initial installation. The bootstrap refuses to overwrite an existing installation unless `CLASSROOM_HUB_REINSTALL=true` is explicitly supplied.

## Production updates

The standard production checkout is `/opt/classroom-hub`. Production updates are Git-first:

```bash
cd /opt/classroom-hub
git fetch origin
git pull --ff-only origin main
cat VERSION
docker compose build --no-cache
docker compose up -d
docker compose ps
curl -fsS http://localhost:3000/health
```

Back up production state before upgrades and never overwrite the local `.env`, database, data, uploads, backups, or secrets with repository examples.

## Quick start for development

```bash
cp .env.example .env
docker compose build
docker compose up -d
```

Then open:

```text
http://localhost:3000
```

## Persistent data

Runtime state must remain outside the container image. The default Compose configuration stores persistent application data in `./data` and keeps site-specific secrets in `.env`, mounted secret files, or encrypted application storage.

Never commit production `.env` files, databases, API tokens, private keys, backups, or site-specific secrets.

## Site configuration

The public repository intentionally does **not** include a specific school's internal IP addresses, calendars, credentials, stream URLs, or classroom hardware mappings. Configure those after deployment through environment variables and the controller.

Important optional settings include:

- `MORNING_ANNOUNCEMENTS_URL`
- `MUSIC_ASSISTANT_URL`
- `MQTT_URL`
- `PLUTO_URL`
- `VEYON_WEBAPI_URL`
- `VEYON_SCAN_SUBNET`
- `SCHOOL_CALENDAR_ANCHOR_DATE`
- `SCHOOL_CALENDAR_ANCHOR_CYCLE_DAY`

See `.env.example`, `INSTALL.md`, and `docs/CONFIGURATION.md`.

## Documentation

Start with:

- [`INSTALL.md`](INSTALL.md) — install/migration quick guide
- [`GITHUB-MIGRATION.md`](GITHUB-MIGRATION.md) — Git migration and update workflow
- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/AI-CONTEXT.md`](docs/AI-CONTEXT.md) — compact technical context for AI assistants
- [`AGENTS.md`](AGENTS.md) — authoritative contributor/AI operating contract
- [`wiki/`](wiki/) — Git-tracked mirror of the GitHub Wiki

## AI-assisted development

AI coding assistants should read `AGENTS.md` first and then `docs/AI-CONTEXT.md`. GitHub Copilot-specific guidance is stored in `.github/copilot-instructions.md`.

Project-critical invariants include Morning Announcements priority/recovery, Bison timer behavior, Background Music recovery, version convergence, independent integration health, and preservation of production runtime state.

## Container images

GitHub Actions is configured to publish alpha container builds to GitHub Container Registry (GHCR):

```text
ghcr.io/wagnerks1990/classroom-control-hub
ghcr.io/wagnerks1990/classroom-control-hub-maintenance
```

The `alpha` tag tracks alpha builds. `latest` is intentionally reserved for a future stable release.

## Project maturity

This repository is currently alpha software. Production deployments should pin a specific version or known-good commit and maintain backups before upgrades.

## License

No public license has been selected yet. Until a license is added, normal copyright rules apply.
