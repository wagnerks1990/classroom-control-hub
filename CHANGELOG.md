# Changelog

## 1.0.0-alpha.65

- Make Ant Media HLS the authoritative Morning Announcements live/offline probe.
- Treat primary HLS HTTP 200 plus a valid playlist as LIVE and HTTP 404 as OFFLINE.
- Stop treating blocked REST/WebRTC probes as stream-state evidence.
- Treat network/proxy failures as UNKNOWN so transient failures do not consume offline confirmations.
- Preserve two confirmed OFFLINE checks before automatic release.
- Report HLS media sequence when available for diagnostics.

## 1.0.0-alpha.64

- Morning Announcements now use a same-origin integrated Ant Media/HLS player on classroom displays.
- Announcement Mute, 50%, 75%, 100%, slider, Retry/Unmute, and Reload/Unmute controls now act on the real HTML5 media element instead of a cross-origin iframe.
- Added HLS.js for Chromium-compatible HLS playback while retaining the configured Ant Media `play.html` URL as the source-of-truth.
- Preserved announcement priority takeover, Background Music pause/resume, and deferred automation behavior.

## 1.0.0-alpha.63

Initial public GitHub/Docker migration of Classroom Control Hub.

- Renamed the project for general classroom/lab use.
- Removed production site-specific hardware mappings and defaults from the public source tree.
- Moved announcement stream configuration to environment/runtime configuration.
- Added public `.gitignore`, `.dockerignore`, and `.env.example` files.
- Added GitHub Actions workflows for validation and GHCR container publishing.
- Preserved the existing modular display, automation, announcement-priority, background-music, AV, lighting, lab, maintenance, and host-agent architecture.
