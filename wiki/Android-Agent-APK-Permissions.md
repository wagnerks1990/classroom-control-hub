# Android Agent APK Permissions

RoomGoblin stages the Android display APK at:

```text
/opt/classroom-hub/data/android-tv/RoomGoblin-Display-Agent.apk
```

The maintenance container is deliberately unprivileged and drops all Linux capabilities. It therefore cannot rely on root bypassing host file permissions.

The supported access model is:

- Android TV data directory: shared group `10001`, setgid, group writable.
- Staged APK: group `10001`, group readable.
- Maintenance container: supplemental group `10001` through Docker Compose `group_add`.
- APKs do not need to be world-readable.

The maintenance healthcheck validates APK readability whenever the staged APK exists. If the check fails, repair the host file group/mode rather than weakening container security.

Verification:

```bash
cd /opt/classroom-hub
docker compose exec -T maintenance-agent id
docker compose exec -T maintenance-agent sh -lc 'test -r /managed/classroom-hub/data/android-tv/RoomGoblin-Display-Agent.apk && echo APK-readable'
```

A healthy deployment prints `APK-readable` when the APK is staged.
