# Classroom Control Hub Controller

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

Administrators configure MQTT/Govee, Pluto AV matrix, and Veyon classroom-computer connections under **Admin → Settings → Integrations & Hardware** (or **Settings** in classic layout). Saving validates URL schemes and numeric bounds, stores non-secret values in SQLite, encrypts MQTT passwords and Veyon private keys, and applies the settings without an application restart. Secret fields are write-only: the controller reports whether a value exists but never receives it back.

Environment values remain first-start and migration fallbacks. Once the form is saved, its database record is authoritative. Host/container boundary settings and bootstrap credentials remain outside this screen because they are required before the application can safely open its database and serve the controller.

## Classroom display URLs

Current main uses **Admin → Settings → Classroom Display URLs** (or **Settings** in classic layout). Open or copy the stable `/display/<id>` URL for each enabled receiver. The earlier display-enrollment UI remains in static HTML for compatibility, but the current branding/controller integration replaces it with direct display URLs. Do not instruct operators to rotate enrollment links for this direct-display flow.

This model assumes the trusted classroom network and does not make display URLs suitable for public exposure. Administrator APIs remain authenticated. Windows lab-agent enrollment remains separate and credentialed. See [DISPLAY-ACCESS.md](DISPLAY-ACCESS.md) for the current access model; the workspace preserves it rather than implementing a new authentication scheme.

## Cross-domain scheduled actions (alpha.17)

Every scheduled event begins with an automatic **Clear Screen** against all enabled Classroom Control Hub display clients before Action 1. The reset also applies to manual **Run Now/Test Now** executions. Timer overlays are added only after the event actions finish.

Each scheduled action owns a target domain. Display actions select display clients, TV power selects TV targets, and Govee actions select lighting groups/devices. Additional actions may reuse the main event targets only when both actions use a compatible target domain. Cross-domain actions require explicit targets in the editor. Legacy cross-domain actions without explicit targets receive safe defaults at execution time so existing schedules continue to work after upgrade.

## Task-focused workspace (development)

The new navigation groups the thirteen existing pages under **Today**, **Teach**, **Room**, **Library**, **Plan**, and **Admin**. **Find a tool** searches permitted navigation destinations; Ctrl+K or Command+K opens it. Teaching shortcuts open existing editors without executing commands. Screen selection stays visible beside the display-content editor, with preview and appearance details available on demand. Administration is organized into expandable sections.

The shared workspace preserves existing forms, IDs, authorization, API handlers, attribution, and receiver behavior. **Use classic layout**, or `/controller/?workspace=classic`, bypasses the UI enhancement without changing configuration. This UI change does not override the newer announcement/music/timer invariants in root `AGENTS.md`.

See [WORKSPACE-REDESIGN.md](WORKSPACE-REDESIGN.md) for the navigation map, behavior, known scope limits, testing, and rollout. AI contributors must read [WORKSPACE-AI-CONTEXT.md](WORKSPACE-AI-CONTEXT.md). The wiki mirror includes **Controller Workspace**. Browser fixture results are not evidence of real-application or live-device testing.
