# Persistent Android ADB

Persistent ADB is an optional managed-display policy for Android/Google TV endpoints that disable Wireless Debugging after reboot.

## Enable

1. Enroll the display through **Managed Displays**.
2. Install the Classroom Hub Display Agent.
3. Select **Enable Persistent ADB**.
4. Confirm the warning.

Classroom Hub grants the agent `WRITE_SECURE_SETTINGS`, enables the Android wireless-debugging setting, records the boot policy, switches the current ADB session to port `5555`, and updates the managed endpoint.

## Expected reboot behavior

After boot the Display Agent attempts to restore Android's `adb_wifi_enabled` setting before launching the Classroom Hub display. Pairing authorization should remain separate from this toggle; a supported device should reconnect without another six-digit pairing cycle.

## Security

Use this only on trusted/isolated device-management networks. Never expose the fixed ADB port to the Internet or guest networks. Restrict Classroom Hub maintenance/remote-shell permissions to trusted administrators.

## If it fails

Firmware can override Android settings during boot. If Wireless Debugging is still disabled after reboot, capture the exact device model/build and leave the device marked experimental. If Wireless Debugging is enabled but the fixed port is not, use current-port discovery and reapply the fixed port.

See `docs/PERSISTENT-ANDROID-ADB.md` for architecture, failure modes, and validation requirements.
