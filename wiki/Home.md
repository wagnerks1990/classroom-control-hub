# Classroom Control Hub Wiki

Classroom Control Hub is a centralized classroom automation and control platform for displays, AV routing, lighting, media, live announcements, background music, schedules, and lab infrastructure.

> **Status:** 1.0.0-alpha.63 — public GitHub/Docker migration in progress.

## Start here

- [Architecture](Architecture)
- [Installation and Deployment](Installation-and-Deployment)
- [Configuration](Configuration)
- [Operations](Operations)
- [Troubleshooting](Troubleshooting)
- [Development](Development)
- [Security](Security)
- [Release and Upgrade Process](Release-and-Upgrade-Process)

## Project principles

1. Site-specific configuration stays outside the application source.
2. Persistent runtime data must survive container replacement and upgrades.
3. Morning Announcements are a priority system and may preempt normal display/audio automation.
4. Background Music is independent of visual automation and yields to priority audio.
5. Classroom schedules, cycle days, delays, half days, remote days, and closures are first-class scheduling inputs.
6. Host-level management remains separated from the main web container where practical.

## Deployment model

```text
Ubuntu host
├── Classroom Control Hub Host Agent (systemd)
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

## Repository

Source repository: https://github.com/wagnerks1990/classroom-control-hub

The repository `docs/` directory remains the canonical documentation source during migration. This `wiki/` directory is maintained in parallel so the content can be published into GitHub Wiki without rewriting documentation later.
