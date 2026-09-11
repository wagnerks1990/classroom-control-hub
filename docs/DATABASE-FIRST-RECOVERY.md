# Database-First Persistence and Full-System Recovery Contract

## Status

This document defines the **target persistence architecture** for RoomGoblin. It is a migration and acceptance contract, not a statement that every item below is already implemented.

The goal is simple:

> A fresh RoomGoblin installation restored from the application database, the matching master encryption key, and required binary/data assets should return to a fully functional operational state without re-entering site configuration by hand.

## Core rule

Application-owned configuration and durable runtime state should be stored in SQLite whenever practical. Environment variables and host files should be limited to deployment/bootstrap concerns, host security boundaries, and data that should not live inside the database.

A value belongs in SQLite when all of the following are true:

- it is created, changed, or viewed through RoomGoblin;
- it describes the classroom/site, users, devices, integrations, schedules, policies, or application behavior;
- it must survive container recreation, source updates, or appliance replacement;
- RoomGoblin can safely migrate, validate, version, and restore it;
- it is not a large/binary artifact better represented by database metadata plus a filesystem object.

## Recovery objective

The supported disaster-recovery model should converge on four restore inputs:

1. **SQLite application database** — authoritative application configuration and durable state.
2. **Master encryption key** — required to decrypt encrypted values in `secret_store`.
3. **Data/assets archive** — uploaded media, presentation files, generated packages, certificates/files that are intentionally stored as files, and other large/binary artifacts.
4. **Minimal deployment/bootstrap configuration** — enough host/container configuration to start RoomGoblin and point it at the restored database/key/assets.

A recovery should not require copying arbitrary historical JSON configuration files back into place.

## Database-authoritative state

The following classes of state should be database-authoritative.

### Site and classroom configuration

- site/school/classroom identity;
- room/display friendly names;
- classroom profile/settings;
- controller UI preferences that must follow the installation;
- scheduler/school-cycle profile, timezone, delays, closures, remote-day rules, and calendar exceptions;
- class schedules and continuation relationships.

### Displays and device assignments

- browser display definitions;
- display groups;
- display access/enrollment metadata and credential hashes;
- display assignment and presentation policy;
- Android/Google TV managed-device inventory;
- Android/Google TV managed profiles;
- managed-device assignment, room/building/school metadata;
- agent state that must persist across appliance replacement;
- persistent-ADB policy metadata and stable device-management identity where safe.

Raw ADB private key material may remain outside SQLite if required by external tooling, but RoomGoblin should store enough authoritative metadata to restore/reconcile the managed-device relationship. Secret material that can safely be encrypted should use `secret_store`.

### Integrations

- integration endpoints/URLs;
- non-secret integration configuration;
- enabled/disabled state;
- timeout/retry/pool/concurrency settings;
- managed-module configuration;
- device discovery records that are intended to be durable;
- integration device mappings/groups;
- Music Assistant configuration;
- Veyon application configuration;
- MQTT/Govee settings;
- Pluto settings;
- Morning Announcements configuration;
- managed add-on configuration.

Passwords, tokens, API keys, and private keys that RoomGoblin owns should be encrypted in `secret_store` rather than stored in `.env` or plaintext JSON.

Environment variables may remain as **first-start or migration fallbacks**, but once a database value exists, the database must win. A restart or update must never silently overwrite an established database value with an environment default.

### Automation and operational policy

- automations/actions/targets;
- scenes;
- school/scheduler policy;
- Background Music schedules and favorites;
- update policy/history;
- privacy/retention policy;
- lab-agent policy;
- access profiles;
- user accounts/session-related durable configuration;
- application feature policy that administrators manage in the controller.

### Lab and managed-device inventory

Durable inventory that is logically owned by RoomGoblin should be SQLite-backed, including lab-computer inventory and managed-device state when persistence is required across rebuilds. High-frequency transient telemetry may use dedicated database tables or bounded caches, but should not require standalone JSON files for recovery.

## Filesystem-backed state that is still appropriate

Not everything should be forced into SQLite.

### Large and binary assets

Keep large/binary content on disk and store metadata/references/checksums in the database, for example:

- uploaded media;
- presentation files;
- generated Android APK artifacts and metadata required for deployment;
- thumbnails and generated media derivatives;
- large exports/import packages;
- backup archives.

The backup system must include these files when a complete recovery backup is requested.

### External integration data directories

RoomGoblin-managed third-party services may require their own persistent data directories beneath the managed-services root. Examples include Music Assistant, Mosquitto, and Govee2MQTT. These directories are external application state and are not expected to be converted into RoomGoblin SQLite rows.

A full-appliance recovery must back up and restore them separately when required.

## State that must remain outside the database

The following should remain host/deployment state unless a future design explicitly changes the boundary.

### Master encryption key

The master key must remain outside SQLite. Storing the database encryption key in the same database would defeat the protection provided by encrypted `secret_store` values.

Current compatibility path:

```text
/etc/classroom-control-hub/master.key
```

The backup/restore system must clearly indicate that a database containing encrypted secrets is incomplete without the matching master key.

### Host/container bootstrap configuration

Keep host-bound values outside SQLite, including:

- active database file/path (`DATABASE_FILE`);
- application bind address and listener port;
- maintenance listener/bootstrap connection details;
- host filesystem roots and bind-mount locations;
- image/release tag required to start the appliance;
- container/host UID/GID compatibility values;
- restore limits and host-side safety constraints;
- settings required before SQLite can be opened.

