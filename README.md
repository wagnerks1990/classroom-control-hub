# Classroom Control Hub

Centralized classroom control and automation platform for displays, AV routing, lighting, media, announcements, schedules, and lab infrastructure.

> **Status:** `1.0.0-alpha.64` — initial public GitHub/Docker migration. The project is actively being generalized from a production classroom deployment.

## What it does

Classroom Control Hub provides a single web controller for classroom and lab operations, including:

- browser-based display clients and digital signage
- scheduled classroom automations
- priority live/morning announcements
- background music through Music Assistant
- AV routing and TV control integrations
- lighting integrations through MQTT
- class schedules, cycle days, closures, delays, half-days, and remote-day rules
- lab/client management integrations
- diagnostics, backup/recovery, and host-management tooling

## Architecture

```text
Ubuntu host
├── classroom-control-hub-host-agent.service
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

The application and maintenance service run in containers. Host-level operations are delegated to a small systemd host agent instead of giving the main application broad host privileges.

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

See `.env.example` and `INSTALL.md`.

## Container images

GitHub Actions is configured to publish alpha container builds to GitHub Container Registry (GHCR):

```text
ghcr.io/wagnerks1990/classroom-control-hub
ghcr.io/wagnerks1990/classroom-control-hub-maintenance
```

The `alpha` tag tracks alpha builds. `latest` is intentionally reserved for a future stable release.

## Project maturity

This repository is currently alpha software. Production deployments should pin a specific version and maintain backups before upgrades.

## License

No public license has been selected yet. Until a license is added, normal copyright rules apply.
