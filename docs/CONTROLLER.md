# Classroom Control Hub Controller

## Host-network deployment contract

The Linux Hub and maintenance containers, plus reviewed managed add-on templates, now use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

Normal configuration is structured and validated; advanced raw configuration remains available only where an integration has settings not yet represented by a form.

## Design rules
- Classroom operations stay separate from infrastructure administration.
- Stable display IDs are preserved across renames.
- Display and lighting target domains remain separate.
- Normal users do not need to edit JSON, YAML, or environment files.
- Advanced infrastructure actions remain in System Management.


## Authentication roles (alpha.14)
- Read Only (`viewer`): authenticated status/read access.
- Operator / Teacher (`operator`): read access plus normal classroom control actions.
- Administrator (`admin`): full configuration, users, secrets, database, maintenance and recovery.

Administrator troubleshooting endpoint: `GET /api/v1/admin/health`.

## Integration connection settings

Administrators configure MQTT/Govee, Pluto AV matrix, and Veyon classroom-computer connections under **Settings → Integrations & Hardware**. Saving validates URL schemes and numeric bounds, stores non-secret values in SQLite, encrypts MQTT passwords and Veyon private keys, and applies the settings without an application restart. Secret fields are write-only: the controller reports whether a value exists but never receives it back.

Environment values remain first-start and migration fallbacks. Once the form is saved, its database record is authoritative. Host/container boundary settings and bootstrap credentials remain outside this screen because they are required before the application can safely open its database and serve the controller.

## Classroom display enrollment

Administrators enroll receivers under **Settings → Classroom Display
Enrollment**. The panel reports enabled/enrolled coverage, creates an expiring
one-use link, cancels an unused link, revokes an individual browser credential,
or rotates every credential for one display. Raw credentials are never listed.

Keep legacy shared-token access enabled only while migrating existing displays.
After every enabled display is enrolled, turn it off in the same panel. The
controller refuses to disable the migration path while coverage is incomplete.

## Cross-domain scheduled actions (alpha.17)

Every scheduled event begins with an automatic **Clear Screen** against all enabled Classroom Control Hub display clients before Action 1. The reset also applies to manual **Run Now/Test Now** executions. Timer overlays are added only after the event actions finish.

Each scheduled action owns a target domain. Display actions select display clients, TV power selects TV targets, and Govee actions select lighting groups/devices. Additional actions may reuse the main event targets only when both actions use a compatible target domain. Cross-domain actions require explicit targets in the editor. Legacy cross-domain actions without explicit targets receive safe defaults at execution time so existing schedules continue to work after upgrade.
