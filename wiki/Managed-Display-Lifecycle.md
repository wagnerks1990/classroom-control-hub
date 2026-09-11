# Managed Display Lifecycle

RoomGoblin treats each Android TV enrollment as a durable managed-display record.

## Enrollment controls

- **Enable enrollment**: resumes policy automation for the record.
- **Disable enrollment**: preserves the record but excludes it from automated device policy.
- **Remove from Hub**: removes only the RoomGoblin enrollment. It does not uninstall the Display Agent, factory-reset the Android device, or delete unrelated RoomGoblin data.

Use these controls instead of manually editing `data/android-tv/devices.json`.

## Factory resets and replacement enrollments

After an Android factory reset, the old Hub enrollment can remain as stale inventory because the ADB trust and Android app state were replaced. Enroll the reset device as a new display, then safely remove the stale record with **Remove from Hub**.

## Device Administrator

For already provisioned Android TV devices, Device Admin is an optional fallback management tier. Use **Enable Device Admin** from Device Agent v2. RoomGoblin opens Android's native Device Administrator confirmation screen for `org.roomgoblin.display/.AgentDeviceAdminReceiver`; approval must occur on the TV.

After approval, rerun **Capabilities** and verify `deviceAdminActive: true`. Device Admin can unlock lock/sleep behavior but is not equivalent to Device Owner.

## Device Owner

Device Owner remains the recommended target for new dedicated RoomGoblin displays. Provision it during initial Android setup through the DPC/managed-device provisioning workflow rather than retrofitting a normally provisioned Google TV installation.

## Persistent ADB

When Device Agent v2 is configured, RoomGoblin synchronizes the Hub-side persistent ADB policy and target port into the Android agent. This keeps Hub and Agent v2 recovery state consistent.
