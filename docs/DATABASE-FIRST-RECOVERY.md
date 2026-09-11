# Database-First Persistence and Full-System Recovery Contract

## Status

This document defines both the implemented recovery architecture and the
persistence rules that future features must follow.

### Alpha.80 implementation boundary

Alpha.80 implements the single-export recovery contract for a clean, compatible
RoomGoblin installation. **Full Recovery Export** produces one passphrase-
encrypted and authenticated `.rgbak` bundle. **Import Full Recovery** validates
and stages that bundle, then delegates the host-wide transaction to the native
Host Agent. The transaction covers the active SQLite database, matching master
key, RoomGoblin data/assets, Android inventory and ADB trust, Android signing
identity, supported managed-service data, and bounded native Veyon recovery
identity. It creates a complete safety snapshot and uses a durable journal to roll
all changed recovery roots back when commit or verification fails.

Android/Google TV inventory remains in the compatibility file
`data/android-tv/devices.json` in alpha.80. That state is covered by the bundle
and restored without changing stable device IDs or ADB identity. Moving it to
normalized SQLite remains a future persistence improvement, not a prerequisite
for the implemented recovery contract.

This feature does not restore source code, Docker images, arbitrary host files,
host-specific network configuration, or externally owned/adopted services. A
clean target must first have a compatible RoomGoblin release installed. Recovery
reconstructs durable RoomGoblin state; the installed release supplies executable
code and reviewed service definitions.

The goal is deliberately simple:

> **One export. One import. Full recovery.**
>
> An administrator should be able to create a single RoomGoblin backup export, install RoomGoblin on a clean supported host, import that same export, and recover a fully functional system without manually re-entering site configuration.

The export should contain **exactly the state required for a complete restore**: no arbitrary source tree copies, stale migration files, caches, temporary files, or replaceable application images.

## Core rule

Application-owned configuration and durable runtime state should be stored in SQLite whenever practical. Environment variables and host files should be limited to deployment/bootstrap concerns, host security boundaries, and data that should not live inside the database.

A value belongs in SQLite when all of the following are true:

- it is created, changed, or viewed through RoomGoblin;
- it describes the classroom/site, users, devices, integrations, schedules, policies, or application behavior;
- it must survive container recreation, source updates, or appliance replacement;
- RoomGoblin can safely migrate, validate, version, and restore it;
- it is not a large/binary artifact better represented by database metadata plus a filesystem object.

## Single-export recovery objective

The supported disaster-recovery workflow is:

```text
Existing RoomGoblin appliance
        |
        |  Backup / Export
        v
+----------------------------------+
| roomgoblin-full-<timestamp>.rgbak|
| single portable recovery bundle  |
+----------------------------------+
        |
        | copy/store safely
        v
Clean supported Ubuntu host
        |
        | install RoomGoblin
        | Import / Restore
        v
Fully restored RoomGoblin appliance
```

The administrator should not need to know which database file, key file, JSON file, ADB file, media directory, or managed-service directory is required. RoomGoblin should determine that from the backup manifest and restore it safely.

A successful full export must include the required contents of four logical categories **inside one recovery bundle**:

1. **SQLite application database** — authoritative application configuration and durable state.
2. **Master encryption key and required protected recovery secrets** — required to decrypt encrypted application values and restore trusted appliance boundaries.
3. **Required data/assets** — uploaded media, presentations, managed-device artifacts/trust material, and other non-replaceable files.
4. **Recovery manifest** — version/schema information and the minimal deployment metadata required to reconstruct paths, ownership, and supported managed services.

These are logical categories, not separate files the administrator should have to manage manually.

A recovery must not require copying arbitrary historical JSON configuration files back into place.

## Exact-content principle

A full RoomGoblin recovery export should contain what is **necessary and sufficient** to rebuild the installation.

### Include

Include state that cannot be regenerated without changing the restored system:

- active SQLite database;
- matching master encryption key;
- required maintenance/bootstrap secrets when continuity requires them;
- uploaded media and presentation assets;
- non-regenerable application-managed files referenced by the database;
- Android/Google TV ADB trust/key material required to preserve pairing;
- managed-device deployment artifacts only when they cannot be safely regenerated from the restored release/configuration;
- supported managed-service persistent data when RoomGoblin promises to restore that service's state;
- a manifest containing backup format version, RoomGoblin release, database schema version, checksums, file roles, expected ownership/modes, and restore requirements.

### Exclude

Do not include replaceable or irrelevant state merely because it exists under the installation directory:

- Git checkout/source files;
- Docker images or container writable layers;
- node modules/build caches;
- temporary files;
- stale retired JSON configuration after verified migration;
- log files unless deliberately requested as diagnostics;
- transient discovery caches that can be safely regenerated;
- old backup archives inside a new backup archive;
- unrelated host files;
- generated artifacts that are guaranteed reproducible from the restored release and stored configuration.

