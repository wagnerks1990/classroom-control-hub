# Classroom Control Hub

Centralized classroom control and automation platform for displays, AV routing, lighting, media, announcements, schedules, and lab infrastructure.

> **Status:** `1.0.0-alpha.63` — initial public GitHub/Docker migration. The project is actively being generalized from a production classroom deployment.

## Project goals

Classroom Control Hub provides one control plane for a technology classroom or lab while keeping organization-specific configuration outside reusable application source.

Core capabilities include:

- classroom display control and digital signage;
- scheduled classroom automations;
- priority live/morning announcements;
- Background Music through Music Assistant;
- AV routing and television control;
- lighting integrations;
- class, cycle-day, delay, half-day, remote-day, and closure scheduling;
- lab/client management integrations;
- diagnostics, backup, recovery, and host-management support.

## Documentation

Detailed, version-controlled documentation is maintained in [`/docs`](docs/README.md). Start with:

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Configuration](docs/CONFIGURATION.md)
- [Operations](docs/OPERATIONS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Controller](docs/CONTROLLER.md)
- [Database](docs/DATABASE.md)
- [Host Agent](docs/HOST-AGENT.md)

The `/docs` tree is intended to serve as the canonical source for a future GitHub Wiki mirror.

## Deployment model

```text
Ubuntu host
├── Classroom Control Hub Host Agent (systemd)
└── Docker
    ├── classroom-control-hub
    └── classroom-control-hub-maintenance
```

Persistent runtime data, site configuration, secrets, media, and databases are stored outside replaceable application images.

## Container registry

GitHub Actions are being prepared to publish versioned images to GitHub Container Registry (GHCR). Alpha images use the `alpha` channel. The `latest` tag is reserved for stable releases.

## Public repository safety

Do not commit:

- `.env`;
- runtime databases/WAL files;
- production API tokens or passwords;
- private keys;
- backups;
- student/user data;
- production diagnostic bundles;
- site-specific secret configuration.

See [SECURITY.md](SECURITY.md) and [Configuration](docs/CONFIGURATION.md).

## Source migration note

The production prototype is being migrated into this public repository in sanitized stages. Some larger core files are temporarily preserved under `source-archive/` in compressed form while their sanitized direct-source counterparts are finalized. Do not treat the repository as production-deployable until the migration notice is removed and validation workflows pass against the complete direct source tree.

## License

No public license has been selected yet. Until a license is added, normal copyright rules apply.
