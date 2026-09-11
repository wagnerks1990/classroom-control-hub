# Android Agent Control Pilot

The first agent-first management pilot moves Wireless Debugging policy maintenance into the RoomGoblin Display Agent while retaining ADB for one-time bootstrap and emergency recovery.

After **Persistent ADB** has been enabled once, the agent verifies `development_settings_enabled` and `adb_wifi_enabled` at activity start, on resume, and every 30 seconds while the kiosk is running. If Android disables Wireless debugging, the agent attempts to restore it using the previously granted `WRITE_SECURE_SETTINGS` permission.

## Physical test

1. Install the pilot agent APK.
2. Confirm Persistent ADB was already bootstrapped.
3. Keep the RoomGoblin display activity running.
4. Turn Wireless debugging off manually.
5. Wait up to 30 seconds.
6. Confirm Wireless debugging turns back on without a Hub-side ADB command.

This validates agent-side policy enforcement only. It does not prove that TCP port 5555 remains active, and it does not yet replace shell, screenshot, install, reboot, or other ADB controls.

The longer-term direction is an authenticated agent-to-Hub control channel with independent Agent, Display, Management, and ADB health states. ADB becomes bootstrap/recovery rather than the primary runtime control transport.
