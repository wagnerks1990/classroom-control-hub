# AI and Contributor Guide

See [Host Networking](Host-Networking) for the current Linux container topology, loopback-only maintenance API, explicit add-on migration, listener ports and recovery rules.

AI coding assistants and contributors should treat the GitHub repository `main` branch as the source of truth.

## Read first

1. `AGENTS.md`
2. `VERSION` and `CHANGELOG.md`
3. `docs/AI-CONTEXT.md`
4. the relevant `docs/` topic page
5. implementation source

## Current baseline

The current production-readiness review baseline is `1.0.0-alpha.79`.

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

## Dedicated Sendspin transport (selective PR #22 migration)

TVs retain PR #27's ticketed, same-Hub socket validation. The backend alone connects to the configured `sendspinHost:sendspinPort` (normally `:8927/sendspin`) using `src/music-assistant-sendspin.js`. Music Assistant control remains on the authenticated API; never send its token/auth preamble to the raw Sendspin port or consume the first audio/protocol frame as an auth reply. Preserve PR #28's exact host-alias mapping and saved remote/IPv6 settings. The relay bounds buffers and cancels connection timers on all close/error paths.

Do not restore the stashed legacy `server.js`, run PR #22 patch scripts, merge its old font-sizing code, or switch receivers to direct MA sockets. No renderer, SDK, autoplay, database, enrollment or Compose changes are part of this migration. See [Music Assistant Sendspin](Music-Assistant-Sendspin) for the file-by-file review, tests and upgrade acceptance procedure.
