# Operations

This page covers day-to-day operational behavior for Classroom Control Hub.

## Service health

```bash
cd /opt/classroom-hub
docker compose ps
curl -fsS http://localhost:3000/health
docker compose logs --tail=200
```

## Display operations

Display clients should reconnect automatically after network or backend interruptions. Verify display ID, WebSocket connectivity, version convergence, and current priority locks when a display is stale.

## Morning Announcements

Morning Announcements are a highest-priority operation.

### Automatic Live Watch

For Ant Media player URLs, HLS is the primary live-state signal when available:

- 200 + valid `#EXTM3U` = LIVE
- 404 = OFFLINE
- network/timeout/5xx = UNKNOWN/error
- blocked REST diagnostics do not override HLS

Two confirmed OFFLINE checks are required before ending an active automatic announcement.

When live status is detected, Classroom Control Hub pauses Background Music, clears/locks the target displays, starts the local HLS player fullscreen, and applies the saved announcement volume/unmute state.

### Manual announcements

Manual Play Announcements enters the same priority state as automatic Live Watch.

### Ending announcements

When announcements end:

1. clear announcement content;
2. release the announcement priority lock;
3. mark announcement runtime inactive;
4. consume deferred-trigger bookkeeping;
5. re-evaluate current date/class/time;
6. choose the newest currently applicable display automation independently per target;
7. re-run those winning automations;
8. reconcile/resume Background Music afterward.

This is a failsafe scheduler resync. Do not restore stale snapshots or replay every earlier event blindly.

## Background Music

Background Music is independent of ordinary visual automation. Priority audio pauses it. Recovery checks actual Music Assistant player/group state and resumes only after priority release and display resync are complete.

## Class timers

Linked Class End Time timers follow the active selected class occurrence. Continuation chaining applies only to an explicitly linked continuation of the same underlying base period/class. Adjacent unrelated periods do not chain due only to time proximity.

Transition pseudo-classes are terminal standalone timer occurrences.

## School calendar operations

```text
No-School > Remote > Half Day > 2-Hour Delay > 1-Hour Delay > Normal
```

No-school suppresses scheduled classroom operations and pauses cycle advancement. Remote days advance the cycle but suppress scheduled classroom operations while manual controls remain available.

## Integration health

Each integration reports independently. Pluto failure must not falsely mark MQTT/Govee offline. Slow optional hardware checks must not block initial Overview rendering.

## Host Agent

Expected socket:

```text
/run/classroom-control-hub/host-agent.sock
```

Verify host and maintenance-container access:

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

## Safe Git upgrade sequence

```bash
sudo cp -a /opt/classroom-hub "/opt/classroom-hub-backup-before-update-$(date +%Y%m%d-%H%M%S)"
cd /opt/classroom-hub
git fetch origin
git pull --ff-only origin main
cat VERSION
docker compose build --no-cache
docker compose up -d
docker compose ps
curl -fsS http://localhost:3000/health
```

Keep a known-good rollback snapshot until the new release is verified.
