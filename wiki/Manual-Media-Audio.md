# Manual Media Audio

Use **Display Content → Media → Manual / Selected Media** to play an external/manual video or web stream at a chosen volume.

The controller exposes a 0–100% playback-volume slider. Volume is sent to the display as a normalized `0.0`–`1.0` value. Setting volume to 0% mutes playback. Selecting **Muted** also sets the effective volume to zero; clearing Muted restores the prior non-zero slider value when possible.

For web/stream playback with non-zero volume, RoomGoblin requests the receiver's existing forced-audio recovery path. This is separate from the Morning Announcements volume setting.
