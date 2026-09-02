# Architecture

## Overview

Classroom Control Hub is a centralized classroom/lab automation platform. The architecture separates the classroom application, maintenance functions, host-level administration, browser-based display clients, persistent state, and external integrations.

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

## Major components

### Main application

The main Node.js service provides the controller UI, APIs, scheduler, display orchestration, class/calendar rules, automation execution, media control, announcement handling, integration adapters, diagnostics, and persistence access.

The main application should run without privileged host access. Persistent data is mounted into the container rather than baked into an image.

### Display clients

Display clients are browser/kiosk endpoints identified by stable display IDs. They receive state from Classroom Control Hub and render classroom content such as slides, text, timers, images, video, web content, and priority announcements.

Display code must tolerate reconnection. A reconnect must converge to current server state without causing a permanent reload loop. Renderer/server version identifiers therefore need to remain synchronized across releases.

### Scheduler and class-calendar engine

The scheduler evaluates:

- enabled automations;
- class-linked occurrences;
- normal weekday schedules;
- cycle-day rules;
- no-school dates;
- remote days;
- half days;
- delayed starts;
- transition periods;
- Bison/continuation rules;
- manual execution requests.

Calendar exceptions must be resolved before normal occurrence execution. Site-specific school calendars are runtime configuration, not public source constants.

### Priority arbitration

Content and audio are not treated as equal-priority operations. The intended priority model is:

```text
Morning / emergency-style live announcement
        >
Explicit priority automation audio/video
        >
Normal visual classroom automation
        >
Background music
```

Morning Announcements use a hard priority lock. While active:

- announcement target displays are reserved for the announcement;
- background music is paused;
- scheduled automations that would conflict are deferred;
- manual automation runs cannot overwrite the announcement;
- when the announcement ends, the scheduler reconciles current/deferred content and then background music may resume.

Manual and automatically detected announcements must use the same runtime priority state.

### Background music

Background music is an independent scheduler and Music Assistant integration. Normal silent/visual automation should not stop it. Priority audio temporarily pauses it and releases it afterward.

Music state reconciliation must use the actual configured Music Assistant player/group state rather than trusting only cached in-memory state. This allows recovery if a player reconnects or becomes idle without the scheduler process restarting.

### Maintenance Agent

The maintenance service is separated from the main application so maintenance-specific operations do not broaden the privileges of the primary classroom service unnecessarily.

### Host Agent

The host agent belongs on the Ubuntu host as a controlled systemd service. It handles operations that genuinely require host visibility or privileges, such as system status and approved maintenance actions. It should expose a narrow authenticated interface rather than granting the main application unrestricted host access.

## Persistence

Runtime state is replaceable-container-safe. The application uses SQLite plus persistent directories for configuration, uploads/media, backups, and other state.

A production upgrade must never depend on files stored only inside the writable layer of a container.

Recommended conceptual layout:

```text
/opt/classroom-control-hub/
├── docker-compose.yml
├── .env
├── data/
│   └── classroom-control-hub.db
├── uploads/
├── backups/
└── secrets/ or Docker secrets
```

## Configuration boundary

The public repository must remain generic. These belong outside source code:

- organization/district branding;
- internal IP addresses and VLAN information;
- device identifiers when they reveal production topology;
- Ant Media stream URLs;
- Music Assistant endpoints/tokens;
- MQTT credentials;
- passwords;
- private keys/certificates;
- classroom schedules and calendar exceptions when deployment-specific;
- student/user data.

## Release/version convergence

The application has multiple independently loaded components. A release must update all embedded version identifiers together. A mismatch between backend and display renderer can cause forced-reload loops or stale-client behavior.

Release validation should search for previous alpha/beta version strings before packaging or publishing an image.

## Security model

The project follows these boundaries:

- public source contains no production secrets;
- secrets are supplied at runtime;
- main container is not privileged unless a specific documented integration requires it;
- host operations are delegated to the host agent;
- write-capable APIs require authentication/authorization;
- logs and diagnostic bundles should avoid exposing credentials;
- backups containing production state are not committed to Git.
