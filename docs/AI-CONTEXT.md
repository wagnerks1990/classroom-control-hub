# AI Project Context

This document gives AI assistants a compact operational model of Classroom Control Hub. `AGENTS.md` is the primary contributor contract; this document expands the technical context.

## Purpose

Classroom Control Hub is a centralized classroom/lab control platform. It coordinates browser displays, scheduled automations, AV routing, lighting, Morning Announcements, Background Music, class schedules, school-cycle rules, Veyon lab management, diagnostics, backup/recovery, Docker integrations, and host-management functions.

## Runtime architecture

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker Engine
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

The main application must not receive broad host privileges. Host-level operations are delegated through the maintenance service to the native Host Agent over the Unix socket.

### Appliance control plane

The controller is the appliance control plane. It inventories Docker containers already present on the host and may perform authenticated lifecycle/log/inspection operations on discovered containers. New container creation remains restricted to reviewed supported integration image repositories.

First-class optional managed add-ons are:

```text
mosquitto                 eclipse-mosquitto:latest
govee2mqtt                ghcr.io/wez/govee2mqtt:latest
music-assistant-server     ghcr.io/music-assistant/server:latest
veyon-webapi               veyon/webapi-proxy:latest
```

Setup and Infrastructure & Recovery expose these services. Existing containers should be **adopted without recreation** unless the administrator explicitly chooses deploy/recreate. Managed persistent data must live beneath the services root rather than container writable layers and should survive container removal/recreation.

The Host Agent extension may dynamically allow safe lifecycle/read operations for an existing discovered container, but `docker run` remains image-allowlisted. Do not replace this with an arbitrary root Docker command surface.

### Current network exposure

The appliance is intentionally **HTTP-only for the current development/live-test phase**. The main application publishes port `3000` directly, with `HUB_BIND_ADDRESS=0.0.0.0` by default so trusted classroom/admin LAN clients can reach it. Caddy and the built-in HTTPS/TLS gateway were removed after alpha.70 deployment failures and will be redesigned later.

Do not assume an HTTPS reverse proxy exists. Do not add Caddy/TLS dependencies, certificate checks, `HUB_TLS_HOST`, `HUB_HTTP_PORT`, or `HUB_HTTPS_PORT` back into deployment/update health gates unless HTTPS is being deliberately reintroduced as a separate reviewed feature. With no reverse proxy, `TRUST_PROXY_HOPS` defaults to `0`.

HTTP is a temporary trusted-network deployment mode. Avoid exposing the appliance directly to untrusted networks or the public Internet. Windows lab-agent HTTP enrollment keeps an explicit `-AllowHttp` acknowledgement until TLS returns.

## Persistent state

Treat these as runtime state, not replaceable source:

- `.env`
- `data/` and the SQLite database
- uploads/media/presentation data
- backups
- private keys and the master encryption key
- managed integration data beneath the services root
- site-specific hardware mappings and credentials

A Git update must preserve them.

The shared `data/` root is intentionally root-owned with group `10001` access so both the non-root application and hardened maintenance container can traverse it. Application-owned files remain UID/GID `10001:10001`; `data/backups` is maintained by the maintenance layer. Do not reintroduce code that chmods the entire shared data root to `0700`.

The current master key path is `/etc/classroom-control-hub/master.key`. Upgrades from older installations must preserve `/etc/classroom-hub/master.key` by migrating it rather than silently generating a replacement.

## Current known-good baseline

`1.0.0-alpha.71` is the current live-test recovery/stabilization baseline.

Alpha.71 recovery invariants:

- Host Agent, maintenance, backend and stamped client versions converge;
- `MAINTENANCE_TOKEN` must be non-empty before container recreation;
- maintenance Compose health checks the Host Agent directly and does not wait on the main application;
- database and scheduler readiness must pass before an update is accepted;
- installer takes SQLite-safe backups of every `data/*.db` before migration;
- `DATABASE_FILE` is authoritative and must not silently switch to another existing database filename;
- built-in access profiles are repaired when their capability array is missing/empty; Administrator must resolve to `capabilities:["*"]`;
- password strings containing punctuation survive setup/login/scrypt verification;
- setup receiver IDs remain editable and display groups must be pruned to the saved receiver set;
- supported existing integration containers can be adopted without recreation;
- HTTP-only deployment must not regain a TLS-gateway dependency.

Verified classroom behaviors remain:

- HLS is the primary Morning Announcements live/offline signal for Ant Media player URLs.
- A valid HLS playlist is LIVE; a confirmed 404 is OFFLINE; transient network errors are not definitive offline evidence.
- Two consecutive OFFLINE checks are required before automatically ending active Morning Announcements.
- Announcement playback uses a locally controlled media element so volume/mute controls work.
- Morning Announcements are highest priority and pause Background Music.
- When announcements end, the scheduler performs a failsafe resync and re-runs the currently applicable winning display automations before Background Music resumes.
- Timer continuation is limited to an explicitly linked continuation of the same base class or period.

If `VERSION` is newer, use the newer release as the version source while retaining these invariants unless explicitly changed in the changelog.

