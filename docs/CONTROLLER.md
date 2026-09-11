# RoomGoblin Controller

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

## Classroom display access

Enabled configured displays connect through their stable `/display/<id>` URLs without credentials by default. Under **Settings → Classroom Display Access**, administrators may optionally create expiring one-use enrollment links, inspect coverage, revoke credentials, and enable **Require individual display credentials** after every receiver is enrolled. Raw credentials are never listed.

Turning the requirement off immediately restores stable URL access. The legacy shared display token is only a fallback when credential authentication is enabled.

## Cross-domain scheduled actions (alpha.17)

Every scheduled event begins with an automatic **Clear Screen** against all enabled RoomGoblin display clients before Action 1. The reset also applies to manual **Run Now/Test Now** executions. Timer overlays are added only after the event actions finish.

Each scheduled action owns a target domain. Display actions select display clients, TV power selects TV targets, and Govee actions select lighting groups/devices. Additional actions may reuse the main event targets only when both actions use a compatible target domain. Cross-domain actions require explicit targets in the editor. Legacy cross-domain actions without explicit targets receive safe defaults at execution time so existing schedules continue to work after upgrade.
