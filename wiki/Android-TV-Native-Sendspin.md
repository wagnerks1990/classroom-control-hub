# Android TV Native Sendspin

RoomGoblin Agent `0.3.0-agent-v2` moves Music Assistant playback out of the kiosk WebView and into the persistent Android foreground agent.

## Why

The display page and the audio player have different reliability requirements. A display reload, page navigation, WebView crash or kiosk recovery should not interrupt classroom audio. Native Sendspin therefore runs in `AgentService`, while `MainActivity` remains the visual kiosk.

```text
Music Assistant :8927/sendspin
  -> Sendspin JVM client in AgentService
    -> clock-synchronized AudioBuffer
      -> Android AudioTrack
        -> HDMI / TV audio

RoomGoblin WebView
  -> visuals only
```

## First supported format

The initial build advertises only PCM 48 kHz, stereo, 16-bit. This is intentional. Encoded formats should be added only after a decoder is implemented and physically validated.

## Managed Displays

The Device Agent v2 panel exposes **Native Sendspin** controls for Configure, Status and Reconnect. Use the Music Assistant endpoint reachable from the TV network, normally:

```text
ws://<music-assistant-host>:8927/sendspin
```

The player identity is persistent across process restarts and is independent of the display URL.

## Self-healing relationship

The process-level kiosk watchdog and native audio manager are both owned by the foreground agent. The watchdog targets kiosk restoration within 30 seconds after the display activity leaves foreground, while native Sendspin should continue independently.

## Validation status

Implementation/CI validation does not equal hardware validation. Onn `wayne` Android 14 must still be tested for:

- Music Assistant player registration;
- PCM playback over HDMI;
- volume behavior;
- uninterrupted playback across WebView reload;
- uninterrupted playback while kiosk is temporarily exited;
- Sendspin reconnect after network interruption;
- complete reboot recovery;
- sustained buffer/drop statistics.

See `docs/ANDROID-TV-NATIVE-SENDSPIN.md` for the full architecture and test plan.
