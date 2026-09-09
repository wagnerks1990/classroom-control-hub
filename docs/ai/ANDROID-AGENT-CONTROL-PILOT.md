# AI Context: Android Agent Control Pilot

The Android/Google TV management architecture is beginning a staged migration from ADB-centric runtime control toward agent-centric runtime control.

Current pilot invariant:
- ADB remains required for the one-time privileged bootstrap that grants `WRITE_SECURE_SETTINGS`.
- The agent must never attempt to self-grant privileged Android permissions.
- Once `persistent_adb=true` is stored, `MainActivity` verifies `development_settings_enabled` and `adb_wifi_enabled` at startup, resume, and on a 30-second bounded watchdog.
- If Android disables Wireless debugging while the kiosk agent remains alive, the agent repairs the settings itself.
- A saved Hub flag is not equivalent to verified runtime state. Future UI work should distinguish configured versus actively verified management state.
- Restoring `adb_wifi_enabled` does not prove that fixed TCP port 5555 is listening. Treat secure Wireless Debugging and legacy/fixed TCP ADB endpoint health as separate signals.

Future work should add an authenticated agent-to-Hub command/telemetry channel and migrate routine operations away from ADB incrementally. Preserve ADB for enrollment/bootstrap and emergency recovery until each replacement capability has physical-device validation.
