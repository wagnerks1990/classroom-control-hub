# Managed Displays recovery and ADB key storage

## Purpose

Managed Displays is the administrator surface for Android / Google TV enrollment, assignment, remote control, agent deployment, screenshots and remote shell. The controller Overview links directly to `/managed-displays/` beside **Refresh**.

## ADB key-storage regression

The maintenance container is intentionally hardened with a read-only root filesystem and all Linux capabilities dropped. Android `adb` still creates its persistent client identity beneath `$HOME/.android`. The Android integration points `HOME` and `ANDROID_USER_HOME` at `/managed/classroom-hub/data/android-tv`, so the effective key directory is `/managed/classroom-hub/data/android-tv/.android`.

A host data directory can legitimately be owned by UID/GID 10001 with restrictive modes. A capability-less UID 0 process cannot bypass discretionary access controls when it is not the owner. The resulting failure looks like:

```text
adb_utils.cpp:315 Cannot mkdir '/managed/classroom-hub/data/android-tv/.android': Permission denied
```

Do not fix this by making the whole Hub data directory world-writable, adding `privileged: true`, adding broad Linux capabilities, or moving ADB keys into the container's ephemeral filesystem.

## Permanent storage and inventory contract

`docker-compose.override.yml` mounts the named volume `classroom-control-hub-android-adb` only at:

```text
/managed/classroom-hub/data/android-tv/.android
```

This gives platform-tools the one writable directory it needs while preserving the base Compose hardening and existing host-backed Android device inventory. The volume persists across maintenance-container rebuilds and recreations.

The nested volume is not sufficient by itself. Linux must traverse the host-backed parent directory before it can reach the nested mount. The supported host layout is:

```text
/opt/classroom-hub/data/android-tv/    root:10001  2770
devices.json                           root:10001  0660
.android/                              dedicated persistent Docker volume
```

The setgid bit on `android-tv/` keeps newly created inventory files in group 10001. `devices.json` must remain group-readable and group-writable because the hardened maintenance process has no DAC-override capability.

`install.sh`, the GUI application updater, and rollback normalize this layout before maintenance starts. Both installer and updater also verify the ADB key directory is writable, and they fail instead of accepting a release when an existing inventory file is not readable.

### Why the UI once showed `0 devices`

An affected appliance still had a valid `data/android-tv/devices.json` containing the enrolled display, but the file was `0600` and owned by UID 10001. The maintenance process could not read it. The old `JsonStore.load()` caught the filesystem/JSON exception and silently substituted an empty store, so Managed Displays incorrectly showed `0 devices`.

That behavior is no longer acceptable. An unreadable or malformed inventory must surface as an error; it must never be translated into an empty managed-device inventory.

## Container recreation contract

Container recreation is part of the storage contract. Updating Compose source alone is insufficient because Docker does not retrofit new mounts into an already-created container. Both supported deployment paths therefore force-recreate `maintenance-agent` when applying a release:

- `install.sh` force-recreates maintenance before starting the main application;
- `host-agent/app-update-runner.sh` force-recreates both core services so mount, network, environment, and hardening changes are applied;
- the application updater verifies ADB storage and inventory accessibility before declaring an update healthy.

Do not replace the updater deployment command with a plain `docker compose up -d` that can preserve an old maintenance-container mount set.

## Manual recovery for an appliance already in the failed state

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

sudo docker compose exec maintenance-agent sh -lc '
  test -w /managed/classroom-hub/data/android-tv/.android &&
  test ! -e /managed/classroom-hub/data/android-tv/devices.json ||
  test -r /managed/classroom-hub/data/android-tv/devices.json
'
```

Then open **Managed Displays** and use **Refresh**. The status should report `ADB bridge ready`, and existing inventory should reappear without re-pairing.

## Display Agent false `Not installed` regression

On the validated Onn 4K Streaming Device running Android 14, the Hub reported **Not installed** even while both of these live checks succeeded:

```bash
adb -s <serial> shell pm path org.roomgoblin.display
adb -s <serial> shell pidof org.roomgoblin.display
```

The first returned the package APK path and the second returned a live PID. The old browser probe ran `dumpsys package` before checking `pidof`; on this device `dumpsys package org.roomgoblin.display` could block indefinitely. That made the primary status path slow/unreliable even though the package was installed and running.

The status contract is now:

1. `pm path org.roomgoblin.display` determines **installed / not installed**.
2. `pidof org.roomgoblin.display` independently determines **running / stopped**.
3. `dumpsys package` is not part of the critical agent-status path.
4. Optional metadata/version probes must be bounded and may enrich status only; failure must not downgrade a confirmed installed/running state.

If **Launch Agent** succeeds while the UI claims **Not installed**, verify with `pm path` and `pidof` before reinstalling or re-pairing.

## Degraded UI behavior

The Android status API may return HTTP 503 while still returning stored device/profile inventory. The Managed Displays client preserves that payload instead of discarding it. During an ADB outage:

- device cards remain visible when inventory is readable;
- Edit remains available for assignment/content metadata;
- ADB-dependent controls, enrollment and remote shell are disabled;
- the short status pill says `ADB unavailable`;
- the detailed error appears separately so a long platform-tools error cannot destroy the page layout;
- the client retries status and re-enables controls after recovery.

This separation is intentional: inventory persistence, ADB transport health, package installation, and agent running state are different concerns.

## Live-validated sequence, 2026-09-10

The following recovery sequence was validated against the classroom appliance and the Onn Android 14 target:

1. Maintenance initially reported ADB key storage unavailable.
2. Recreating maintenance exposed the expected `classroom-control-hub-android-adb` mount, but parent traversal still failed.
3. Normalizing `data/android-tv` to `root:10001 2770` restored access to the nested `.android` volume.
4. `devices.json` was found intact with the saved `L127 Hallway` record but was mode `0600`; changing it to `root:10001 0660` restored inventory without re-pairing.
5. Wireless Debugging was manually re-enabled and the device returned Online at its fixed `:5555` endpoint.
6. The UI still said **Not installed**, while `pm path org.roomgoblin.display` returned the APK path and `pidof org.roomgoblin.display` returned PID `1558`.
7. `dumpsys package org.roomgoblin.display` hung on the device, confirming it must not be used in the critical agent-status probe.

## Verification

Run:

```bash
npm test
bash -n install.sh host-agent/app-update-runner.sh
sudo docker compose config >/tmp/classroom-hub-compose.txt
grep -n 'classroom-hub-android-adb' /tmp/classroom-hub-compose.txt
```

On a live appliance also verify:

```bash
sudo docker compose exec maintenance-agent sh -lc 'test -w /managed/classroom-hub/data/android-tv/.android'
sudo docker compose exec maintenance-agent sh -lc 'test ! -e /managed/classroom-hub/data/android-tv/devices.json || test -r /managed/classroom-hub/data/android-tv/devices.json'
sudo docker inspect classroom-control-hub-maintenance --format '{{json .Mounts}}'
```

For an online managed Android display:

```bash
sudo docker compose exec maintenance-agent adb -s <serial> shell pm path org.roomgoblin.display
sudo docker compose exec maintenance-agent adb -s <serial> shell pidof org.roomgoblin.display
```

CI or a successful image build does not prove that an already-running maintenance container has the current mount set. Deployment/recovery is not complete until the container has been recreated and the storage/inventory checks succeed.
