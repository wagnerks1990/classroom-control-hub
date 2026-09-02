# Operations

This page covers day-to-day operational behavior for Classroom Control Hub.

## Service health

Check containers:

```bash
cd /opt/classroom-control-hub
docker compose ps
```

Check application health:

```bash
curl -s http://localhost:3000/health
```

Review logs:

```bash
docker compose logs --tail=200 classroom-control-hub
docker compose logs --tail=200 classroom-control-hub-maintenance
```

## Display operations

Display clients should reconnect automatically after network or backend interruptions. If a display is stale, verify:

1. the display browser/kiosk is online;
2. the display ID matches the configured target;
3. WebSocket connectivity is available through the reverse proxy;
4. backend and renderer versions match;
5. no priority lock is intentionally holding the display.

## Morning Announcements

Morning Announcements are a priority operation.

### Automatic Live Watch

During the configured school-day watch window, the service checks the configured live stream. When live status is detected, Classroom Control Hub:

1. pauses Background Music;
2. clears the announcement target displays;
3. locks the targets against conflicting automation;
4. starts the live announcement fullscreen;
5. applies the saved announcement volume and unmute/retry behavior.

The stream must be confirmed offline before an active automatic announcement is released so a short network hiccup does not immediately blank the displays.

### Manual announcements

Manual Play Announcements uses the same priority state as Live Watch. Manual and automatic announcements therefore have the same arbitration behavior.

### Ending announcements

When the announcement ends:

1. HerdTV/live content is cleared;
2. deferred scheduled automation is reconciled;
3. the latest applicable classroom display state is restored;
4. the priority lock is released;
5. Background Music resumes if the schedule says it should be active.

## Background Music

Background Music is independent of visual automation. Ordinary slides, timers, and silent content should not interrupt music.

Priority audio pauses Background Music. Recovery logic checks the actual Music Assistant player/group state so music can restart after a player reconnect or unexpected idle state.

## Class timers

Linked Class End Time timers follow the active selected class occurrence. Optional continuation chaining applies only to valid matching continuation/Bison blocks for the same underlying period, not merely to any adjacent class with a short time gap.

Transition pseudo-classes are terminal standalone timer occurrences.

## School calendar operations

Calendar exception precedence is:

```text
No-School > Remote > Half Day > 2-Hour Delay > 1-Hour Delay > Normal
```

No-school days suppress scheduled classroom operations and pause cycle advancement. Remote days advance the cycle but suppress scheduled classroom operations while keeping manual controls available.

## Safe upgrade sequence

```bash
cd /opt/classroom-control-hub
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
docker compose pull
docker compose up -d
curl -s http://localhost:3000/health
```

For major migrations, back up the entire deployment directory and validate the new build on alternate ports first.

## Rollback

Rollback should restore the previous image/version while preserving the persistent data directory. If a migration changed the database schema, follow the release-specific rollback notes rather than blindly starting an older container against a newer database.