The backup implementation should maintain an explicit allowlist/manifest of restorable state rather than recursively archiving `/opt/classroom-hub`.

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

Raw ADB private key material may remain outside SQLite if required by external tooling, but it must be included automatically in a full recovery export when preserving device trust requires it. RoomGoblin should store enough authoritative metadata to restore/reconcile the managed-device relationship. Secret material that can safely be encrypted should use `secret_store`.

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
- thumbnails and generated media derivatives when they are not safely regenerable;
- large exports/import packages.

The single full recovery export must include every non-regenerable file required for restored database references to work.

### External integration data directories

RoomGoblin-managed third-party services may require their own persistent data directories beneath the managed-services root. Examples include Music Assistant, Mosquitto, and Govee2MQTT. These directories are external application state and are not expected to be converted into RoomGoblin SQLite rows.

If RoomGoblin's full-restore promise includes the service's application state, the required directory must be automatically captured inside the same recovery bundle. If a service can be cleanly recreated from RoomGoblin configuration without loss, the bundle may omit its regenerable files.

## State that must remain outside the database

The following should remain host/deployment state unless a future design explicitly changes the boundary.

### Master encryption key

The master key must remain outside SQLite. Storing the database encryption key in the same database would defeat the protection provided by encrypted `secret_store` values.

Current compatibility path:

```text
/etc/classroom-control-hub/master.key
```

The user should not need to back this file up separately. A **full recovery export must securely include it** (or an equivalent wrapped/encrypted recovery form) so the restored database can decrypt its secrets.

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

Most of these should not be blindly restored from an old machine. The export manifest should distinguish **portable application state** from **host-specific values that should use fresh-install defaults**. Only values required for functional continuity should be carried forward.

### Bootstrap/maintenance authentication boundary

Secrets required before the application database is available, or required to authenticate the host/maintenance boundary, may remain deployment secrets. When continuity requires them, they must be protected inside the single full recovery export. When they are safe to regenerate, restore should generate new values and reconcile the restored application automatically.

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

ADB trust material itself must be preserved independently by runtime storage, and the full recovery export must include the exact trust material required to keep supported devices paired.

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

## Backup product contract

The normal administrator-facing backup action should be a single **Full Recovery Export**.

Advanced/diagnostic backup classes may exist, but the user should never need to combine multiple backup types manually to recover an appliance.

### Full Recovery Export

The export produces one portable, versioned `.rgbak` recovery bundle containing
exactly the restorable state defined by this document. The plaintext ZIP payload
exists only while the maintenance process constructs or validates the bounded
bundle; the administrator downloads and stores the encrypted envelope, not a
plaintext archive.

To obtain a consistent external-service snapshot, export temporarily stops only
running add-ons that carry RoomGoblin's ownership marker and exact pinned image,
then restarts them in dependency-safe order. It never stops or copies adopted/
external add-ons. Failure to quiesce or restart an owned add-on fails the export
and removes the incomplete bundle; operators should expect a brief interruption
to RoomGoblin-owned MQTT, lighting, automation, or audio services while a full
export is created.

The bundle should include a machine-readable manifest similar in concept to:

```text
backup-format-version
roomgoblin-version
source-commit/release
created-at
database-schema-version
database-file-role
master-key-role
asset inventory + checksums
managed-device trust-material inventory
managed-service state inventory
ownership/mode requirements
migration/compatibility requirements
```

The actual manifest format may be JSON or another reviewed format. It must not contain plaintext secrets when metadata is sufficient.

### `.rgbak` encryption and authentication

Because a full recovery bundle contains enough information to reconstruct a
working appliance, it is highly sensitive. Alpha.80 uses a passphrase-derived
authenticated envelope:

- AES-256-GCM provides encryption and authentication;
- scrypt derives the encryption key with `N=32768`, `r=8`, and `p=1`;
- each export uses a random 16-byte salt and 12-byte nonce;
- the bounded canonical header is authenticated as additional data, so format,
  KDF, cipher, and length changes are detected before extraction;
- passphrases must contain at least 16 characters and at most 1024 UTF-8 bytes;
- the implementation buffers at most 256 MiB by default and enforces an
  absolute 512 MiB envelope limit.

The passphrase is not written to the bundle, database, recovery journal, or
logs. Losing it makes the export unrecoverable. Store the passphrase separately
from the `.rgbak` file in an approved password manager or offline recovery
record. Never upload a recovery bundle to a support case.

Passphrase submission is permitted only over a secure browser context: use the
controller locally on the appliance (`localhost`/loopback), or use HTTPS
terminated by a same-host loopback reverse proxy. The normal direct-HTTP trusted
LAN mode is **not sufficient for transmitting a recovery passphrase**. Do not
bypass this restriction merely because the network is private.

