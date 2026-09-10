# Morning Announcements Stability and Diagnostics

## Purpose

Morning Announcements is a priority live-stream workflow. The Hub probes the configured Ant Media HLS stream during the school-day watch window, starts the announcement when the stream becomes live, keeps the active player stable through transient probe/media failures, and releases displays only after the configured sustained-offline threshold.

This document is the operational contract for diagnosing stream start, playback, buffering, reconnect, proxy, receiver WebSocket, and stream-end behavior. Future monitoring implementations should preserve these observable lifecycle states even if the underlying Ant Media/HLS probe is replaced.

## Stability contract

An already-playing announcement must not be cleared and recreated merely because another health probe succeeds. Reasserting the same `display.web` takeover every 30 seconds caused visible feed interruptions because the receiver was explicitly blanked and the HLS player was rebuilt.

The intended lifecycle is:

```text
IDLE
  -> probe confirms live
  -> STARTING
  -> PLAYING

PLAYING
  -> successful probe: keep current player untouched
  -> transient probe failure: keep current player untouched
  -> HLS network/media error: recover in-place when possible
  -> sustained confirmed offline state: RELEASE

RELEASE
  -> clear announcement content once
  -> restore applicable scheduled display content
  -> reconcile Background Music priority
```

The deployment target is a 15-second probe interval with six consecutive confirmed-offline results before release (about 90 seconds). Unknown/time-out/proxy errors are diagnostic conditions, not authoritative proof that publishing ended.

## HLS player recovery

`public/antmedia-player/index.html` is the same-origin player used for Morning Announcements. For the current HTTP deployment it runs HLS.js on the main thread (`enableWorker:false`) because the application Content Security Policy intentionally does not permit arbitrary blob workers. This avoids the repeated CSP worker rejection observed in browser diagnostics without broadly weakening the application CSP.

The player uses bounded HLS retry/recovery behavior:

- manifest, level, and fragment load timeouts;
- bounded manifest/level/fragment retries;
- `startLoad()` recovery for HLS network failures;
- `recoverMediaError()` for HLS media/decode failures;
- fallback between the standard and `_adaptive.m3u8` candidates;
- a playback-progress watchdog that attempts in-place HLS recovery after prolonged buffering.

A player error should not cause the Hub to clear the receiver unless the server-side live monitor independently confirms the stream has ended for the configured grace period.

## Receiver diagnostics

Each physical display exposes:

```js
window.ClassroomStreamDiagnostics()
```

The result contains the current Morning Announcements receiver state plus a bounded recent event ring. Useful fields include:

- `active` — whether the receiver believes it currently owns a Morning Announcements session;
- `state` — starting, playing, buffering, released, etc.;
- `reassertionsSuppressed` — duplicate identical stream commands suppressed instead of rebuilding the player;
- `takeoverClearsSuppressed` — duplicate takeover clears suppressed while the same announcement is active;
- `lastError` — most recent player/recovery error;
- `player` — latest HLS/media telemetry snapshot;
- `events` — recent receiver/player state changes.

The receiver also adds a bounded stream snapshot to normal display heartbeat metadata. The Hub therefore exposes current per-display stream telemetry through the existing authenticated device/diagnostic views instead of creating a second unauthenticated monitoring channel.

## Player telemetry

The integrated Ant Media player sends same-origin telemetry to its parent receiver. Telemetry includes:

- event and state;
- current playback time;
- seconds buffered ahead;
- HTML media `readyState` and `networkState`;
- selected HLS candidate;
- HLS manifest/level/fragment progress counters;
- network/media/other HLS error counters;
- stall count;
- recovery count;
- last URL and source URL;
- fatal/nonfatal HLS error details and HTTP response code when available;
- browser online/offline transitions;
- watchdog recovery events.

Browser console prefixes are intentionally stable for field troubleshooting:

```text
[ClassroomHub MorningStream]
[ClassroomHub AntMedia]
```

These logs must not include display credentials, Hub session cookies, setup tokens, maintenance tokens, or other secrets.

## Hub-side diagnostics

The existing API surfaces should be used while troubleshooting:

```text
GET /api/v1/automations/morning-announcements
GET /api/v1/devices
GET /api/v1/diagnostics
GET /api/v1/diagnostics/events
```

The Morning Announcements endpoint reports the saved watch configuration and runtime probe state. Display status includes heartbeat metadata, including the latest receiver stream telemetry when available. Diagnostics events contain display connect/disconnect and automation lifecycle events.

From the Ubuntu appliance, follow relevant application logs with:

```bash
cd /opt/classroom-hub
sudo docker compose logs -f classroom-hub \
  | grep -Ei 'Morning Announcements|MorningStream|AntMedia|display\.connected|display\.disconnected|stream|probe'
```

For a broader capture during a failure window:

```bash
sudo docker compose logs --since=15m classroom-hub > /tmp/classroom-hub-stream.log
```

Do not publish exported logs without reviewing them for deployment-specific URLs, addresses, or other environment details.

## What to record during a physical failure

For each observed interruption, capture:

1. wall-clock time to the second;
2. affected display ID(s);
3. whether picture, audio, or both stopped;
4. how long the interruption lasted;
5. `window.ClassroomStreamDiagnostics()` from the affected receiver/preview if available;
6. Morning Announcements runtime from the controller;
7. Hub logs for approximately one minute before and after the event;
8. whether other displays experienced the same interruption at the same time.

If every TV fails at the same instant, prioritize upstream/proxy/probe investigation. If one receiver fails while others remain healthy, prioritize that receiver's HLS/media/WebSocket telemetry.

## Managed Display Gateway relationship

Morning Announcements may reach Ant Media through the Managed Display Gateway. The gateway solves routing/DNS reachability; it is not itself the stream-liveness authority. A gateway timeout or temporary fetch failure is not equivalent to a confirmed stream end.

For site-specific mappings, continue to use protected runtime `.env` configuration. Do not commit production hostnames or IP addresses to public defaults.

## Future monitoring replacement

A future implementation may use Ant Media's management API, publisher webhook/events, a dedicated health endpoint, WebRTC signaling, or another authoritative source instead of HLS manifest probing. The replacement should preserve these invariants:

- START once on a confirmed live transition;
- never rebuild a healthy active player on periodic success checks;
- distinguish OFFLINE from UNKNOWN/UNREACHABLE;
- debounce stream-end release;
- preserve receiver-level playback telemetry;
- preserve server-side lifecycle/audit events;
- keep the announcement higher priority than ordinary classroom automation;
- restore the correct current automation state after release.

## Acceptance test

A physical deployment is considered stable only after an actual managed TV has played a live Morning Announcements stream continuously for at least 10 minutes with no periodic 30-second player teardown. During the test, verify that successful probes do not cause iframe/player replacement and that temporary recoverable HLS errors are visible in diagnostics without blanking the display.
