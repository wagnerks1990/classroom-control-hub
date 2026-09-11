# RoomGoblin Wiki

**RoomGoblin — Classroom & Lab Management Hub** is a centralized classroom and lab management platform for displays, AV routing, lighting, media, live announcements, Background Music, schedules, lab infrastructure, managed displays, and appliance integration management.

*Run the room. Manage the lab.*

> **Status:** `1.0.0-alpha.79` — alpha software; production deployment remains limited to reviewed, backed-up `amd64` installations on trusted networks.

## Start here

- [RoomGoblin Brand and Compatibility](RoomGoblin-Brand-and-Compatibility)
- [Architecture](Architecture)
- [Installation and Deployment](Installation-and-Deployment)
- [Configuration](Configuration)
- [Operations](Operations)
- [Troubleshooting](Troubleshooting)
- [Development](Development)
- [AI and Contributor Guide](AI-and-Contributor-Guide)
- [Security](Security)
- [Release and Upgrade Process](Release-and-Upgrade-Process)

## Current verified baseline

Alpha.79 retains the recovery invariants established in alpha.71 and adds:

- canonical RoomGoblin source and GHCR publication with dual-published legacy image aliases;
- full validation-matrix gating before immutable images publish;
- explicit `amd64`-only production support until `arm64` images and Android/ADB tooling are validated;
- sensitive-data confirmation for recovery backups and metadata-only support diagnostics;
- exact image-tag and retained-image rollback preservation;
- per-display Morning Announcements recovery before Background Music resumes.

The inherited baseline includes:

- direct HTTP appliance mode while TLS/Caddy is intentionally deferred;
- SQLite-safe migration backups and active-database identity preservation;
- startup recovery for incomplete built-in access profiles;
- punctuation-safe local authentication regression coverage;
- maintenance startup health independent of main-app readiness;
- editable receiver IDs with stale display-group pruning;
- appliance-wide Docker inventory/lifecycle control for existing containers;
- optional managed deployment/adoption for Mosquitto, Govee2MQTT, Music Assistant, and Veyon WebAPI;
- HLS-based Morning Announcements live detection;
- working local announcement audio volume/mute control;
- highest-priority Morning Announcements display/audio arbitration;
- post-announcement failsafe scheduler resync;
- Background Music recovery after priority audio;
- explicitly linked class-continuation rules;
- converged runtime release versioning through release metadata/stamping.

## Project principles

1. RoomGoblin is the canonical current product name; legacy Classroom Control Hub identifiers remain only where compatibility or history requires them.
2. Site-specific configuration stays outside the application source.
3. Persistent runtime data must survive container replacement and Git upgrades.
4. The configured active SQLite database must never silently switch to a stale alternate file during recreation.
5. Built-in authorization profiles must remain complete; explicit profiles fail closed.
6. Morning Announcements are a priority system and may preempt normal display/audio automation.
7. When announcements end, current scheduler state is re-evaluated rather than restoring stale display snapshots.
8. Background Music is independent of visual automation and yields to priority audio.
9. Classroom schedules, cycle days, delays, half days, remote days, and closures are first-class scheduling inputs.
10. Host-level management remains separated from the main web container through the authenticated Host Agent.
11. Existing Docker services can be adopted without recreation; new container creation remains limited to reviewed supported integration templates.
12. Optional/slow hardware integrations must not block the initial controller Overview screen.
13. Integration health is independent; one failed integration must not falsely mark unrelated integrations offline.

## Deployment model

The following internal names are retained intentionally for upgrade compatibility:

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

Optional managed add-ons:

```text
mosquitto                 eclipse-mosquitto:2.0.22
govee2mqtt                ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72
music-assistant-server     ghcr.io/music-assistant/server:2.9.13
```

## Repository and documentation

Source repository: https://github.com/wagnerks1990/RoomGoblin

The repository `docs/` directory is the canonical technical documentation set. `wiki/` is the Git-tracked mirror of this GitHub Wiki. AI coding assistants should read `AGENTS.md`, `docs/AI-CONTEXT.md`, and `docs/brand/AI-BRAND-CONTEXT.md` before modifying the project.
