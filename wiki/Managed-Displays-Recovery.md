# Managed Displays recovery

The Classroom Overview has a **Managed Displays** link beside **Refresh**. It opens `/managed-displays/` for Android / Google TV enrollment and control.

## `Cannot mkdir .../.android: Permission denied`

The maintenance container intentionally runs with a read-only root filesystem and all Linux capabilities dropped. ADB needs one writable persistent directory for its client keys. Classroom Hub now supplies the named Docker volume `classroom-control-hub-android-adb` at:

```text
/managed/classroom-hub/data/android-tv/.android
```

This is deliberately narrower than making `/opt/classroom-hub/data` broadly writable and does not require privileged mode or added capabilities.

After upgrading, recreate maintenance so the new volume mount is active:

```bash
cd /opt/classroom-hub
sudo docker compose up -d --build --force-recreate maintenance-agent
sudo docker compose up -d classroom-hub
```

Refresh **Managed Displays**. If ADB is still unavailable, the page keeps saved device inventory visible and disables only ADB-dependent operations. The full transport error is shown beneath the short health pill.

For detailed verification and security rationale, see `docs/MANAGED-DISPLAYS-RECOVERY.md` in the repository.