## Database identity and migrations

Alpha.70 demonstrated that two valid-looking SQLite filenames can cause a successful container recreation to start against stale state. Never infer the active database solely from existence or file age when `.env` specifies `DATABASE_FILE`.

Before migration:

1. create SQLite-safe `.backup` copies for all database files;
2. stop the main application before replacing/canonicalizing an active database;
3. validate the destination with `PRAGMA quick_check`;
4. preserve the previous database file for rollback rather than deleting it;
5. update `.env` before recreating the application;
6. verify the live container's `DATABASE_FILE`, administrator account, scheduler and database health after restart.

Maintenance backup/restore and the application runtime must agree on database identity.

## Authentication and capability profiles

An explicitly assigned access profile is authoritative and fails closed. Missing/disabled profiles must not silently regain role-default permissions.

Startup recovery may restore the default capability array only when a built-in profile exists but has a missing/empty/invalid capability list. It must not overwrite a valid non-empty custom list.

Passwords are opaque application strings. Shell troubleshooting must use safe quoting/hidden input because characters such as `!` and `#` have shell meanings even though they are normal password characters to the browser/API/scrypt implementation.

## Setup wizard invariants

Stable receiver IDs are editable. The wizard validates uniqueness and uses the explicit receiver list rather than assuming `tv1..tvN`. When receivers are removed, every display group's member list must be filtered against the remaining devices before the configuration is saved.

Optional service discovery must distinguish these actions:

- **Adopt Existing** — persist/control an already running supported service without recreation.
- **Deploy/Install** — create a missing supported service using the reviewed template.
- **Recreate/Update** — explicit destructive container replacement while preserving managed data.

Do not show a button whose backend path intentionally rejects the same operation.

## Scheduler and automation model

School calendar state affects scheduled operations. No-school days suppress scheduled classroom operations. Remote days advance the cycle but suppress scheduled classroom operations while manual controls remain available. Delay and half-day rules affect schedule resolution.

Morning Announcements override conflicting display automation. On release, do not restore stale snapshots. Re-evaluate the current schedule and select the newest currently applicable automation for each display target.

Scheduler readiness validates stored class and automation data. Invalid class times such as an end time before the start time must be rejected or repaired before migration is committed; health diagnostics should identify invalid records rather than returning only a generic failure.

## Integration model

Major integrations include MQTT/Govee, Pluto Mark I, Music Assistant / Sendspin, Veyon, Ant Media / HLS, browser display clients, and the native Host Agent.

Integration health must be independent. A Pluto failure must not make MQTT/Govee appear offline. Optional/slow hardware probes should run asynchronously and must not block the Overview screen.

Music Assistant managed Docker deployment uses host networking so local multicast discovery works and keeps its persistent `/data` outside the container. Veyon WebAPI may be adopted as an existing container/service or deployed using the supported proxy template where appropriate.

## Production configuration

The public repository intentionally uses generic configuration. Production endpoints, credentials, room names, calendar values, stream URLs, device IPs, and school-specific mappings must remain local.

The standard production checkout is `/opt/classroom-hub`. Older documentation or code referring to `/opt/classroom-control-hub` is migration-era configuration unless a deployment explicitly chose it.

School/classroom identity, integration settings and update policy are database-backed. Integration passwords, private keys, and tokens belong in the encrypted secret store and must never be returned by browser APIs. Environment variables remain bootstrap/migration fallbacks and host/container boundary configuration.

Browser displays use individually enrolled, revocable credentials. Enrollment links are one-use and expiring; raw enrollment codes and credentials must never be persisted or returned by administrative read APIs. Stable display IDs survive friendly-name changes.

## Git and release workflow

`main` is the source branch used by production. Normal supported update flow:

```bash
cd /opt/classroom-hub
git fetch origin
git pull --ff-only origin main
cat VERSION
sudo bash install.sh
```

For development rebuilds after host state is established:

```bash
docker compose build --no-cache
docker compose up -d --remove-orphans
docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

The web-managed updater uses GitHub releases and a native systemd job. It must verify backend, maintenance, Host Agent, database/scheduler health and version convergence after recreation, and restore the prior source/data state on failure. TLS/Caddy is not currently a release-health dependency.

## Documentation map

- `README.md` — public project overview
- `INSTALL.md` — installation/migration quick guide
- `GITHUB-MIGRATION.md` — Git-based migration and update workflow
- `docs/ARCHITECTURE.md` — architecture
- `docs/CONFIGURATION.md` — configuration
- `docs/CONTROLLER.md` — controller UI
- `docs/DATABASE.md` — persistence/database
- `docs/DEPLOYMENT.md` — deployment and rollback
- `docs/DEVELOPMENT.md` — development
- `docs/HOST-AGENT.md` — host agent
- `docs/OPERATIONS.md` — operations
- `docs/TROUBLESHOOTING.md` — troubleshooting
- `wiki/` — Git-tracked mirror of GitHub Wiki pages

Update documentation in the same change whenever behavior or operational procedures change.
