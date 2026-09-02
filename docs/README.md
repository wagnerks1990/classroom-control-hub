# Classroom Control Hub Documentation

This directory is the canonical documentation set for Classroom Control Hub. It is organized so the same Markdown pages can be mirrored into a GitHub Wiki without restructuring.

## Documentation index

- [Architecture](ARCHITECTURE.md) — system components, process boundaries, persistence, scheduling, priority arbitration, and service relationships.
- [Deployment](DEPLOYMENT.md) — Docker Compose deployment, persistent storage, host-agent placement, updates, backups, and rollback.
- [Configuration](CONFIGURATION.md) — environment variables, site-specific settings, secrets, displays, integrations, and safe public-repository practices.
- [Operations](OPERATIONS.md) — normal classroom operation, automations, announcements, background music, display recovery, and maintenance.
- [Troubleshooting](TROUBLESHOOTING.md) — diagnostic workflow and common failure modes.
- [Development](DEVELOPMENT.md) — source layout, local validation, release workflow, version convergence, and contribution practices.
- [Controller](CONTROLLER.md) — controller-specific information.
- [Database](DATABASE.md) — SQLite storage and migration notes.
- [Host Agent](HOST-AGENT.md) — host-level service responsibilities and security boundary.

## Documentation principles

1. **Public-safe by default.** Examples must not contain production credentials, private keys, real tokens, student information, or site secrets.
2. **Configuration over hard-coding.** District names, domains, device addresses, schedules, stream URLs, and integration endpoints belong in configuration.
3. **Operationally useful.** Documentation should include commands, expected results, recovery procedures, and failure symptoms.
4. **Version-aware.** Behavioral changes should be reflected in `CHANGELOG.md` and relevant documentation at the same time as code changes.
5. **Preserve persistent data.** Upgrade instructions must treat databases, uploaded media, secrets, and site configuration as persistent state outside replaceable application images.

## GitHub Wiki

The repository documentation is the source of truth. A GitHub Wiki can mirror these pages later for easier navigation, but corrections should be made in `/docs` first so documentation remains version-controlled with the application.
