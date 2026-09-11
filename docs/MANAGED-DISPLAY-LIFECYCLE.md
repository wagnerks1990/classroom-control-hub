# Managed Display Lifecycle

Managed Displays are durable RoomGoblin enrollments. A device record may survive temporary ADB loss, Android reboots, randomized wireless-debugging ports, and Agent v2 transport changes.

## Lifecycle operations

The Managed Displays UI exposes three enrollment lifecycle actions:

- **Enable enrollment** — marks the record active so policy automation can manage it.
- **Disable enrollment** — keeps inventory and configuration but excludes the display from policy automation.
- **Remove from Hub** — deletes only the RoomGoblin enrollment record. It does not uninstall `org.roomgoblin.display`, factory-reset Android, or delete unrelated RoomGoblin data.

Removal is intentionally non-destructive to the physical device. Destructive device actions must remain separate and explicit.

## Re-enrollment after factory reset

A factory reset creates a new Android trust/enrollment context. If the same physical display is enrolled again, remove the stale RoomGoblin record through **Remove from Hub** instead of editing `devices.json` manually. The new record can then be assigned the desired school, building, room, profile, and display URL.

## Device Administrator activation

On the tested Onn 4K Streaming Device running Android 14, `dpm set-active-admin` returned success but `DevicePolicyManager.isAdminActive()` remained false. RoomGoblin therefore uses Android's user-visible Device Administrator approval flow for reliable activation.

Use **Enable Device Admin** in the Device Agent v2 panel. RoomGoblin launches Android's `android.app.action.ADD_DEVICE_ADMIN` screen for `org.roomgoblin.display/.AgentDeviceAdminReceiver`. Approve the request on the TV, then rerun **Capabilities**. Expected state after successful activation:

- `deviceAdminActive: true`
- `sleepDisplay.available: true`
- `deviceOwner: false` unless the device was separately provisioned as Device Owner.

Device Admin is a fallback tier. Fully managed production deployments should target Device Owner/DPC provisioning during initial device setup.

## Persistent ADB synchronization

`Configure v2` must synchronize the existing Hub-side persistent ADB policy into the Android agent. The broadcast includes `persistent_adb` and `target_adb_port`, preventing the Hub from reporting persistent ADB enabled while Agent v2 believes it is disabled.

## Regression invariants

Do not regress these behaviors:

1. Managed display inventory remains visible when ADB is unavailable.
2. Removing a Hub enrollment must not remove the Android app or wipe unrelated data.
3. Disabled enrollments remain editable and can be re-enabled.
4. Device Admin activation requires the Android system confirmation UI.
5. Agent v2 configuration carries the persistent ADB policy and target port.
6. Do not require manual editing of `devices.json` for routine lifecycle operations.
