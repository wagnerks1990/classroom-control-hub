# Manual Media Audio Controls

The Display Content → Media → Manual / Selected Media panel includes an explicit playback-volume control for manual video and web/stream playback.

## Behavior

- The volume slider is expressed as 0–100% in the controller.
- The display command payload carries normalized `volume` from `0.0` through `1.0`.
- Selecting 0% also mutes playback.
- Selecting the Muted checkbox drives the slider to 0%; unmuting restores the prior non-zero level when available.
- Manual video commands carry both `muted` and `volume`.
- Manual web/stream commands also set `forceAudio` when volume is above zero so the receiver's existing web-audio recovery behavior is used.
- `localDirect` remains controlled by the existing "Load URL directly from this TV/browser" checkbox.

This control is intentionally scoped to the manual media panel. Morning Announcements retain their dedicated announcement-volume control and automated media retains its existing payload behavior until separately extended.