### Bootstrap/maintenance authentication boundary

Secrets required before the application database is available, or required to authenticate the host/maintenance boundary, may remain deployment secrets. They must be included in a secure recovery mechanism when they are required for a rebuilt appliance.

Long-term application credentials that are managed by RoomGoblin should prefer encrypted database storage.

## Current migration priorities

### Priority 1 — Android/Google TV inventory

`data/android-tv/devices.json` is currently durable active application state and should be migrated to normalized SQLite tables.

The migration should preserve:

- stable managed-device IDs;
- serial/host/port/provider/platform data;
- assignment and room/building/school metadata;
- display URL/receiver assignment;
- profile linkage;
- agent package/version/state metadata;
- persistent-ADB policy/state metadata;
- created/updated timestamps;
- profile definitions and policy.

Migration requirements:

1. create normalized schema;
2. import the legacy JSON transactionally;
3. validate record/profile counts and stable IDs;
4. record migration history;
5. retain a rollback backup;
6. only retire/rename the active JSON after successful verification;
7. switch maintenance APIs to the database-backed source;
8. add restart/update/restore regression tests;
9. ensure existing paired devices continue working without re-pairing.

ADB trust material itself must be preserved independently and must not be destroyed by the migration.

### Priority 2 — integration environment fallbacks

MQTT, Pluto, Music Assistant, and Veyon settings currently have environment/bootstrap compatibility paths. These should remain migration/default inputs only.

Acceptance rule:

> If a database-backed integration configuration exists, it is authoritative. Environment defaults must not silently override it after startup, update, restore, or container recreation.

### Priority 3 — legacy JSON compatibility namespaces

Compatibility helpers may continue to refer to historical `data/*.json` names as namespace/source identifiers, but production operation with `LEGACY_JSON_MIRROR=false` must not depend on those files existing.

For every legacy JSON import path:

- import once;
- verify the imported value;
- record migration history;
- retire the active legacy file;
- keep rollback copies only as backups, not as competing sources of truth.

## Backup classes

RoomGoblin backup UI/API should distinguish at least these concepts.

### Configuration backup

Contains:

- SQLite database;
- matching master encryption key through a protected backup mechanism;
- minimal metadata required to identify database/schema/version compatibility.

This restores configuration and encrypted application secrets but not large media or third-party service data.

### Full RoomGoblin backup

Contains or references all data necessary to rebuild the RoomGoblin-controlled system:

- SQLite database;
- master encryption key;
- RoomGoblin file assets;
- managed-device package/artifact state needed for recovery;
- required ADB trust/key material;
- protected bootstrap/maintenance secrets when required;
- a sanitized deployment manifest describing required host paths/listeners;
- optionally, supported managed-service data directories.

Backup archives must not expose plaintext secrets merely to make recovery convenient.

## Restore acceptance test

A full recovery feature is not complete until this scenario passes:

1. start with a clean supported Ubuntu host;
2. install the same or a compatible RoomGoblin release;
3. restore the full RoomGoblin backup;
4. restart/recreate all required services;
5. verify `PRAGMA quick_check`;
6. verify schema migration completion;
7. verify the master key decrypts all expected `secret_store` entries;
8. verify administrator/login state;
9. verify site identity and school schedule;
10. verify display definitions/groups/access state;
11. verify automations/scenes;
12. verify integration settings and encrypted credentials;
13. verify managed Android/Google TV inventory without re-entering assignments;
14. verify ADB/device trust recovery where supported;
15. verify Veyon/lab inventory and credentials;
16. verify Morning Announcements priority/recovery;
17. verify Background Music recovery;
18. verify media/presentation asset references resolve;
19. verify managed integration containers can be adopted/reconciled without losing their persistent data;
20. verify version convergence and health endpoints.

The restore is considered successful only when the appliance is operational without manually reconstructing site configuration.

## Source-of-truth rules

To prevent regression:

1. There must be exactly one authoritative source for each durable application setting.
2. Database-backed state must not be shadowed by a writable JSON file.
3. Environment variables used as migration/bootstrap fallbacks must not overwrite existing database values.
4. Legacy files must be imported transactionally and retired only after verification.
5. Database migrations must preserve stable identifiers used by displays, agents, credentials, schedules, and integrations.
6. Backup/restore code and runtime code must agree on the same active database identity.
7. Secrets stored in SQLite must remain encrypted and require the external master key.
8. Large/binary assets may stay on disk but must be represented in full-backup coverage.
9. Upgrade and rollback paths must preserve database, keys, assets, managed-service data, and managed-device trust material.
10. Tests must prove restored systems do not depend on stale `.env` integration values or retired JSON files.

## Non-goals

This contract does not require:

- storing the master key inside SQLite;
- storing large media blobs directly in SQLite;
- importing third-party service databases into RoomGoblin SQLite;
- removing compatibility-sensitive paths/environment variable names before a safe migration exists;
- changing stable device/enrollment identifiers for cosmetic rebranding.

## Documentation and AI contributor rule

Future changes that introduce new persistent application configuration should default to SQLite-backed storage unless the change documents why filesystem/host storage is required.

When adding a new persistent file, contributors must classify it as one of:

- binary/large asset;
- external-service data;
- host/bootstrap/security-boundary state;
- temporary/cache data;
- migration-only input.

If it is none of those, it should normally be database-backed.
