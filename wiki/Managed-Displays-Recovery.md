# Managed Displays recovery

The Classroom Overview has a **Managed Displays** link beside **Refresh**. It opens `/managed-displays/` for Android / Google TV enrollment and control.

## `Cannot mkdir .../.android: Permission denied`

The maintenance container intentionally runs with a read-only root filesystem and all Linux capabilities dropped. ADB needs one writable persistent directory for its client keys. Classroom Hub supplies the named Docker volume `classroom-control-hub-android-adb` at:

```text
/managed/classroom-hub/data/android-tv/.android
```

This is deliberately narrower than making `/opt/classroom-hub/data` broadly writable and does not require privileged mode or added capabilities.

A Compose-file update is not enough by itself: Docker must recreate the existing maintenance container before a new mount is applied. The supported installer and GUI application updater now force-recreate the maintenance service, and the updater verifies this directory is writable before an update is considered healthy.

If an appliance is already showing `ADB unavailable`, recover it with:

```bash
cd /opt/classroom-hub
sudo docker compose up -d --build --force-recreate maintenance-agent
sudo docker compose up -d --force-recreate classroom-hub
sudo docker compose exec maintenance-agent sh -lc 'test -w /managed/classroom-hub/data/android-tv/.android && echo writable'
```

Refresh **Managed Displays**. If ADB is still unavailable, the page keeps saved device inventory visible and disables only ADB-dependent operations. The full transport error is shown beneath the short health pill.

Do not remove `--force-recreate` from the application updater's core-service deployment step unless mount-change reconciliation is replaced with an equally explicit, tested mechanism.

For detailed verification and security rationale, see `docs/MANAGED-DISPLAYS-RECOVERY.md` in the repository.
