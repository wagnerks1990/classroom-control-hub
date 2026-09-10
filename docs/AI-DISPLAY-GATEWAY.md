# AI Context — Managed Display Gateway

This file is concise implementation context for AI coding/review agents working on Classroom Control Hub.

## Intent

Managed classroom displays should not require per-device hosts-file or DNS changes for approved signage/streaming destinations. The Hub owns upstream resolution and relays the approved web traffic to the display.

## Current implementation

- Preload entry point: `src/direct-display-compat.js`
- Gateway implementation: `src/display-gateway.js`
- Display URL routing policy: `public/display/security.mjs`
- Default upstream mapping: `stream.carlisleschools.org=100.88.92.111`
- Gateway route shape: `/display-gateway/{http|https}/{encoded-host}/...`
- Existing Morning Announcements HLS probes benefit from the process-local DNS override automatically.
- The integrated `/antmedia-player/` path remains the preferred Morning Announcements playback mechanism.

## Non-negotiable security rules

1. Do not turn the gateway into an unrestricted forward proxy.
2. Only configured/allowlisted hostnames may be proxied.
3. Preserve original Host and TLS SNI when applying an IP override.
4. Reject embedded URL credentials and unsupported schemes.
5. Do not add generic HTTP CONNECT tunneling.
6. Generic WebSocket proxying, if added later, must use an explicit hostname allowlist and bounded payload/timeouts.

## Functional expectations

For the Carlisle deployment, the physical TV should be able to play Morning Announcements even when neither the TV nor the Hub host operating system has a hosts-file entry for `stream.carlisleschools.org`. The Node process itself resolves that hostname to `100.88.92.111`, while certificates are still validated against `stream.carlisleschools.org`.

Display-side authorization should rewrite approved external URLs to the Hub gateway. Other external sites continue to use their existing direct path unless explicitly added to gateway policy.

## Known limitation

This phase handles HTTP(S), redirects, ordinary web assets, and HLS. It does not yet implement arbitrary proxied WebSocket upgrades. Do not claim full WebRTC transparency until that feature exists and has been validated on the physical Onn Google TV.

## Verification contract

A deployment is not considered validated until all of the following are true:

- repository validation tests pass;
- the Hub starts with the gateway preload enabled;
- `Check Stream Now` works after removing the operating-system hosts-file override;
- the physical managed display requests the stream through `/display-gateway/`;
- HLS manifests and segments load through the gateway;
- playback succeeds on the physical TV.
