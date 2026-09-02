# Classroom Control Hub Database

Classroom Control Hub 1.0 uses SQLite at `data/classroom-control-hub.db` with WAL journaling.

## Schema 2 / alpha.3

Alpha.3 promotes high-value configuration from the compatibility `object_store`
into first-class relational tables while keeping the existing application API and
in-memory data shapes intact.

Normalized data now includes:

- site/display configuration (`site_settings`, `display_devices`)
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

## Encryption

Secret values are encrypted with AES-256-GCM. The master key remains outside the
database at `/etc/classroom-control-hub/master.key` and is mounted read-only into the
containers. A database backup without the master key cannot decrypt stored secrets.

## Schema version 3
Alpha 4 adds `access_profiles` and `system_preferences`, retires the legacy runtime-config display overlay, and exposes the normalized configuration through supported administration APIs. The web controller is now the preferred configuration surface; direct SQLite edits are unsupported.
