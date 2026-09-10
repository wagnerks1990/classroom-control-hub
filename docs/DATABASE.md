# Classroom Control Hub Database

Classroom Control Hub 1.0 uses SQLite at `data/classroom-control-hub.db` with WAL journaling.

## Schema 2 / alpha.3

Alpha.3 promotes high-value configuration from the compatibility `object_store`
into first-class relational tables while keeping the existing application API and
in-memory data shapes intact.

Normalized data now includes:

- site/display configuration (`site_settings`, `display_devices`)
- optional per-display authentication and one-use enrollment (`display_credentials`, `display_enrollment_codes`)
- display and lighting groups (`device_groups`, `device_group_members`)
- hardware integrations and Govee devices (`integrations`, `integration_devices`)
- managed Docker modules (`managed_modules`)
- class schedules (`class_schedules`)
- scheduler calendar (`scheduler_calendar`)
- automations (`automations`, `automation_actions`, `automation_targets`)
- saved scenes (`scenes`)
- classroom sessions (`sessions`)
- audit history (`audit_events`)
- encrypted credentials/private keys (`secret_store`)
- public certificates (`certificates`)

Large binary assets remain on disk under `data/` and are referenced by database
metadata where appropriate.

## Compatibility migration

On first alpha.3 startup, existing alpha.2 `object_store` rows for normalized
namespaces are transactionally imported into relational tables. The migrated
compatibility rows are then removed so the relational tables become authoritative.
The application continues to consume the same JSON-shaped objects through the
storage abstraction, so existing controller/API behavior is preserved.

The storage abstraction also makes non-normalized application namespaces database-backed. A path such as `data/veyon-computers.json` is a legacy namespace identifier, not an instruction to use a JSON file at runtime. With `LEGACY_JSON_MIRROR=false` (the production default), reads and writes use SQLite `object_store` and do not maintain JSON mirrors.

### Veyon state

Veyon application state is database-authoritative:

- computer inventory, IP addresses, hostnames, names, roles, discovery timestamps and related metadata are stored under the SQLite `veyon-computers` namespace;
- WebAPI URL, key name, scan range, connection pool and retry settings are stored in database-backed integration settings/preferences;
- the Veyon private authentication key is stored encrypted in `secret_store` as `veyon.private-key`;
- optional Windows/domain and Linux/SSH endpoint-deployment credentials are encrypted integration secrets;
- the Veyon public key and non-secret endpoint-deployment metadata may be stored as managed-integration configuration.

For upgrades from older releases, `data/veyon-computers.json` is imported and merged into SQLite during startup recovery. The import is verified before the active legacy JSON file is removed. Migration history records the conversion. Existing rollback/migration backups remain the safety copy.

Native Veyon itself may still require key files under its operating-system directories. Those files are generated/imported runtime material for Veyon, not the Classroom Control Hub source of truth. The Hub's authoritative private key remains the encrypted database value. During the migration window, the legacy host key mount may remain available only as one-time import compatibility.

## Encryption

Secret values are encrypted with AES-256-GCM. The master key remains outside the
database at `/etc/classroom-control-hub/master.key` and is mounted read-only into the
containers. A database backup without the master key cannot decrypt stored secrets.

Veyon private keys, Music Assistant long-lived access tokens, MQTT passwords, and optional endpoint deployment credentials follow this same encrypted-secret model. Secrets are never returned to normal controller views; masked placeholders mean the encrypted value is retained unless explicitly replaced.

## Schema version 3
Alpha 4 adds `access_profiles` and `system_preferences`, retires the legacy runtime-config display overlay, and exposes the normalized configuration through supported administration APIs. The web controller is now the preferred configuration surface; direct SQLite edits are unsupported.

## Schema version 7

Schema 7 adds individually revocable display credentials and expiring one-use
enrollment codes. Both tables store SHA-256 token hashes only. Credentials are
owned by stable `display_devices` IDs, survive display renames/configuration
updates, and cascade away when the display itself is deleted.

## Schema versions 8–10

- Schema 8 separates high-volume polling telemetry from durable audit events so routine discovery does not grow the audit table without bound.
- Schema 9 adds individually revocable Windows lab-agent credentials and expiring enrollment codes. Raw tokens are returned only during enrollment.
- Schema 10 expands built-in access profiles with granular schedule, automation, media, integration, lab, and diagnostic capabilities.

Migration versions are inserted only after their transaction completes. Startup recovery may repair an incomplete built-in Administrator profile, but it does not rewrite a valid non-empty custom capability list. `DATABASE_FILE` is the authoritative database identity; startup does not silently select a differently named legacy database. Installer reconciliation must stop the app, create SQLite-safe backups, validate `PRAGMA quick_check`, and preserve the prior file for rollback.
