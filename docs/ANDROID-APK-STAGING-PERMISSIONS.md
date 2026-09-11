# Android Agent APK Staging Permissions

## Problem

The Android TV maintenance container is intentionally hardened with `cap_drop: ALL` and therefore does not have `CAP_DAC_OVERRIDE`. A staged APK can exist and still be unreadable to container root when the host file is owned by UID/GID `10001:10001` with mode `0660`.

Observed failure on the validated Onn deployment:

```text
adb: failed to open /managed/classroom-hub/data/android-tv/RoomGoblin-Display-Agent.apk: Permission denied
```

The file itself was valid. The failure was host/container DAC identity mismatch.

## Permanent model

The application data contract uses shared host GID `10001`. The maintenance container now explicitly joins supplemental group `10001` using Compose `group_add`. This preserves the hardened capability set while allowing the maintenance process to read group-readable staged artifacts such as the Android agent APK.

The Android TV data directory remains setgid/group writable. Staged artifacts should remain private to root/application maintenance users; do not make APKs world-readable as a workaround.

Expected safe modes:

```text
data/android-tv/                       root:10001 2770
RoomGoblin-Display-Agent.apk         *:10001    0660 or stricter while group-readable
```

The file owner may be root or the application UID. Group membership is the stable cross-container access contract.

## Health validation

The maintenance container healthcheck now verifies that `RoomGoblin-Display-Agent.apk`, when present, is readable from inside the maintenance container. A deployment with an unreadable staged APK is therefore unhealthy instead of allowing the problem to remain hidden until an operator clicks Install/Reinstall Agent.

## Verification

After deployment:

```bash
docker compose exec -T maintenance-agent id
docker compose exec -T maintenance-agent sh -lc 'test -r /managed/classroom-hub/data/android-tv/RoomGoblin-Display-Agent.apk && echo APK-readable'
```

The container identity should include supplemental group `10001`, and the second command should print `APK-readable` when the staged APK exists.

## Security rationale

Do not restore `CAP_DAC_OVERRIDE`, run the maintenance container privileged, or chmod the APK to `0644/0666` merely to solve this issue. Supplemental group membership is narrower and matches the existing shared application-data ownership contract.
