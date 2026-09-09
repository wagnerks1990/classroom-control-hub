# Architecture

## Host-network deployment contract

The Linux Hub and maintenance containers, plus reviewed managed add-on templates, now use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

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

## Standard production topology

```text
Ubuntu host
├── /opt/classroom-hub
├── classroom-hub-host-agent.service
│   └── /run/classroom-control-hub/host-agent.sock
└── Docker Engine
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

The maintenance container bind-mounts the Host Agent socket. The main classroom application does not require broad host privileges.

## Major components

### Main application

The main Node.js service provides the controller UI, APIs, scheduler, display orchestration, class/calendar rules, automation execution, media control, announcement handling, integration adapters, diagnostics, and persistence access.

Persistent data is mounted into the container rather than baked into an image.

### Display clients

Display clients are browser/kiosk endpoints identified by stable display IDs. They render slides, text, timers, images, video, web content, and priority announcements.

Display code must tolerate reconnection. A reconnect must converge to current server state without causing a permanent reload loop. Renderer/server version identifiers therefore remain synchronized across releases.

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
- explicit class-continuation rules;
- manual execution requests.

Calendar exceptions are resolved before normal occurrence execution. Site-specific school calendars are runtime configuration, not public source constants.

### Priority arbitration

Content and audio are not equal-priority operations. The intended priority model is:

```text
Morning / emergency-style live announcement
        >
Explicit priority automation audio/video
        >
Normal visual classroom automation
        >
Background Music
```

Morning Announcements use a hard priority lock. While active:

- announcement target displays are reserved for the announcement;
- Background Music is paused;
- scheduled automations that would conflict are deferred;
- manual automation runs cannot overwrite locked targets.

Manual and automatically detected announcements use the same runtime priority state.

### Post-announcement failsafe resync

When Morning Announcements end, Classroom Control Hub does not restore a stale display snapshot. The release path:

1. clears announcement content;
2. releases the announcement priority lock;
3. marks announcement runtime inactive;
4. consumes deferred-trigger bookkeeping;
5. re-evaluates current date/class/time;
6. determines the newest currently applicable display automation independently per target;
7. re-runs those winning current automations;
8. reconciles/resumes Background Music afterward.

This ensures the classroom returns to what should be active **now**, including automations whose original trigger occurred before or during the stream.

### Morning Announcements media transport

For Ant Media player URLs, HLS is the preferred live-state and playback transport when the HLS URL can be derived.

Live-state semantics:

- HTTP 200 plus a valid `#EXTM3U` playlist = LIVE;
- HTTP 404 = OFFLINE;
- transient network/timeout/5xx = UNKNOWN/error;
- blocked REST diagnostics do not override valid HLS state.

Two confirmed OFFLINE checks are required before automatic release. Playback uses a locally controlled media element so announcement volume/mute can be controlled directly.

### Background Music

Background Music is an independent scheduler and Music Assistant integration. Normal silent/visual automation does not stop it. Priority audio temporarily pauses it and releases it only after display reconciliation completes.

Music state reconciliation uses the actual configured Music Assistant player/group state rather than only cached in-memory state.

### Integration health

Integration health is independent. One adapter's failure must not contaminate another adapter's status. For example, Pluto failure must not cause MQTT/Govee to appear offline.

Slow or optional hardware probes run outside the critical initial Overview-render path. The UI should become usable from lightweight application/device/schedule state while detailed hardware state refreshes asynchronously.

### Maintenance Agent

The maintenance service is separated from the main application so maintenance-specific operations do not broaden the privileges of the primary classroom service unnecessarily.

### Host Agent

The Host Agent runs on the Ubuntu host as a controlled systemd service and listens only on `/run/classroom-control-hub/host-agent.sock`. It handles operations that genuinely require host visibility or privileges, such as system status and approved maintenance actions.

The maintenance container has no Docker socket. Its Docker requests cross the
authenticated Unix-socket boundary and are checked against exact operation,
container, image, and path allowlists by the Host Agent.

### Windows lab agents

Windows computers connect outbound over the application WebSocket. New agents
exchange an expiring one-time enrollment code for an individual revocable
credential. Legacy shared-token access is a database policy used only during
migration. The agent implements a fixed classroom command allowlist and stores
its credential with Windows DPAPI rather than in plaintext configuration.

## Persistence

Runtime state is replaceable-container-safe. The application uses SQLite plus persistent directories for configuration, uploads/media, backups, and other state.

A production upgrade must never depend on files stored only inside the writable layer of a container.

Standard conceptual layout:

```text
/opt/classroom-hub/
├── docker-compose.yml
├── .env
├── data/
│   └── classroom-control-hub.db
├── uploads/
├── backups/
└── secrets/ or mounted secrets
```

## Configuration boundary

The public repository remains generic. These belong outside tracked source:

- school/district and classroom branding;
- internal IP addresses and VLAN information;
- production device identifiers/topology;
- Ant Media stream URLs/IDs;
- Music Assistant endpoints/tokens;
- MQTT credentials;
- passwords;
- private keys/certificates;
- deployment-specific classroom schedules/calendar exceptions;
- student/user data.

## Release/version convergence

The application has multiple independently loaded components. A release updates all embedded version identifiers together. A mismatch between backend and display renderer can cause forced-reload loops or stale-client behavior.

Release validation should search for previous alpha/beta version strings before publishing.

## AI/context boundary

`AGENTS.md` is the authoritative contributor/AI operating contract. `docs/AI-CONTEXT.md` is the compact technical handoff. Behavior or architecture changes that materially affect future reasoning should update those files in the same change.

## Security model

The project follows these boundaries:

- public source contains no production secrets;
- secrets are supplied at runtime;
- main container is not privileged;
- host operations are delegated to the Host Agent;
- write-capable APIs require authentication/authorization;
- read APIs and media assets containing classroom state require an authenticated
  user or an enrolled display's short-lived signed asset token;
- access profiles map users to explicit capabilities, with student-sensitive
  lab data isolated behind `lab.sensitive.read`;
- logs and diagnostic bundles should avoid exposing credentials;
- backups containing production state are not committed to Git.
