# AI Context: Managed Display Lifecycle

This file is maintainer/AI context for Android managed-display work.

## Invariants

- Managed-display inventory is durable even when ADB is offline.
- Routine lifecycle operations must never require direct edits to `data/android-tv/devices.json`.
- `Disable enrollment` preserves the record and prevents automated policy application because the policy loop filters `enabled !== false`.
- `Remove from Hub` deletes only the selected enrollment record. It must not uninstall `org.roomgoblin.display`, factory-reset Android, delete the shared Android data directory, or affect other Classroom Hub data.
- Device Agent v2 credentials are part of the enrollment record and disappear when that record is removed.
- A factory-reset/re-enrolled physical TV may legitimately have a new Classroom Hub record; stale records should be explicitly removed.

## Onn Android 14 validation findings

Physical test hardware: Onn 4K Streaming Device, Android 14 / SDK 34, product/device `wayne`.

Observed:

- Agent v2 HTTP management on TCP 8765 survives loss of external ADB.
- `WRITE_SECURE_SETTINGS` can remain granted and Agent v2 can enforce Developer Options/Wireless Debugging when persistent ADB policy is true.
- Android randomized wireless-debugging ports change after reboot; Hub recovery must not treat the old endpoint as permanent identity.
- `dpm set-active-admin` reported success on the test unit, but the agent still saw `DevicePolicyManager.isAdminActive(...) == false` after process restart. Do not treat shell success alone as authoritative Device Admin state.
- The reliable activation UX is Android's native `ACTION_ADD_DEVICE_ADMIN` confirmation screen, launched by the Hub's one-time ADB bootstrap action.
- Device Owner retrofitting was blocked first by an Android TV profile user and then by an existing Google account. Device Owner remains a provisioning-time target.

## API added by lifecycle remediation

- `POST /android/devices/:id/lifecycle` with `{action:"enable"|"disable"|"remove"}`.
- `POST /android/devices/:id/agent/v2/device-admin/activate` opens Android's native Device Administrator approval UI using ADB as a bootstrap transport.

## Agent v2 configuration contract

`Configure v2` must pass the Hub-side persistent ADB state to the Android `CONFIGURE` broadcast:

- `persistent_adb`
- `target_adb_port`

This prevents Hub/agent policy drift.
