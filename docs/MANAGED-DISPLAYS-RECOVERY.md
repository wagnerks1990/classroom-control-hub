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

## Permanent storage contract

`docker-compose.override.yml` mounts the named volume `classroom-control-hub-android-adb` only at:

```text
/managed/classroom-hub/data/android-tv/.android
```

This gives platform-tools the one writable directory it needs while preserving the base Compose hardening and existing host-backed Android device inventory. The volume persists across maintenance-container rebuilds and recreations.

Container recreation is part of the storage contract. Updating Compose source alone is insufficient because Docker does not retrofit new mounts into an already-created container. Both supported deployment paths therefore force-recreate `maintenance-agent` when applying a release:

- `install.sh` force-recreates maintenance before starting the main application;
- `host-agent/app-update-runner.sh` force-recreates both core services so mount, network, environment, and hardening changes are applied;
- the application updater verifies that the ADB key directory is writable before declaring an update healthy.

This behavior is regression-tested. Do not replace the updater deployment command with a plain `docker compose up -d` that can preserve an old maintenance-container mount set.

### Manual recovery for an appliance already in the failed state

```bash
cd /opt/classroom-hub
sudo docker compose up -d --build --force-recreate maintenance-agent
sudo docker compose up -d --force-recreate classroom-hub
sudo docker compose exec maintenance-agent adb version
sudo docker compose exec maintenance-agent sh -lc 'test -w /managed/classroom-hub/data/android-tv/.android && echo writable'
```

Then open **Managed Displays** and use **Refresh**. The status should report `ADB bridge ready`.

## Degraded UI behavior

The Android status API may return HTTP 503 while still returning stored device/profile inventory. The Managed Displays client preserves that payload instead of discarding it. During an ADB outage:

- device cards remain visible;
- Edit remains available for assignment/content metadata;
- ADB-dependent controls, enrollment and remote shell are disabled;
- the short status pill says `ADB unavailable`;
- the detailed error appears separately so a long platform-tools error cannot destroy the page layout;
- the client retries status and re-enables controls after recovery.

This separation is intentional: inventory persistence and ADB transport health are different concerns.

## Verification

Run:

```bash
npm test
bash -n host-agent/app-update-runner.sh
sudo docker compose config >/tmp/classroom-hub-compose.txt
grep -n 'classroom-hub-android-adb' /tmp/classroom-hub-compose.txt
```

On a live appliance also verify:

```bash
sudo docker compose exec maintenance-agent sh -lc 'test -w /managed/classroom-hub/data/android-tv/.android'
sudo docker inspect classroom-control-hub-maintenance --format '{{json .Mounts}}'
```

CI or a successful image build does not prove that an already-running maintenance container has the current mount set. Deployment/recovery is not complete until the container has been recreated and the writable-directory check succeeds.
