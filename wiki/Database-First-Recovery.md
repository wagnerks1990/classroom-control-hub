# Database-First Recovery

RoomGoblin is moving toward a database-first persistence model so a rebuilt appliance can be restored without manually reconstructing site configuration.

> **Status in alpha.79:** This page is an acceptance contract, not a completed
> feature announcement. Alpha.79 can create and inspect protected backup
> archives and restore database-backed settings/data into an already running
> appliance. It does not yet provide clean-host **Import Full Recovery**,
> automatic one-bundle restoration of the master key/ADB trust/managed-service
> state, or SQLite-backed Android inventory. The current **Full Recovery**
> backup label must not be interpreted as proof that the workflow below has
> passed its acceptance test.

## Target recovery contract

A complete recovery should require only:

1. the RoomGoblin SQLite database;
2. the matching master encryption key;
3. required RoomGoblin binary/data assets;
4. minimal deployment/bootstrap configuration needed to start the appliance.

After restoring those items onto a clean supported installation, RoomGoblin should return to an operational state without restoring arbitrary historical JSON configuration files.

## What should live in SQLite

Application-owned durable configuration should be database-authoritative whenever practical, including:

- site/classroom identity and preferences;
- school-cycle and scheduler configuration;
- class schedules and calendar exceptions;
- browser display definitions and groups;
- display credential/enrollment metadata;
- Android/Google TV managed-device inventory and profiles;
- automations, actions, targets and scenes;
- integration URLs and non-secret settings;
- MQTT/Govee, Pluto, Veyon, Music Assistant and Morning Announcements application settings;
- managed-module configuration;
- access profiles and application policies;
- update, privacy, lab-agent and other controller-managed policies;
- durable lab/device inventory that RoomGoblin owns.

Passwords, tokens, API keys and private keys owned by RoomGoblin should use the encrypted SQLite `secret_store`.

Environment values for integrations may remain migration/first-start fallbacks, but an established database value must win after setup.

## What should remain outside SQLite

Some state should intentionally remain outside the database:

- the master encryption key;
- database path and host/container bootstrap settings;
- bind addresses/listener ports and host filesystem paths;
- maintenance/bootstrap authentication required before the database is available;
- large media/presentation/generated artifacts;
- ADB or other external-tool key files that must exist in a filesystem location;
- third-party managed-service persistent data directories;
- backup archives.

Large/binary files should remain filesystem-backed while SQLite stores authoritative metadata/references where useful.

## Current highest-priority migration

`data/android-tv/devices.json` is active durable RoomGoblin state and should move into normalized SQLite tables while preserving stable managed-device IDs, profiles, assignments, device/agent state and recovery policy.

The migration must not require existing managed displays to be re-paired. ADB trust/key material must remain intact.

## Legacy JSON rule

Historical `data/*.json` paths may remain as compatibility namespace names or one-time migration inputs, but production operation should not depend on them when `LEGACY_JSON_MIRROR=false`.

A legacy file migration should:

1. import transactionally;
2. verify the imported data;
3. record migration history;
4. retain a rollback backup;
5. retire the active legacy file only after verification.

## Restore acceptance

A future full restore is considered successful only when a clean RoomGoblin installation can recover the database, master key and required assets and then verify users, site identity, schedules, displays, automations, integrations, encrypted credentials, managed Android devices, lab state, media references, update policy and critical classroom behavior without manually re-entering configuration. Alpha.79 has not yet passed this acceptance test.

See `docs/DATABASE-FIRST-RECOVERY.md` in the repository for the complete persistence classification and migration acceptance contract.
