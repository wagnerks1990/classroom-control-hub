# Classroom Control Hub Wiki

Classroom Control Hub is a centralized classroom automation and control platform for displays, AV routing, lighting, media, live announcements, Background Music, schedules, and lab infrastructure.

> **Status:** `1.0.0-alpha.66` — current known-good alpha baseline.

## Start here

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

At alpha.66, the production baseline includes:

- HLS-based Morning Announcements live detection
- working local announcement audio volume/mute control
- highest-priority Morning Announcements display/audio arbitration
- post-announcement failsafe scheduler resync that re-triggers the currently applicable display automation
- Background Music recovery after priority audio
- Bison-aware timer continuation rules
- converged backend/controller/display/maintenance/host-agent versioning

## Project principles

1. Site-specific configuration stays outside the application source.
2. Persistent runtime data must survive container replacement and Git upgrades.
3. Morning Announcements are a priority system and may preempt normal display/audio automation.
4. When announcements end, current scheduler state is re-evaluated rather than restoring stale display snapshots.
5. Background Music is independent of visual automation and yields to priority audio.
6. Classroom schedules, cycle days, delays, half days, remote days, and closures are first-class scheduling inputs.
7. Host-level management remains separated from the main web container.
8. Optional/slow hardware integrations must not block the initial controller Overview screen.
9. Integration health is independent; one failed integration must not falsely mark unrelated integrations offline.

## Deployment model

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

## Repository and documentation

Source repository: https://github.com/wagnerks1990/classroom-control-hub

The repository `docs/` directory is the canonical technical documentation set. `wiki/` is the Git-tracked mirror of this GitHub Wiki. AI coding assistants should read `AGENTS.md` and `docs/AI-CONTEXT.md` before modifying the project.
