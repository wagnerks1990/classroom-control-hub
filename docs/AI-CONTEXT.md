# AI Project Context

This document gives AI assistants a compact operational model of Classroom Control Hub. `AGENTS.md` is the primary contributor contract; this document expands the technical context.

## Purpose

Classroom Control Hub is a centralized classroom/lab control platform. It coordinates browser displays, scheduled automations, AV routing, lighting, Morning Announcements, Background Music, class schedules, school-cycle rules, Veyon lab management, diagnostics, backup/recovery, and host-management functions.

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

The main application must not receive broad host privileges. Host-level operations are delegated through the maintenance service to the native host agent over the Unix socket.

## Persistent state

Treat these as runtime state, not replaceable source:

- `.env`
- `data/` and the SQLite database
- uploads/media/presentation data
- backups
- private keys and the master encryption key
- site-specific hardware mappings and credentials

A Git update must preserve them.

## Current known-good baseline

`1.0.0-alpha.67` is the current known-good production baseline.

Verified behaviors:

- HLS is the primary Morning Announcements live/offline signal for Ant Media player URLs.
- A valid HLS playlist is LIVE; a confirmed 404 is OFFLINE; transient network errors are not definitive offline evidence.
- Two consecutive OFFLINE checks are required before automatically ending active Morning Announcements.
- Announcement playback uses a locally controlled media element so volume/mute controls work.
- Morning Announcements are highest priority and pause Background Music.
- When announcements end, the scheduler performs a failsafe resync and re-runs the currently applicable winning display automations before Background Music resumes.
- Display/controller/backend version convergence is required to prevent reload loops.
- Timer continuation is limited to the matching Bison continuation of the same base period.

If `VERSION` is newer, use the newer release as the version source while retaining these invariants unless explicitly changed in the changelog.

## Scheduler and automation model

School calendar state affects scheduled operations. No-school days suppress scheduled classroom operations. Remote days advance the cycle but suppress scheduled classroom operations while manual controls remain available. Delay and half-day rules affect schedule resolution.

Morning Announcements override conflicting display automation. On release, do not restore stale snapshots. Re-evaluate the current schedule and select the newest currently applicable automation for each display target.

## Integration model

Major integrations include:

- MQTT and Govee lighting
- Pluto Mark I AV routing/control
- Music Assistant / Sendspin
- Veyon
- Ant Media / HLS
- browser display clients
- native host agent

Integration health must be independent. A Pluto failure must not make MQTT/Govee appear offline. Optional/slow hardware probes should run asynchronously and must not block the Overview screen.

## Production configuration

The public repository intentionally uses generic configuration. Production endpoints, credentials, room names, calendar values, stream URLs, device IPs, and school-specific mappings must remain local.

The standard production checkout is `/opt/classroom-hub`. Older documentation or code referring to `/opt/classroom-control-hub` should be treated as migration-era stale configuration unless a deployment explicitly chose that custom path.

School and classroom identity is database-backed. Product name, school/district
name, classroom name, logo, favicon, and color tokens are served through the
secret-free `/api/v1/branding` contract. All browser surfaces load the shared
branding client. This is an education-only product; do not introduce a generic
organization/site/space model or neutral experience preset.

MQTT/Govee, Pluto, Veyon, Music Assistant, and application-update settings are
also controller-managed and database-backed. Integration passwords, private
keys, and tokens belong in the encrypted secret store and must never be returned
by browser APIs. Environment variables remain bootstrap/migration fallbacks and
host/container boundary configuration, not the normal editing surface.

Browser displays use individually enrolled, revocable credentials. Enrollment
links are one-use and expiring; raw enrollment codes and credentials must never
be persisted or returned by administrative read APIs. A display credential is
bound to its stable display ID and must survive name/configuration edits. The
shared `DISPLAY_TOKEN` exists only as a controlled migration fallback.

## Git and release workflow

`main` is the source branch used by the current production Git workflow. Before changing source, inspect the latest branch head and relevant files. Do not overwrite runtime state when updating source.

Normal production update:

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

The web-managed updater uses GitHub releases and a native systemd job. Update
policy and history are database-backed; a private-repository read token is kept
in the encrypted secret store. The host job accepts semantic-version tags,
creates/uses a matching operational backup, verifies the expected version after
Compose recreation, and automatically restores the prior commit and backup on
failure. Do not reintroduce arbitrary source-ZIP deployment as the normal path.

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
