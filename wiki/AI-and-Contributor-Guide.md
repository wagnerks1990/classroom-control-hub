# AI and Contributor Guide

AI coding assistants and contributors should treat the GitHub repository `main` branch as the source of truth.

## Read first

1. `AGENTS.md`
2. `VERSION` and `CHANGELOG.md`
3. `docs/AI-CONTEXT.md`
4. the relevant `docs/` topic page
5. implementation source

## Current baseline

The current known-good baseline is `1.0.0-alpha.67`.

Critical invariants:

- Morning Announcements are highest priority.
- Ant Media live detection uses HLS as the primary signal.
- Announcement audio is locally controlled so mute/volume work.
- When announcements end, the scheduler re-evaluates the current moment and re-triggers winning current display automations before Background Music resumes.
- Timer chaining is only for the matching Bison continuation of the same base period.
- Display/controller/backend/maintenance/host-agent versions must stay converged.
- Integration health is independent; a failure in Pluto must not falsely mark MQTT/Govee offline.
- Optional or slow hardware probes must not block the initial Overview screen.

## Standard production layout

```text
/opt/classroom-hub
/run/classroom-control-hub/host-agent.sock
```

Production runtime `.env`, databases, data, uploads, backups, private keys, master keys, tokens, endpoints, and site-specific mappings must remain outside Git.

## Production update flow

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

Always take a backup before production upgrades.

## Documentation contract

Behavior, architecture, deployment, configuration, recovery, or security changes must update the relevant `docs/` page and matching `wiki/` mirror page.

The complete AI operating contract lives in `AGENTS.md`; `docs/AI-CONTEXT.md` contains the compact technical handoff.