For the same-host TLS proxy, set `TRUST_PROXY_HOPS` to the exact proxy hop count and firewall
the backend listener so clients cannot reach port 3000 except through that
proxy. Forwarded HTTPS headers are trustworthy only when direct backend access
is blocked. Leave `TRUST_PROXY_HOPS=0` for direct/loopback deployments.

AES-GCM authentication and the inner per-file SHA-256 inventory must both pass
before host mutation. SHA-256 inventory alone is a corruption check, not proof
of provenance; authenticity comes from possession of the independent recovery
passphrase.

### Capacity planning

Full Recovery Export is intentionally bounded and buffered. Before exporting,
ensure the aggregate allowlisted state fits beneath the configured 256 MiB
default and that both the RoomGoblin data filesystem and host backup filesystem
have enough free space for the export, staging copy, and safety snapshot. The
512 MiB hard limit cannot be raised through configuration. Large replaceable
media should be regenerated or managed outside RoomGoblin rather than weakening
the recovery boundary.

## Import / restore product contract

On a clean supported RoomGoblin installation, the administrator chooses
**Import Full Recovery**, selects the single `.rgbak` export, provides its
passphrase, reviews the plan, and explicitly starts the host transaction.

Maintenance stages authenticated content beneath
`/host-backups/recovery-staging` (host path
`${HOST_BACKUP_DIR}/recovery-staging`). The Host Agent serializes update and
recovery mutation with `/run/classroom-control-hub-appliance-mutation.lock` and
records the
durable transaction under `/var/lib/classroom-hub/full-recovery`. A restart or
power interruption therefore resumes rollback instead of treating a partially
committed appliance as healthy. Staging paths, archive paths, ownership, and
modes are fixed by policy; bundle metadata cannot select arbitrary host paths.

Restore should automatically:

1. inspect and authenticate/validate the bundle;
2. verify backup format and RoomGoblin version compatibility;
3. create a safety backup of any current state before mutation;
4. stop affected services cleanly;
5. restore the active SQLite database using SQLite-safe procedures;
6. restore/reconcile the master encryption key;
7. restore required application assets;
8. restore/reconcile managed-device ADB trust material;
9. restore supported managed-service state included in the bundle;
10. apply correct ownership and permissions;
11. run required database migrations;
12. regenerate host-specific bootstrap values when safer than restoring them;
13. recreate/restart services using the current supported deployment model;
14. run health, schema, secret-decryption, scheduler, integration, managed-display, and version-convergence checks;
15. automatically roll back every changed recovery root to the safety snapshot
    if restore validation fails or an interrupted transaction is recovered.

The import workflow should not ask the administrator which individual files to restore.

### Service ownership and restart rules

Recovery distinguishes RoomGoblin-owned services from services merely found on
the host:

- a Docker add-on is recreated only when its saved
  `deploymentOwnership` is `roomgoblin` and its image matches the fixed reviewed
  service identity;
- an adopted/external container is never replaced; a same-name ownership or
  image collision fails closed for operator review;
- an owned service that was stopped when exported remains stopped after restore;
- native Veyon recovery is limited to the reviewed Veyon roots exposed to the
  maintenance container as `VEYON_RECOVERY_ROOT=/veyon-recovery`; it does not
  grant arbitrary host-file restore access;
- RoomGoblin core services are quiesced for commit, recreated from the installed
  compatible release, and accepted only after database, scheduler, secret,
  version, maintenance, Host Agent, asset, and managed-device checks pass.

ADB private/public keys and the named
`classroom-control-hub-android-adb` volume are reconciled as one trust identity.
Recovery must prove the mounted ADB directory is writable and preserve existing
pairing; it must not silently generate a new key and call the restore successful.
Android signing keystore and password are restored as a matched identity or not
at all. The master key is likewise committed with its matching database so every
`secret_store` row can be decrypted before acceptance.

Export snapshots the database path reported by the running application, even
when the source uses a historical/custom filename. The portable bundle assigns
that snapshot the canonical target identity
`/app/data/classroom-control-hub.db`. Restore preserves the clean target's
host-specific `.env` values while transactionally replacing only
`DATABASE_FILE` with that canonical identity. It does not restore old listener,
token, root-path or network settings from the source host.

## Restore acceptance and operator drill

The release gate and the operator's periodic disaster-recovery drill use this
scenario. Perform it on an isolated supported host, never against the only live
appliance:

1. on a working appliance, create one Full Recovery Export;
2. provision a clean supported Ubuntu host with no RoomGoblin persistent state;
3. install a compatible RoomGoblin release using the supported installer;
4. open the controller through loopback or HTTPS terminated by the same-host
   proxy, select Import Full Recovery,
   and provide only that single export bundle and its separately stored
   passphrase;
