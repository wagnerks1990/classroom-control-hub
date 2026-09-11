# Android TV Native Sendspin Player

## Purpose

RoomGoblin Display Agent `0.3.0-agent-v2` introduces a native Music Assistant playback path for managed Android/Google TV devices. Audio playback is owned by the foreground Android agent rather than the kiosk WebView. This is intended to prevent display reloads, page navigation, renderer refreshes, or kiosk recovery from interrupting classroom audio.

The first target remains the physically validated Onn 4K Streaming Device (`wayne`) running Android 14. Native Sendspin itself is **not physically validated yet**; the implementation must pass CI and then be tested on the Onn before being marked production-validated.

## Architecture

```text
Music Assistant
  -> Sendspin WebSocket :8927/sendspin
    -> RoomGoblin Android Agent
      -> Sendspin JVM protocol client
        -> timestamped AudioBuffer / clock synchronization
          -> AndroidPcmSendspinPlayer
            -> Android AudioTrack
              -> HDMI / TV audio output

RoomGoblin display WebView
  -> visual content only
  -> can reload/recover independently of native audio
```

The agent uses the Apache-2.0 `sendspin-jvm` library, pinned to release `v0.3.4` for this implementation. The library owns the Sendspin WebSocket state machine, clock synchronization and timestamped jitter buffer. RoomGoblin supplies the Android audio sink.

## Initial audio-format contract

The first implementation deliberately advertises one audio format only:

- codec: PCM;
- sample rate: 48,000 Hz;
- channels: 2;
- bit depth: 16.

The Android sink uses streaming `AudioTrack` with `USAGE_MEDIA` / `CONTENT_TYPE_MUSIC`. Narrowing the first implementation to PCM avoids embedding an additional codec stack before the basic Sendspin transport, timing and Android output behavior are physically validated.

Do not advertise FLAC, Opus or other encoded formats until a corresponding decoder exists and has been tested on the supported hardware.

## Agent lifecycle

Native Sendspin belongs to `AgentService`, not `MainActivity`.

Consequences:

- WebView reload does not intentionally stop native audio;
- leaving the kiosk activity does not intentionally stop native audio;
- kiosk watchdog recovery does not intentionally restart the audio player;
- the Sendspin client uses a persistent client ID stored in device-protected preferences;
- the client can reconnect after a process/network interruption;
- stopping/destroying the foreground AgentService stops the native player.

`KioskWatchdog` also calls `ensureStarted()` while the agent process is alive so an enabled native player is reasserted independently of display activity lifecycle.

## Configuration

Managed Displays exposes a **Native Sendspin** control group:

- **Configure** — stores the Sendspin WebSocket URL and player name in the Android agent;
- **Status** — returns current transport/player state and buffer diagnostics;
- **Reconnect** — restarts the native Sendspin connection without reloading the kiosk WebView.

For Music Assistant's external Sendspin listener, the normal endpoint is:

```text
ws://<music-assistant-host>:8927/sendspin
```

Use the Music Assistant host reachable directly from the Android management/display network. The URL is stored on the managed Android endpoint. It is not an API token and does not reuse the Music Assistant REST/WebSocket authentication token.

Future work should allow the Hub to propagate its database-backed `musicassistant.config.sendspinHost` / `sendspinPort` settings to managed displays automatically, so fleet deployment does not require per-TV URL entry.

## Agent status

`GET /v1/status` includes a `sendspin` object containing fields such as:

- `enabled`;
- `configured`;
- `url`;
- `name`;
- `connected`;
- protocol `state`;
- `serverName`;
- `playing`;
- `bufferedChunks`;
- `droppedChunks`;
- `lateChunks`;
- `droppedDecodeFrames`;
- transport identifier;
- active baseline format.

These fields are diagnostic state. Do not log protocol audio frames or any unrelated Music Assistant secrets.

## Foreground-service requirements

The Android manifest declares both `specialUse` and `mediaPlayback` foreground-service types and the corresponding media-playback permission. The service remains the durable management process and now also owns native audio playback.

## Physical validation checklist

Before marking native Sendspin validated on a device family:

1. Install/reinstall Agent `0.3.0-agent-v2`.
2. Confirm Agent v2 `/v1/status` reports the new version.
3. Configure the Music Assistant Sendspin endpoint and device/player name.
4. Confirm the player appears in Music Assistant.
5. Start a known audio item and confirm HDMI/TV playback.
6. Confirm volume changes work as expected.
7. Reload the RoomGoblin display WebView while audio is playing; audio should continue.
8. Exit the kiosk temporarily; audio should continue while the kiosk self-heals.
9. Allow the kiosk watchdog to restore the display within 30 seconds.
10. Interrupt network connectivity and confirm reconnect behavior after restoration.
11. Reboot the Onn and confirm Agent, kiosk and native Sendspin all recover.
12. Review `droppedChunks`, `lateChunks` and `droppedDecodeFrames` after sustained playback.

## Current limits

- Only the PCM 48 kHz / stereo / 16-bit baseline is implemented.
- The Music Assistant endpoint is currently configured per endpoint from Managed Displays rather than automatically inherited from the Hub integration record.
- The Sendspin protocol/library and Music Assistant server continue to evolve; pinning and physical compatibility must be revalidated when upgrading the library or Music Assistant.
- Multi-room synchronization quality must be measured on actual Android TV hardware before claiming sample-accurate classroom synchronization.

## Related documentation

- `docs/MUSIC-ASSISTANT-SENDSPIN.md`
- `docs/DEVICE-AGENT-V2.md`
- `docs/ANDROID-TV-DISPLAYS.md`
- `wiki/Music-Assistant-Sendspin.md`
- `wiki/Device-Agent-v2.md`
