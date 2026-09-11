# Operations

## Daily operating model

RoomGoblin continuously reconciles configured classroom state with schedules, connected displays, integrations, and priority content. Operators should normally allow the scheduler to maintain the current classroom state and use manual controls for testing, exceptions, or immediate intervention.

The standard production checkout is `/opt/classroom-hub`.

## Current network mode

The appliance is temporarily HTTP-only. Access the controller through the trusted classroom/admin LAN at:

```text
http://APPLIANCE-IP:3000/controller/
```

There is currently no Caddy/TLS gateway. Keep `TRUST_PROXY_HOPS=0` unless a reviewed reverse proxy is deliberately added later. Restrict TCP/3000 to trusted networks and do not expose the controller directly to the public Internet.

## Displays

Display clients should remain connected in kiosk/browser mode and identify themselves using stable IDs. If a display reconnects, the server should restore the current intended content rather than relying on stale client-side state.

If a display is offline:

1. verify network connectivity and browser/kiosk process;
2. confirm the display ID is correct;
3. confirm direct HTTP/WebSocket connectivity to the Hub on port 3000;
4. reconnect/reload the display;
5. verify it converges to the currently scheduled content.

## Automations

Scheduled automations may be class-linked or time-based. Manual `Run Now`/`Test Now` actions are useful for validation but still obey system priority locks.

When an automation is linked to multiple classes, runtime class resolution should select the occurrence that is actually active rather than blindly selecting the first configured class.

### Timers

Linked-class timers use the active occurrence's actual end time. Transition pseudo-classes are standalone timer endpoints. Continuation chaining must use an explicit “Continuation Of” link to the same class or base period. Imported schedules can temporarily retain the documented legacy compatibility behavior.

Adjacent unrelated regular periods do not chain simply because they are close together in time.

## Morning Announcements

Morning Announcements are a hard-priority display/audio mode.

Automatic flow:

```text
HLS Live Watch confirms stream LIVE
        ↓
Enter announcement priority state
        ↓
Pause Background Music
        ↓
Clear announcement target displays
        ↓
Play HLS stream fullscreen
        ↓
Apply saved announcement volume/unmute state
        ↓
Maintain priority lock while live
```

Manual `Play Announcements` enters the same priority state.

While announcements are active:

- target displays cannot be overwritten by normal automations;
- Background Music remains paused;
- scheduled conflicting automations are deferred;
- manual automation execution cannot replace announcement content on locked targets.

### Live detection

For Ant Media player URLs, HLS is the authoritative live-state probe when derivable:

- HTTP 200 plus a valid `#EXTM3U` playlist = LIVE;
- HTTP 404 = OFFLINE;
- network/timeout/5xx = UNKNOWN/error rather than definitive OFFLINE;
- blocked REST probes such as 403 do not override HLS.

Two confirmed OFFLINE checks are required before automatically releasing an active announcement.

### Ending announcements

When announcements end or are manually stopped:

```text
Clear announcement content
        ↓
Release announcement priority lock
        ↓
Mark announcement runtime inactive
        ↓
Consume deferred trigger bookkeeping
        ↓
Re-evaluate current date/class/time
        ↓
Select newest currently applicable display automation per target
        ↓
Re-run winning current automations
        ↓
Reconcile/resume Background Music if schedule requires it
```

This is a failsafe scheduler resync. Each display receives only its own newest
currently applicable winner. A failed re-run must be recorded for diagnostics
but must not strand the announcement priority lock or prevent Background Music
reconciliation from running. Do not restore a stale pre-announcement display
snapshot and do not blindly replay every historical automation from earlier in
the day.

## Announcement volume

Announcement volume is persistent and independent from Background Music. Current playback uses a locally controlled HTML5/HLS media element so mute and percentage volume controls operate on the actual media element. Reload/unmute recovery should reapply saved volume.

## Background Music

Background Music follows its own schedule. Normal visual/silent automation should not interrupt it.

It pauses for priority audio and resumes only after priority audio is released and display automation reconciliation completes. Recovery logic compares scheduler intent with actual Music Assistant player/group state so it can self-heal after player reconnects or unexpected idle states.

