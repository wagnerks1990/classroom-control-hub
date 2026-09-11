# AI Context — Android APK Staging

Treat the Android display APK permission model as a security invariant.

## Known physical failure

On the validated Classroom Hub appliance, `RoomGoblin-Display-Agent.apk` could exist at `/managed/classroom-hub/data/android-tv/RoomGoblin-Display-Agent.apk` with host ownership `10001:10001` and mode `0660`, yet `adb install` from the hardened maintenance container failed with `Permission denied` because container root has `cap_drop: ALL` and did not belong to shared GID `10001`.

## Required design

- Keep the maintenance container unprivileged and `cap_drop: ALL`.
- Do not solve this by adding `CAP_DAC_OVERRIDE`, privileged mode, or world-readable APK permissions.
- The shared application-data group is GID `10001`.
- The maintenance container must retain supplemental group `10001` via Docker Compose `group_add`.
- The staged APK must remain group-readable.
- The maintenance healthcheck must fail when the standard staged APK exists but is unreadable from inside the maintenance container.

When troubleshooting Android Agent install/reinstall failures, test readability from inside the maintenance container before blaming ADB or the Android device.
