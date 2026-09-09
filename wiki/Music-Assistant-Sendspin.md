# Music Assistant Sendspin TV Audio

## Supported transport

Music Assistant control and TV audio use separate connections:

```text
Controller -> Hub -> authenticated Music Assistant API (:8095/ws; HTTP API fallback)
TV browser -> same-Hub /music-assistant/sendspin-proxy?ticket=... -> Hub backend
                                                               -> MA :8927/sendspin
```

The backend uses the configured dedicated Sendspin host/port. It does **not** append `/sendspin` to the Music Assistant web/API URL, send an API-authentication preamble to the dedicated socket, or discard the first upstream message as an authentication response. Text and binary Sendspin frames are relayed unchanged in both directions.

The Music Assistant long-lived token remains encrypted in SQLite as `musicassistant.token` for control/API operations. Existing setup/attachment still requires that token. Audio authorization at the Hub remains a one-use, 60-second display ticket plus a current attachment and enabled-bridge check. The browser URL validation from PR #27 remains unchanged: browsers connect only to the same Hub, never directly to an arbitrary audio host.

Upstream reference, checked 2026-09-09: [Music Assistant Sendspin player documentation](https://www.music-assistant.io/player-support/sendspin/), section **Connecting Other Sendspin Players**, documents `:8927/sendspin` for external clients and distinguishes it from the built-in web-player route on port 8095.

## Configuration and host networking

Existing `musicassistant.config` fields are retained; this change does not migrate the database or reset saved audio/attachment preferences.

| Field | Meaning |
| --- | --- |
| `url` | Music Assistant web/API base URL, normally port 8095. API TLS does not imply TLS on the dedicated audio port. |
| `sendspinHost` | Backend-reachable hostname, IPv4 or IPv6 address, without scheme/path/credentials. When absent, use the API URL hostname. |
| `sendspinPort` | Dedicated Sendspin listener; default 8927. Invalid/non-integer/out-of-range values fail validation rather than silently clamping. |
| `tvBridgeEnabled` | Whether the Hub TV audio bridge may establish a new connection. |

In host mode, the existing network helper translates exact legacy aliases `host.docker.internal`, `music-assistant`, and `music-assistant-server` to `127.0.0.1`. Explicit remote IP/DNS settings remain remote; IPv6 addresses receive URL brackets. An explicit hostname must be reachable by the Hub backend, not by the browser. The dedicated endpoint is plain `ws://` and must remain on a trusted network; no public exposure, TLS bypass, reverse-proxy or SDK change is introduced here. A Music Assistant listener bound only to a LAN IP needs that IP configured rather than loopback.

`GET /api/v1/music-assistant/status` (authenticated controller access) reports the actual `sendspinWebSocket` and `upstreamTransport: "dedicated-sendspin"`. The existing `transport: "authenticated-ma-sendspin-proxy"` identifier is retained for compatibility; authentication here refers to the Hub ticket, not an upstream API-token exchange.

## Connection lifecycle and resource bounds

The dedicated relay has a 10-second connect timeout. Closing either side cancels the timer, clears queued frames, and closes the peer, including termination of an upstream that has not finished connecting. Failed sends are contained; reserved close codes are normalized. Pending queues are bounded at 100 frames and 1 MiB, active output buffering at 8 MiB, and WebSocket payload limits remain enforced. Limits fail visibly instead of silently dropping protocol frames. Audio sessions are included in per-IP connection accounting.

No old `authTimer` reference remains in this relay. The saved local `server.js` patch from the user changed the open/authentication block but left such a reference in the close handler; it must not be restored over current source.

## Selective review of PR #22

Reviewed PR #22 head `7e567d202eea70c8834cc35c2320ef2349769ae8` against main `a4fd63cbac838045fb21167ad3faf7ba1472a35f`, which already includes PR #27 (single renderer/security) and PR #28 (host networking). The PR description records successful earlier TV1 audio testing, but the PR's 14 changed files do **not** directly update `src/server.js`. The accepted server patch was present as a script and as the user's separately saved local diff.

| Original files / changes | Disposition |
| --- | --- |
| `scripts/patch-sendspin-dedicated-port.py` | Port its intended backend transport change into `src/server.js` and tested `src/music-assistant-sendspin.js`; do not ship/run the patch script. Correct timeout/early-close cleanup and validate the configured endpoint. |
| `docs/MUSIC-ASSISTANT-SENDSPIN.md` | Carry forward the separate control/audio architecture; replace old host-gateway instructions with current host-mode guidance and identify historical versus new validation. |
| `docs/AI-CONTEXT.md` | Add only the current transport contract. Reject the unrelated master-key migration-path edit and obsolete text-sizing paragraph. |
| `public/display/index.html`, `test/display-text-sizing.test.js`, `wiki/Automation-Display-Media.md` | Do not migrate older fitting changes or source-string tests. PR #27 owns the renderer and browser geometry tests. The current receiver and its security module remain byte-for-byte unchanged. |
| `.github/scripts/apply_display_fit_coalescing.py`, `.github/workflows/apply-display-fit-coalescing.yml`, `scripts/disable-display-autofit.py` | Exclude superseded renderer patching and auto-fit disabling. |
| `scripts/apply-sendspin-lifecycle-fix.py` | Exclude the combined old renderer/browser rewrite. Required backend cleanup is implemented independently; browser reconnect policy is not replaced. |
| `scripts/enable-direct-music-assistant-sendspin.py`, `scripts/use-ma-kiosk-sendspin-lifecycle.py`, `scripts/stabilize-ma-kiosk-sendspin.py` | Exclude browser-direct transport and competing lifecycle/SDK experiments. Preserve current ticketed same-Hub architecture. |
| `scripts/enable-sendspin-browser-audio-unlock.py` | Exclude unrequested browser/autoplay changes; not part of the accepted dedicated-port fix. |

Retire PR #22 as superseded after the selective replacement passes validation and is merged; do not merge its legacy branch wholesale. Closing the PR and deleting its branch preserves the review history. Review-only source-export/patch-transfer workflows are not part of the application change.

## Verification and deployment

Automated coverage: `test/music-assistant-sendspin.test.js` executes endpoint validation, the actual server ticket/attachment handler and deterministic connection races. `test/music-assistant-sendspin-ws.test.js` uses real local WebSockets and separate fake API/audio listeners to test the untouched first server frame, text/binary round trips, no API-auth preamble, correct port selection and close/reconnect cleanup. These are protocol fixtures, **not** tests of live speakers or Music Assistant playback. Existing Chromium/Firefox display suites must continue passing.

The earlier TV1/Windows kiosk playback success is historical evidence recorded in PR #22, not a claim that this replacement was deployed to physical TVs. After merge:

1. Keep local stashes/backups until playback is verified. Do not `stash pop` the obsolete server block and do not run PR #22 patch scripts.
2. Take a SQLite-safe operational backup. Pull current main and follow `docs/HOST-NETWORKING.md`, including port-conflict/effective-Compose preflight and `bash install.sh` to refresh the native Host Agent and both core containers when migrating from bridge mode.
3. Reload receivers, check MA API readiness and the configured dedicated listener with `ss -lntp | grep ':8927'` (substitute the saved port). A healthy Hub alone does not prove audio availability.
4. Attach one TV, verify its `classroom-hub-tvN` player is enabled/registered, start Background Music, and check for stable audible playback. Then check announcements pause/resume and remaining targets. Preserve automation settings and confirm the four-component display layout remains unchanged.

The diagnostic event `musicassistant.sendspin.proxy.connected` indicates an upstream socket opened; it does not by itself prove decoded or audible playback. Missing/disabled players, browser autoplay restrictions, network listener bindings, and API-token failures remain separate diagnostic causes. Application VERSION stays alpha.71 until a separately reviewed release is tagged.
