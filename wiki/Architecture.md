# Architecture

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

## Main application

The Node.js service provides the controller UI, APIs, scheduler, display orchestration, class/calendar rules, automation execution, media control, announcement handling, integrations, diagnostics, and persistence access.

The main application should not require unrestricted host privileges. Runtime state is mounted into the container instead of being baked into the image.

## Display clients

Displays are browser/kiosk endpoints with stable IDs. They render classroom slides, text, timers, images, video, web content, and priority announcements.

Display clients must tolerate disconnect/reconnect and converge to current server state. Backend and renderer version identifiers must therefore remain synchronized across releases.

## Scheduler and calendar engine

The scheduler evaluates normal weekday schedules, linked classes, cycle-day rules, no-school dates, remote days, half days, delayed starts, transition periods, Bison continuation rules, and manual execution requests.

Calendar exceptions are resolved before ordinary scheduling. Deployment-specific calendars belong in persistent configuration, not public source constants.

## Priority model

```text
Morning / priority live announcement
        >
Priority automation audio/video
        >
Normal visual automation
        >
Background music
```

Morning Announcements use a hard priority lock. While active, announcement displays are reserved, background music remains paused, conflicting scheduled automations are deferred, and manual automation runs cannot overwrite the announcement. When the announcement ends, Classroom Control Hub reconciles deferred/current classroom content before background music resumes.

Manual and automatically detected announcements use the same runtime priority state.

## Background music

Background Music is an independent scheduler backed by Music Assistant. Silent/visual classroom automation should not disturb it. Priority audio pauses it temporarily. Recovery logic reconciles against the actual Music Assistant player/group state rather than relying only on cached state.

## Maintenance Agent

Maintenance-specific operations are kept separate from the main application so they do not broaden the primary service's privileges unnecessarily.

## Host Agent

The host agent runs as a controlled systemd service on Ubuntu for operations that genuinely need host visibility or privileges. It should expose a narrow authenticated interface rather than giving the main web container unrestricted host access.

## Persistence

A production deployment should keep persistent state outside replaceable containers:

```text
/opt/classroom-control-hub/
├── docker-compose.yml
├── .env
├── data/
│   └── classroom-control-hub.db
├── uploads/
├── backups/
└── secrets/
```

## Configuration boundary

Public source must not contain production passwords, tokens, private keys, internal infrastructure details, student/user data, or deployment-specific secrets. Site branding, stream endpoints, Music Assistant details, classroom calendars, device configuration, and credentials should be supplied at runtime.

## Release/version convergence

All embedded version identifiers must change together across backend, display renderer, controller, maintenance agent, and host agent. A stale display renderer can otherwise cause reconnect/reload loops.
