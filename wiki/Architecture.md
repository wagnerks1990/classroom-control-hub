# Architecture

See [Host Networking](Host-Networking) for the current Linux container topology, loopback-only maintenance API, explicit add-on migration, listener ports and recovery rules.

Classroom Control Hub separates the classroom application, browser display clients, persistence, maintenance functions, host-level administration, and external integrations.

```text
Operator Browser
      |
      v
Classroom Control Hub API / Controller
      |
      +---- Display WebSocket / browser clients
      +---- Scheduler / automation engine
      +---- Media and announcement arbitration
      +---- Music Assistant integration
      +---- AV / lighting / lab integrations
      +---- SQLite persistent state
      |
      +---- Maintenance Agent
      |
      +---- Host Agent (systemd on host)
```

## Standard production topology

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

## Main application

The Node.js service provides controller UI/API, scheduler, display orchestration, class/calendar rules, automation execution, media control, announcement handling, integrations, diagnostics, and persistence access.

The main application does not require unrestricted host privileges. Runtime state is mounted into the container rather than baked into the image.

## Display clients

Displays are browser/kiosk endpoints with stable IDs. They render classroom slides, text, timers, images, video, web content, and priority announcements.

Display clients tolerate disconnect/reconnect and converge to current server state. Backend/controller/display version identifiers remain synchronized across releases.

## Scheduler and calendar engine

The scheduler evaluates normal weekdays, linked classes, cycle-day rules, no-school dates, remote days, half days, delayed starts, transition periods, explicit continuation rules, and manual execution requests.

Calendar exceptions are resolved before ordinary scheduling. Deployment-specific calendars belong in persistent configuration, not public source constants.

## Priority model

```text
Morning / priority live announcement
        >
Priority automation audio/video
        >
Normal visual automation
        >
Background Music
```

Morning Announcements use a hard priority lock. While active, announcement displays are reserved, Background Music remains paused, conflicting scheduled automations are deferred, and manual automation runs cannot overwrite locked targets.

Manual and automatic announcement starts use the same runtime priority state.

## HLS Morning Announcements

For Ant Media player URLs, HLS is the primary live-state/playback transport when derivable.

- 200 + valid `#EXTM3U` playlist = LIVE
- 404 = OFFLINE
- network/timeout/5xx = UNKNOWN/error
- blocked REST diagnostics do not override HLS

Two confirmed OFFLINE checks are required before automatic release. Playback uses a local media element so announcement volume/mute controls act on the actual player.

## Post-announcement failsafe resync

When announcements end:

1. clear announcement content;
2. release the priority lock;
3. mark announcement runtime inactive;
4. consume deferred trigger bookkeeping;
5. re-evaluate current date/class/time;
6. choose the newest currently applicable display automation independently per target;
7. re-run the winning current automations;
8. reconcile/resume Background Music afterward.

The system deliberately does not restore stale pre-announcement snapshots.

## Background Music

Background Music is an independent scheduler backed by Music Assistant. Silent/visual automation does not disturb it. Priority audio pauses it temporarily. Recovery reconciles against the actual Music Assistant player/group state.

## Integration health and responsiveness

Each integration reports independently. A Pluto failure must not make MQTT/Govee appear offline. Slow optional hardware probes must not block the initial Overview render.

## Maintenance Agent

Maintenance-specific operations are separate from the main application so they do not broaden the primary service's privileges unnecessarily.

## Host Agent

The Host Agent runs as a controlled systemd service and listens only on `/run/classroom-control-hub/host-agent.sock`. The maintenance container receives the socket through a bind mount.

## Persistence

Production persistent state remains outside replaceable containers/source:

```text
/opt/classroom-hub/
├── docker-compose.yml
├── .env
├── data/
│   └── classroom-control-hub.db
├── uploads/
├── backups/
└── secrets/
```

## Configuration boundary

Public source must not contain production passwords, tokens, private keys, internal topology, student/user data, or deployment-specific secrets. Site branding, stream endpoints, Music Assistant details, classroom calendars, device configuration, and credentials are supplied at runtime.

## Release/version convergence

All embedded version identifiers change together across backend, display renderer, controller, maintenance agent, and host agent. A stale renderer can otherwise cause reconnect/reload loops.

## AI context

`AGENTS.md` is the authoritative AI/contributor operating contract and `docs/AI-CONTEXT.md` is the compact technical handoff. Architecture changes that affect future reasoning should update those files and this Wiki mirror.
