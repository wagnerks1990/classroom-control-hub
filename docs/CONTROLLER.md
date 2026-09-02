# Classroom Control Hub Controller

Alpha.5 begins the public-facing controller cleanup. Normal configuration is now structured and validated; advanced raw configuration remains available only where an integration has settings not yet represented by a form.

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

## Cross-domain scheduled actions (alpha.17)

Every scheduled event begins with an automatic **Clear Screen** against all enabled Classroom Control Hub display clients before Action 1. The reset also applies to manual **Run Now/Test Now** executions. Timer overlays are added only after the event actions finish.

Each scheduled action owns a target domain. Display actions select display clients, TV power selects TV targets, and Govee actions select lighting groups/devices. Additional actions may reuse the main event targets only when both actions use a compatible target domain. Cross-domain actions require explicit targets in the editor. Legacy cross-domain actions without explicit targets receive safe defaults at execution time so existing schedules continue to work after upgrade.
