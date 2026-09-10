# AI Change Context — Manual Media Volume

Date: 2026-09-10

## Problem

The manual media controls in `public/controller/display.html` exposed Autoplay, Loop and Muted but did not expose a volume level. Operators could therefore only choose full/default volume or mute when manually playing a video/stream URL.

## Implementation

`public/shared/manual-media-volume.js` augments only `/controller/display.html` and adds a 0–100% volume slider to Manual / Selected Media. It replaces `window.sendMedia` after the controller has initialized and preserves the existing command shape while adding:

- `volume` normalized to 0.0–1.0;
- effective `muted` state when the slider is 0%;
- `forceAudio` for non-zero video/web playback;
- the existing `localDirect` selection.

`public/shared/attribution.js` loads this compatibility module only for the display-content controller page. The receiver already consumes `m.volume` for video and the existing web-audio recovery path consumes the requested volume for web content.

## Scope

This change is deliberately limited to Manual / Selected Media. Do not assume automation media volume has been added. Morning Announcements continue to use their dedicated announcement volume control.

## Verification

Run `npm test`. On a physical display, play an MP4 URL at 10%, 50%, and 100%, then verify Muted/0% and unmute restoration. Also verify a manual web/stream URL uses the selected volume where browser autoplay policy permits audio.