## Integration health

Integration state is independent. A failed Pluto status request must not cause MQTT/Govee to be reported offline.

Slow optional hardware checks should not block the initial Overview UI. Render lightweight application/device/schedule state first and refresh detailed hardware status asynchronously.

## Host Agent and maintenance

The native Host Agent should be active and listening on:

```text
/run/classroom-control-hub/host-agent.sock
```

Verify:

```bash
sudo systemctl status classroom-hub-host-agent.service --no-pager -l
sudo test -S /run/classroom-control-hub/host-agent.sock
sudo docker exec classroom-control-hub-maintenance ls -la /run/classroom-control-hub/
```

Maintenance readiness also requires a non-empty `MAINTENANCE_TOKEN` shared by the Host Agent, application, and maintenance container. Never print the token while troubleshooting; compare only presence/length when possible.

The shared runtime data root should remain:

```text
/opt/classroom-hub/data          root:10001 0770
/opt/classroom-hub/data/backups  root:10001 0700
```

The main app runs as UID/GID `10001:10001` and should not take ownership of the shared data root itself.

## Calendar exceptions

School calendar rules are evaluated before normal automation execution. A deployment may define no-school dates, remote days, half days, and delayed starts.

Expected precedence:

```text
No-School > Remote > Half Day > 2-Hour Delay > 1-Hour Delay > Normal
```

No-school days suppress scheduled classroom operation and pause cycle advancement. Remote days advance the cycle but suppress scheduled physical-classroom operations while leaving manual controls available.

## Scheduler readiness

`/health` requires database and scheduler validation to pass. A class with an invalid time range, such as an end time earlier than its start time, can make the service unhealthy even though the Node process is running.

If health reports `scheduler.ok=false`, inspect class schedules and automation actions in the active SQLite database. Fix both normalized columns and the corresponding JSON payload when repairing a migrated record. Do not rely on editing a legacy JSON mirror when database-backed state is active.

## Production updates

Use Git-first updates:

```bash
cd /opt/classroom-hub
git fetch origin
git pull --ff-only origin main
cat VERSION
sudo bash install.sh
```

For a development rebuild after the installer has established runtime permissions:

```bash
docker compose build --no-cache
docker compose up -d --remove-orphans
docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

`--remove-orphans` cleans up the legacy TLS gateway when upgrading from a Caddy-based release.

Take a backup before upgrading and preserve runtime `.env`, databases, data, uploads, backups, and secret/key material. Recovery backups contain private appliance data and require explicit sensitive-data confirmation. Store them with administrative access controls; do not attach them to support cases.

Use the metadata-only **diagnostic** archive for support. It excludes databases,
runtime data, managed services, device/ADB identity, student records,
environment files, and keys. Inspect even diagnostic archives before sharing.

Web-managed updates retain and pin the backup used by **Revert Last Upgrade**. The backup digest is verified and matching data is restored while the application is stopped, before the older release starts. The exact prior image tag plus Hub and maintenance image IDs are retained locally and reused for rollback rather than resolving a moving tag or rebuilding. An interrupted request remains in the root-only host journal and resumes after restart. Do not prune `classroom-control-hub-recovery:*` images while **Revert Last Upgrade** is available.

An update is successful only after backend HTTP health, maintenance, Host Agent, database/scheduler health, and version convergence checks pass. TLS/Caddy is intentionally not part of the current release gate. Watch capacity before a large update with `df -h /opt/classroom-hub` and `docker system df`.

## Controller hard refresh

After frontend updates, use a hard refresh (`Ctrl+Shift+R` in common desktop browsers) if the browser continues to serve cached controller assets.

Display clients should normally reconnect automatically, but version mismatch/reload logic must be monitored after releases.

## Logs

Useful commands:

```bash
cd /opt/classroom-hub
docker compose ps
docker compose logs --tail=150
docker compose logs -f classroom-hub
journalctl -u classroom-hub-host-agent.service -n 100 --no-pager
```

Do not publish logs publicly until they have been checked for credentials, internal addresses, user information, and diagnostic payloads. Rotate any live secret accidentally exposed in a shared/public transcript.
