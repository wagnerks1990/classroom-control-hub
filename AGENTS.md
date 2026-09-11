# AI and Contributor Operating Contract

## RoomGoblin identity and rebrand contract

The current product is **RoomGoblin — Classroom & Lab Management Hub**. The canonical tagline is **Run the room. Manage the lab.** Read `docs/brand/AI-BRAND-CONTEXT.md` and `docs/ROOMGOBLIN-REBRAND.md` before changing product naming, logos, colors, setup copy, installer copy, managed-device presentation, or documentation.

New user-facing copy must say **RoomGoblin**. Do **not** perform blind source-wide renames of legacy compatibility identifiers. Alpha.77 deliberately migrates Android from `org.classroomhub.display` to `org.roomgoblin.display`; this requires uninstalling the old app and installing the new app rather than an in-place update. Appliance paths, environment variables, service/socket/container names, persisted storage keys, API contracts, device IDs, enrollment credentials, and ADB trust material remain protected compatibility identifiers unless a separately reviewed migration supplies rollback and data-preservation tests.

## Host-network deployment contract

The Linux RoomGoblin appliance and maintenance containers, plus reviewed managed add-on templates, use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](docs/HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

This file is the authoritative project context for AI coding assistants and human contributors working on RoomGoblin.

## Source of truth

Use the repository on `main` as the source of truth. Read this file before changing application behavior. Then consult, in order:

1. `VERSION` and `CHANGELOG.md`
2. `README.md`
3. `docs/AI-CONTEXT.md`
4. `docs/brand/AI-BRAND-CONTEXT.md`
5. the relevant document under `docs/`
6. implementation source
7. `wiki/` as the Git-tracked mirror of the GitHub Wiki

Do not infer production configuration from public defaults. Site-specific configuration belongs in runtime `.env`, persistent data, mounted secrets, or encrypted application storage.

## Current baseline

The current review baseline is `1.0.0-alpha.78`.

Verified live-test/recovery behaviors inherited by this baseline include:

- direct HTTP appliance mode with Caddy/TLS intentionally deferred;
- SQLite database path reconciliation after alpha.70 left competing database filenames;
- SQLite-safe pre-migration backups for every database file;
- startup repair of incomplete built-in access profiles, including Administrator `capabilities:["*"]`;
- punctuation-heavy local passwords preserved through JSON/scrypt login paths;
- maintenance-token, master-key, Host Agent, data-root ownership, scheduler and database readiness recovery;
- maintenance startup health that checks the Host Agent directly instead of waiting on the main application;
- appliance-wide Docker discovery and lifecycle control for existing containers;
- optional managed integrations for Mosquitto, Govee2MQTT, Music Assistant and Veyon WebAPI with adopt-without-recreate and managed deploy/recreate paths;
- setup receiver IDs remain editable and display groups are pruned when receivers are removed;
- Ant Media Morning Announcements live detection through HLS;
- local HLS playback with working announcement volume/mute control;
- Morning Announcements highest-priority display/audio lock;
- post-announcement failsafe scheduler resync;
- Background Music recovery after priority audio;
- class timer continuation rules and display/client version convergence;
- compatibility-safe RoomGoblin presentation defaults while legacy deployment/device identifiers remain stable.

When a later `VERSION` exists, it supersedes this baseline, but these behavioral invariants must remain covered unless a release deliberately changes them.

## Standard production layout

The standard production checkout is:

```text
/opt/classroom-hub
```

The native host agent is:

```text
classroom-hub-host-agent.service
/run/classroom-control-hub/host-agent.sock
```

Docker services/containers are:

```text
service: classroom-hub       container: classroom-control-hub
service: maintenance-agent   container: classroom-control-hub-maintenance
```

These identifiers are intentionally legacy-compatible internals, not the current product name.

Optional RoomGoblin-managed add-ons include:

```text
mosquitto                 eclipse-mosquitto:2.0.22
govee2mqtt                ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72
music-assistant-server     ghcr.io/music-assistant/server:2.9.13
```

Native Veyon services remain host-managed. Existing Docker containers may be discovered and adopted for safe lifecycle/diagnostic control. Creation of new containers remains restricted to these pinned reviewed integration images; do not turn the Host Agent into an arbitrary root Docker command API.

Persistent/runtime data must survive source updates. Never replace or commit production `.env`, databases, data, uploads, backups, master keys, private keys, credentials, or site-specific secrets.

Supported installers and update runners must not edit tracked files or change tracked executable bits inside the production checkout. Install executable copies into `/usr/local/libexec`; a completed install must leave `git status --short` empty when the checkout was clean beforehand.

## Upgrade model

Production is Git-first. Normal supported source update flow:

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
curl -fsS http://localhost:3000/health
```

Take a filesystem/database-safe backup before production upgrades.

The GUI updater accepts only semantic-version GitHub releases and delegates the durable update to `classroom-hub-app-update.service`. Preserve its invariant: every update has a matching operational backup, version-aware health check, and automatic source/database rollback. Automatic updates remain opt-in and bounded by the database-backed maintenance window.

Core service recreation is also part of the updater contract. A release can change mounts, read-only/writable paths, environment, or networking without changing an image ID. The updater must therefore force-recreate `maintenance-agent` and `classroom-hub` when applying or rolling back a release. In particular, Managed Displays depends on the dedicated `classroom-control-hub-android-adb` volume mounted at `/managed/classroom-hub/data/android-tv/.android`; the updater must verify this path is writable before declaring the release healthy. Do not replace the force-recreate deployment with a plain `docker compose up -d` unless equivalent tested mount reconciliation exists. See `docs/MANAGED-DISPLAYS-RECOVERY.md`.

## Database identity and recovery

`DATABASE_FILE` is authoritative. Installer/update logic must never silently select another SQLite filename merely because it exists. Before a migration, back up every `data/*.db` with SQLite's `.backup` API. If database filenames are reconciled, stop the application first, verify the destination with `PRAGMA quick_check`, preserve the previous file for rollback, and update `.env` before recreating the container.

The maintenance backup/restore implementation and application runtime must agree on the canonical active database. A release that can start against a stale alternate database is not acceptable.

## Version convergence

A release is not complete until every user-visible/runtime version surface agrees. `VERSION` is the primary release value. The main image stamps controller, display, and Windows-agent runtime surfaces during the build; the maintenance image stamps its embedded runtime diagnostic version from package metadata; the Host Agent wrapper reports the release version while retaining the audited core implementation.

Run repository validation and search for unintended stale current-baseline version strings before release.

## Critical behavior invariants

### Access profiles and authentication

An explicitly assigned profile is an authorization boundary and fails closed when invalid. Built-in profiles must remain complete during migration. In particular, `administrator` must be enabled with `capabilities:["*"]`. Startup recovery may repair a built-in profile whose capability array is missing/empty, but must not overwrite an existing non-empty custom capability list.

Passwords are opaque strings to the application. Characters such as `!`, `#`, `$`, quotes, backslashes and semicolons must survive browser JSON, API handling and scrypt verification. Shell tooling must use quoting/hidden input rather than interpolating credentials into unquoted shell commands.

### Setup wizard displays

Receiver IDs are stable identifiers and remain editable. Reducing the receiver list must remove stale references from every display group before saving. Friendly names may change without changing receiver IDs or invalidating optional display credentials. Stable URL-only access for enabled configured displays is the default and must not be changed to mandatory enrollment without an explicit product decision and migration plan.

### Managed integrations and Docker control

The controller is the appliance control plane. It inventories existing Docker containers and can perform authenticated safe lifecycle/log operations on discovered containers. Supported add-ons can be adopted in place without recreation or explicitly deployed/recreated from reviewed image repositories. Persistent integration data must remain outside container writable layers and must be preserved when an add-on container is removed/recreated.

Do not silently recreate an externally discovered service during adoption. Destructive removal/recreation must remain explicit.

### Morning Announcements

Morning Announcements have highest priority whether started manually or automatically. While active, conflicting display automations must not overwrite announcement targets and Background Music must be paused. When announcements end, the scheduler must re-evaluate the current moment and re-trigger the winning currently applicable display automations before Background Music resumes.

Do not restore a stale display snapshot or blindly replay all earlier events.

### Timer

Timer chaining is allowed only for the matching continuation of the same underlying base period/class. Adjacent normal periods never chain solely because they are close in time. Transition pseudo-classes are terminal standalone timers.

### Background Music

Normal visual automations do not disturb Background Music. Unmuted priority video/stream/audio pauses it. It resumes only after priority audio ends and display automation reconciliation has completed. Remote days suppress scheduled Background Music while manual controls remain available.

### Display authentication

Classroom receivers use enabled stable display IDs without credentials by default. This is an intentional trusted-network product choice. Individual enrollment is optional and administrator-controlled; when enabled, store only hashes server-side and return a raw credential only once. Configuration saves and display renames must not invalidate optional credentials; removing a display must remove them.

## Hardware and integrations

Public source must stay generic. Do not hardcode production IPs, stream IDs, credentials, school names, calendars, or tokens into tracked defaults.

Important integrations include MQTT/Govee, Pluto Mark I, Music Assistant, Veyon, Ant Media/HLS, displays, and the native Host Agent. Health of one integration must not falsely mark unrelated integrations offline. Slow or optional probes must not block initial Overview rendering.

School and classroom identity and theming are stored in the SQLite site profile and exposed to browser surfaces only through presentation-safe responses. This project is intentionally education-only. Keep the Kyle Wagner attribution present on all current user-facing pages.

## Testing before commit/release

At minimum run the validations represented by `.github/workflows/validate.yml`:

```bash
node --check src/server.js
node --check src/storage.js
node --check src/startup-recovery.js
node --check maintenance-agent/server.js
node --check maintenance-agent/extensions.js
node tools/validate-controller.js
python -m py_compile host-agent/server.py host-agent/start.py
docker compose config
docker build -t classroom-control-hub:test .
docker build -t classroom-control-hub-maintenance:test maintenance-agent
npm test
```

For behavior changes, add targeted regression checks and document what was actually verified. Never claim production testing that was not performed.

## Documentation contract

Changes that alter architecture, configuration, installation, operations, recovery, APIs, branding, or user-visible behavior must update the corresponding file in `docs/` and, when relevant, the matching page in `wiki/`.

`wiki/` is the repository mirror of the GitHub Wiki. Keep it synchronized with the actual Wiki after documentation changes. Branding changes must also update `docs/brand/AI-BRAND-CONTEXT.md` when they change how future assistants should work.

## Security

Never commit or reproduce live secrets. Keep `.env`, private keys, database files, backups, and secret material out of Git. HTTP-only alpha deployments must be restricted to a trusted classroom/admin LAN until TLS is deliberately reintroduced and tested.

### Maintenance mutation boundary

Authenticated maintenance mutations share an appliance-wide limit of 30 requests per 60 seconds, enforced after token authentication and before both legacy and extension-wrapped routes. Excess writes return HTTP 429 with a Retry-After header; GET/HEAD/OPTIONS polling and health checks do not consume this budget. Forwarding headers cannot create new budgets. The counter is in memory and resets on a maintenance process restart.

## Host installer group prerequisite

Resolve host GID 10001 before backup/data/secret mutation. The group inside the image is not a host group record. Source `deploy/host-group.sh`, reuse an existing GID or create `classroom-hub` only when its name and ID are free, and pass the verified name to install. Fail closed on conflicts/lookup errors; never renumber existing groups, add host users to this secret-readable group, or regenerate keys for this error. Keep `test/installer-host-group.test.js` coverage and `docs/HOST-NETWORKING.md` recovery instructions synchronized.

### Sendspin transport ownership

The backend's dedicated Sendspin relay is in `src/music-assistant-sendspin.js`. It uses the configured audio port (normally 8927), not the API/web-player socket on 8095; the API token never enters raw audio frames. Keep the browser on the existing ticketed same-Hub proxy and preserve the single display-layout engine. Do not reintroduce PR #22's patch scripts or direct-browser/auto-fit experiments. See [Sendspin architecture and selective review](docs/MUSIC-ASSISTANT-SENDSPIN.md).
