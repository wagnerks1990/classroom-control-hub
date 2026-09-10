# AI Context — Morning Announcements

This file is implementation context for AI coding/review agents changing the Morning Announcements pipeline.

## Non-negotiable lifecycle rule

A periodic successful live probe must **not** re-send the active announcement takeover. Do not clear/recreate the current player merely to prove that the stream is still live. The historical `lastAssertAt > 30000` behavior caused an intentional `display.clear` followed by `display.web` every ~30 seconds and produced visible stream interruptions.

The lifecycle contract is transition-oriented:

```text
confirmed offline -> confirmed live : start once
confirmed live -> confirmed live    : observe only
live -> temporary failure/unknown   : observe/recover, do not release
live -> sustained confirmed offline : release once
```

Current deployment intent is 15-second health checks and about 90 seconds of sustained confirmed-offline evidence before release. Unknown/time-out errors must remain distinguishable from authoritative offline results.

## Receiver-side safety net

`public/shared/attribution.js` installs a narrow receiver guard before the display module's WebSocket handler is assigned. During rollout it suppresses duplicate identical Morning Announcements `display.web` assertions and duplicate `morning-announcements-takeover` clears while the same session is already active. It must always allow an explicit `morning-announcements-release` clear.

This is a defense-in-depth guard, not permission to keep a server-side periodic reassert forever. Prefer fixing the lifecycle owner rather than expanding interception to unrelated commands.

## HLS player

`public/antmedia-player/index.html` is the integrated Morning Announcements player. It emits same-origin telemetry to the parent receiver and performs bounded in-place recovery for network/media failures.

For the current HTTP/CSP deployment, HLS.js runs with `enableWorker:false`. Do not globally add `blob:` worker execution just to silence HLS.js warnings unless the full CSP/security impact is reviewed. The player is sufficiently lightweight for the managed TV use case and main-thread HLS avoids the known CSP worker rejection.

## Diagnostics contract

Preserve these observable surfaces:

- `window.ClassroomStreamDiagnostics()` on a receiver;
- `[ClassroomHub MorningStream]` receiver console events;
- `[ClassroomHub AntMedia]` player console events;
- bounded player/stream telemetry in normal display heartbeat `meta.stream`;
- server-side Morning Announcements runtime through the authenticated automation API;
- display connect/disconnect audit events;
- Morning Announcements start/stop/probe-transition events when server lifecycle code is changed.

Telemetry should include enough information to distinguish upstream liveness, gateway/network failure, HLS playlist/segment failure, decode/media failure, receiver WebSocket loss, player stall, and recovery. Never include credentials, cookies, access tokens, enrollment tokens, or secrets.

## Future replacement monitoring

A later monitor may use an Ant Media API/webhook or another authoritative publisher signal. Preserve transition semantics and diagnostics even when the probe mechanism changes. Monitoring and playback are separate concerns: the monitor decides when a session should begin/end; the receiver/player decides how to survive transient playback/network errors while the session remains active.

See `docs/MORNING-ANNOUNCEMENTS-DIAGNOSTICS.md` for the operator-facing diagnostic procedure.