5. complete the restore without manually copying any database, key, JSON, media, ADB, or service-data file;
6. verify `PRAGMA quick_check`;
7. verify schema migration completion;
8. verify the restored master key decrypts all expected `secret_store` entries;
9. verify administrator/login state;
10. verify site identity and school schedule;
11. verify display definitions/groups/access state;
12. verify automations/scenes;
13. verify integration settings and encrypted credentials;
14. verify managed Android/Google TV inventory without re-entering assignments;
15. verify supported previously paired managed devices recover without manual re-pairing when the underlying platform permits it;
16. verify Veyon/lab inventory and credentials;
17. verify Morning Announcements priority/recovery;
18. verify Background Music recovery;
19. verify media/presentation asset references resolve;
20. verify managed integration containers/services can be recreated/adopted with their expected state;
21. verify version convergence and health endpoints;
22. confirm RoomGoblin-owned running/stopped add-ons returned to their saved
    lifecycle state and adopted/external services were not replaced;
23. repeat with wrong passphrase, modified header/tag/ciphertext, truncated and
    oversized bundles, unexpected paths/symlinks, unsafe ownership metadata,
    service name/image collisions, insufficient disk, and injected failures at
    each commit/restart/verification phase;
24. interrupt a restore after mutation begins, restart the Host Agent, and prove
    journal recovery restores the complete pre-restore safety snapshot.

The restore is considered successful only when the new appliance is operational without manually reconstructing site configuration or hunting for additional backup files.

Keep the source appliance and its previous off-host export until this drill has
passed. After success, download a fresh `.rgbak`, verify that it can be inspected
with its passphrase on the isolated target, record the release/schema and drill
date, and retain at least one older known-good export according to local policy.
An export that has never been test-imported is not a verified disaster-recovery
plan.

### Compatibility and rollback expectations

Import must reject unsupported envelope, manifest, release, or schema
combinations before mutation. The supported installer independently enforces
the target host profile before recovery; architecture is not a portable v6
manifest field. Alpha.80 recovery is supported on the same reviewed Ubuntu
Server 24.04 LTS `amd64` appliance profile as the installer. Forward migration
may run only through the installed release's normal database migrations;
recovery does not downgrade a newer schema into older code.

The pre-restore safety snapshot is local rollback state, not the portable
off-host backup. Do not delete or prune it while the transaction journal exists.
If automated rollback reports failure, leave the appliance isolated and stopped,
preserve the journal, staging directory, safety snapshot, and Host Agent logs,
then investigate before retrying. Never manually combine parts of two recovery
transactions.

## Source-of-truth rules

To prevent regression:

1. There must be exactly one authoritative source for each durable application setting.
2. Database-backed state must not be shadowed by a writable JSON file.
3. Environment variables used as migration/bootstrap fallbacks must not overwrite existing database values.
4. Legacy files must be imported transactionally and retired only after verification.
5. Database migrations must preserve stable identifiers used by displays, agents, credentials, schedules, and integrations.
6. Backup/restore code and runtime code must agree on the same active database identity.
7. Secrets stored in SQLite must remain encrypted and require the external master key.
8. Large/binary assets may stay on disk but must be covered automatically by the single full recovery export when required.
9. Upgrade and rollback paths must preserve database, keys, assets, managed-service data, and managed-device trust material.
10. Tests must prove restored systems do not depend on stale `.env` integration values or retired JSON files.
11. New persistent state must declare whether it is database-backed, regenerable, or included in the full recovery export.
12. A new feature that creates non-regenerable persistent state is incomplete until the backup/restore contract covers it.

## Non-goals

This contract does not require:

- storing the master key inside SQLite;
- storing large media blobs directly in SQLite;
- importing third-party service databases into RoomGoblin SQLite;
- archiving the complete source checkout;
- archiving Docker images that can be pulled again;
- preserving stale caches/logs/temp files;
- removing compatibility-sensitive paths/environment variable names before a safe migration exists;
- changing stable device/enrollment identifiers for cosmetic rebranding.

## Documentation and AI contributor rule

Future changes that introduce new persistent application configuration should default to SQLite-backed storage unless the change documents why filesystem/host storage is required.

When adding a new persistent file, contributors must classify it as one of:

- binary/large non-regenerable asset;
- external-service data required for full recovery;
- host/bootstrap/security-boundary state;
- temporary/cache/regenerable data;
- migration-only input.

If it is none of those, it should normally be database-backed.

Any non-regenerable state that remains outside SQLite must be added to the Full Recovery Export allowlist/manifest and covered by restore regression tests.
