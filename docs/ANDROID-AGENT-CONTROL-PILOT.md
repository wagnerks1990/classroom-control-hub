# Android Agent Control Pilot

## Purpose

This pilot begins moving routine Android/Google TV management from ADB into the Classroom Hub Display Agent. ADB remains the one-time bootstrap and recovery mechanism; the installed agent is expected to maintain policy while it is running.

## First pilot capability: self-healing Wireless Debugging

When **Persistent ADB** has been enabled once, the bootstrap grants the Display Agent `WRITE_SECURE_SETTINGS` and stores `persistent_adb=true` in device-protected preferences.

The Display Agent now verifies the management policy when the activity starts, whenever it resumes, and every 30 seconds while the kiosk activity is alive. It reads the actual Android global settings rather than trusting the saved Hub record. If Android or the Google TV firmware has changed either setting, the agent restores:

```text
development_settings_enabled = 1
adb_wifi_enabled = 1
```

The watchdog is conditional: devices without the opt-in Persistent ADB policy are not modified. It is also bounded to one check every 30 seconds; there is no busy loop.

## Test procedure

1. Update/install the pilot Display Agent APK on an already enrolled display.
2. Confirm Persistent ADB was bootstrapped previously and the agent still has `WRITE_SECURE_SETTINGS`.
3. Leave the Classroom Hub display activity running.
4. Manually turn **Wireless debugging** off in Android Developer Options.
5. Wait up to 30 seconds.
6. Re-open Developer Options and confirm Wireless debugging returns to **On** without a new ADB command from the Hub.
7. If ADB is available, verify the current endpoint separately. Restoring `adb_wifi_enabled` does not guarantee that firmware will preserve the fixed TCP 5555 listener.

Useful log evidence while an ADB session is available:

```bash
adb logcat -s ClassroomHubDisplay
```

A successful repair logs `Management watchdog repaired wireless debugging`.

## What this pilot does not do

This is not yet the full agent-management architecture. It does not replace remote shell, silent APK installation, screenshots, reboot, or every key-event operation. It also does not claim that TCP port 5555 is active merely because Wireless debugging is enabled.

The next architecture increment should add an authenticated agent-to-Hub control channel and report Agent, Display, Management, and ADB health independently. Routine controls can then migrate one-by-one away from ADB while retaining ADB only for bootstrap and emergency recovery.

## Security boundary

The agent can repair these settings only because the administrator explicitly granted `WRITE_SECURE_SETTINGS` during the existing Persistent ADB bootstrap. Classroom Hub must not attempt to self-grant that privileged permission. Disabling the persistent policy stops the watchdog from changing Wireless debugging.
