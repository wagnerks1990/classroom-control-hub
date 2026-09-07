# AI and Contributor Operating Contract

This file is the authoritative project context for AI coding assistants and human contributors working on Classroom Control Hub.

## Source of truth

Use the repository on `main` as the source of truth. Read this file before changing application behavior. Then consult, in order:

1. `VERSION` and `CHANGELOG.md`
2. `README.md`
3. `docs/AI-CONTEXT.md`
4. the relevant document under `docs/`
5. implementation source
6. `wiki/` as the Git-tracked mirror of the GitHub Wiki

Do not infer production configuration from public defaults. Site-specific configuration belongs in runtime `.env`, persistent data, mounted secrets, or encrypted application storage.

## Current baseline

The current known-good application baseline is `1.0.0-alpha.66`.

Verified production behaviors at this baseline include:

- Ant Media Morning Announcements live detection through HLS
- local HLS playback with working announcement volume/mute control
- Morning Announcements highest-priority display/audio lock
- post-announcement failsafe scheduler resync that re-triggers the currently applicable display automations
- Background Music recovery after priority audio
- display build/version convergence
- Bison-aware class timer continuation rules

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

Persistent/runtime data must survive source updates. Never replace or commit production `.env`, databases, data, uploads, backups, master keys, private keys, credentials, or site-specific secrets.

## Upgrade model

Production is Git-first. Normal source update flow:

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

Take a filesystem/database-safe backup before production upgrades.

The GUI updater accepts only semantic-version GitHub releases and delegates the
durable update to `classroom-hub-app-update.service`. Preserve its invariant:
every update has a matching operational backup, version-aware health check, and
automatic source/database rollback. Automatic updates remain opt-in and bounded
by the database-backed maintenance window. Do not restore arbitrary source-ZIP
deployment as the normal update mechanism.

## Version convergence

A release is not complete until every user-visible/runtime version surface agrees. At minimum inspect/update:

- `VERSION`
- root `package.json`
- backend version in `src/server.js`
- controller version strings
- display renderer build string
- maintenance-agent package/server version
- host-agent version

Run repository validation and grep for stale prior alpha strings before release.

## Critical behavior invariants

### Morning Announcements

Morning Announcements have highest priority whether started manually or automatically. While active, conflicting display automations must not overwrite announcement targets and Background Music must be paused. When announcements end, the scheduler must re-evaluate the current moment and re-trigger the winning currently applicable display automations before Background Music resumes.

Do not restore a stale display snapshot or blindly replay all earlier events.

### Timer

Timer chaining is allowed only for the matching Bison continuation of the same underlying base period/class. Adjacent normal periods never chain solely because they are close in time. Transition pseudo-classes are terminal standalone timers.

### Background Music

Normal visual automations do not disturb Background Music. Unmuted priority video/stream/audio pauses it. It resumes only after priority audio ends and display automation reconciliation has completed. Remote days suppress scheduled Background Music while manual controls remain available.

### Display releases

Every display release must keep backend/controller/display build versions converged. Avoid reload loops caused by renderer/backend version mismatch.

## Hardware and integrations

Public source must stay generic. Do not hardcode production IPs, stream IDs, credentials, school names, calendars, or tokens into tracked defaults.

Important integrations include MQTT/Govee, Pluto Mark I, Music Assistant, Veyon, Ant Media/HLS, displays, and the native host agent. Health of one integration must not falsely mark unrelated integrations offline.

Slow or optional hardware probes must not block the initial Overview UI from rendering.

School and classroom identity and theming are stored in the SQLite site profile and
exposed to browser surfaces only through the presentation-safe
`/api/v1/branding` response. This project is intentionally education-only: use
school, classroom, class schedule, display/TV, teacher/operator, and
student/participant language as appropriate. Do not add a neutral organization
preset or generic organization/site/space model. Keep the Kyle Wagner
attribution present on all current user-facing pages.

## Testing before commit/release

At minimum run the validations represented by `.github/workflows/validate.yml`:

```bash
node --check src/server.js
node --check src/storage.js
node --check maintenance-agent/server.js
node tools/validate-controller.js
python -m py_compile host-agent/server.py
docker compose config
docker build -t classroom-control-hub:test .
docker build -t classroom-control-hub-maintenance:test maintenance-agent
```

For behavior changes, add targeted regression checks where practical and document what was actually verified. Never claim production testing that was not performed.

## Documentation contract

Changes that alter architecture, configuration, installation, operations, recovery, APIs, or user-visible behavior must update the corresponding file in `docs/` and, when relevant, the matching page in `wiki/`.

`wiki/` is the repository mirror of the GitHub Wiki. Keep it synchronized with the actual Wiki after documentation changes.

## Security

Never commit or reproduce live secrets. If logs or pasted output expose credentials, treat them as compromised and rotate them. Keep `.env`, private keys, database files, backups, and secret material out of Git.
