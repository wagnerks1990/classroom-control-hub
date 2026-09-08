# AI and Contributor Guide

AI coding assistants and contributors should treat the GitHub repository `main` branch as the source of truth.

## Read first

1. `AGENTS.md`
2. `VERSION` and `CHANGELOG.md`
3. `docs/AI-CONTEXT.md`
4. the relevant `docs/` topic page
5. implementation source

## Current baseline

The current live-test recovery/stabilization baseline is `1.0.0-alpha.71`.

Critical invariants:

- The appliance is temporarily HTTP-only and restricted to a trusted classroom/admin LAN; Caddy/TLS is intentionally deferred.
- `DATABASE_FILE` is authoritative. Installer migrations take SQLite-safe backups of every database, stop the app before active-database canonicalization, validate with `PRAGMA quick_check`, and preserve the prior file for rollback.
- Explicit access profiles fail closed. Built-in profiles with missing/empty capability arrays are repaired without overwriting valid custom lists; Administrator resolves to `capabilities:["*"]`.
- Passwords are opaque strings; punctuation such as `!` and `#` must survive browser/API/scrypt paths and shell troubleshooting must quote credentials safely.
- Maintenance startup health checks the Host Agent directly rather than waiting for the main application.
- Receiver IDs are stable/editable and display groups must be pruned when receivers are removed.
- The controller inventories existing Docker containers and can adopt them for safe lifecycle/log control.
- New container creation remains restricted to reviewed supported integration templates.
- Supported optional managed add-ons are Mosquitto, Govee2MQTT, Music Assistant, and Veyon WebAPI; adoption must not recreate an existing container unless explicitly requested, and persistent integration data must survive recreation/removal.
- Morning Announcements are highest priority.
- Ant Media live detection uses HLS as the primary signal.
- Announcement audio is locally controlled so mute/volume work.
- When announcements end, the scheduler re-evaluates the current moment and re-triggers winning current display automations before Background Music resumes.
- Timer chaining is only for an explicitly linked continuation of the same base class or period.
- Runtime versions must stay converged through release metadata/stamping and the Host Agent wrapper.
- Integration health is independent; a failure in Pluto must not falsely mark MQTT/Govee offline.
- Optional or slow hardware probes must not block the initial Overview screen.

## Standard production layout

```text
/opt/classroom-hub
/run/classroom-control-hub/host-agent.sock
```

Optional managed Docker services:

```text
mosquitto                 eclipse-mosquitto:latest
govee2mqtt                ghcr.io/wez/govee2mqtt:latest
music-assistant-server     ghcr.io/music-assistant/server:latest
veyon-webapi               veyon/webapi-proxy:latest
```

Production runtime `.env`, databases, data, uploads, backups, integration data, private keys, master keys, tokens, endpoints, and site-specific mappings must remain outside Git.

## Production update flow

```bash
cd /opt/classroom-hub
git fetch origin
git pull --ff-only origin main
cat VERSION
sudo bash install.sh
```

The installer is part of the supported upgrade path because it reconciles secrets, Host Agent code, data-root ownership, database identity, HTTP exposure, and migration state before container recreation.

Always take a backup before production upgrades.

## Documentation contract

Behavior, architecture, deployment, configuration, recovery, or security changes must update the relevant `docs/` page and matching `wiki/` mirror page.

The complete AI operating contract lives in `AGENTS.md`; `docs/AI-CONTEXT.md` contains the compact technical handoff.
