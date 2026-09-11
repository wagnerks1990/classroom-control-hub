# Managed Displays recovery

The Classroom Overview has a **Managed Displays** link beside **Refresh**. It opens `/managed-displays/` for Android / Google TV enrollment and control.

## ADB key storage and inventory permissions

The maintenance container intentionally runs with a read-only root filesystem and all Linux capabilities dropped. ADB needs one writable persistent directory for its client keys. Classroom Hub supplies the named Docker volume `classroom-control-hub-android-adb` at:

```text
/managed/classroom-hub/data/android-tv/.android
```

This is deliberately narrower than making `/opt/classroom-hub/data` broadly writable and does not require privileged mode or added capabilities.

A Compose-file update is not enough by itself: Docker must recreate the existing maintenance container before a new mount is applied. The supported installer and GUI application updater force-recreate the maintenance service, and the updater verifies this directory is writable before an update is considered healthy.

The nested mount also depends on the host-backed parent directory being traversable. The supported layout is:

```text
/opt/classroom-hub/data/android-tv/    root:10001  2770
devices.json                           root:10001  0660
.android/                              dedicated Docker volume
```

An unreadable `devices.json` must be treated as an error. It must never be silently converted into `0 devices`.

If an appliance is already affected:

```bash
cd /opt/classroom-hub
sudo chown root:10001 /opt/classroom-hub/data/android-tv
sudo chmod 2770 /opt/classroom-hub/data/android-tv
if [ -f /opt/classroom-hub/data/android-tv/devices.json ]; then
  sudo chown root:10001 /opt/classroom-hub/data/android-tv/devices.json
  sudo chmod 0660 /opt/classroom-hub/data/android-tv/devices.json
fi
sudo docker compose up -d --build --force-recreate maintenance-agent
sudo docker compose up -d --force-recreate classroom-hub
sudo docker compose exec maintenance-agent sh -lc 'test -w /managed/classroom-hub/data/android-tv/.android && echo writable'
```

Refresh **Managed Displays**. Existing inventory should return without re-pairing.

## Display Agent says `Not installed` but Launch Agent works

On the validated Onn 4K Streaming Device running Android 14, `dumpsys package org.roomgoblin.display` can block while the Display Agent is installed and running. The primary status probe therefore must not depend on `dumpsys package`.

Use these authoritative checks:

```bash
sudo docker compose exec maintenance-agent adb -s <serial> shell pm path org.roomgoblin.display
sudo docker compose exec maintenance-agent adb -s <serial> shell pidof org.roomgoblin.display
```

`pm path` determines installed/not installed. `pidof` independently determines running/stopped. Optional version/metadata probes may enrich status only and must never downgrade a confirmed installed/running state.

## Regression rules

Do not remove `--force-recreate` from the application updater's core-service deployment step unless mount-change reconciliation is replaced with an equally explicit, tested mechanism. Do not weaken the maintenance security boundary to solve ADB storage permissions. Do not catch inventory filesystem/JSON failures and return an empty inventory. Do not put `dumpsys package` back into the critical agent-status path.

For detailed verification, live validation notes, and security rationale, see `docs/MANAGED-DISPLAYS-RECOVERY.md` in the repository.
