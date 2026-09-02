# Classroom Control Hub

Centralized classroom control and automation platform for displays, AV routing, lighting, media, announcements, schedules, and lab infrastructure.

> **Project status:** early alpha. The current production prototype is being migrated into this repository and containerized for repeatable deployment.

## Goals

Classroom Control Hub is designed to provide one control plane for a technology classroom or lab while keeping site-specific configuration outside the application source.

Core capabilities include:

- Classroom display control and digital signage
- Scheduled classroom automations
- Priority morning/live announcements
- Background music through Music Assistant
- AV routing and TV control
- Lighting integrations
- Class, cycle-day, delay, half-day, remote-day, and closure scheduling
- Lab/client management integrations
- Diagnostics, backup, recovery, and host management

## Deployment model

The project is being structured around Docker Compose:

```text
Ubuntu host
├── Classroom Control Hub Host Agent (systemd)
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

Persistent runtime data, site configuration, secrets, media, and databases are stored outside the application image so container upgrades do not erase configuration.

## Container registry

GitHub Actions will publish versioned images to GitHub Container Registry (GHCR). Alpha images will use the `alpha` channel. The `latest` tag will be reserved for stable releases.

## Security

Do not commit `.env`, runtime databases, credentials, API tokens, private keys, backups, or site-specific secret configuration. See `SECURITY.md` as the migration is completed.

## License

No public license has been selected yet. Until a license is added, normal copyright rules apply.
