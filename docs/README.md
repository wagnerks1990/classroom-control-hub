# Classroom Control Hub Documentation

This directory is the canonical technical documentation set for Classroom Control Hub. `wiki/` contains the Git-tracked mirror of the GitHub Wiki.

## Documentation index

- [AI Project Context](AI-CONTEXT.md) — compact current architecture, production conventions, behavioral invariants, and AI handoff context.
- [Architecture](ARCHITECTURE.md) — system components, process boundaries, persistence, scheduling, priority arbitration, and service relationships.
- [Deployment](DEPLOYMENT.md) — Docker Compose deployment, persistent storage, host-agent placement, Git updates, backups, and rollback.
- [Configuration](CONFIGURATION.md) — environment variables, site-specific settings, secrets, displays, integrations, and safe public-repository practices.
- [Operations](OPERATIONS.md) — normal classroom operation, automations, announcements, background music, display recovery, and maintenance.
- [Troubleshooting](TROUBLESHOOTING.md) — diagnostic workflow and common failure modes.
- [Development](DEVELOPMENT.md) — source layout, local validation, release workflow, version convergence, and contribution practices.
- [Controller](CONTROLLER.md) — controller-specific information.
- [Database](DATABASE.md) — SQLite storage and migration notes.
- [Host Agent](HOST-AGENT.md) — host-level service responsibilities, migration verification, and security boundary.

## AI and contributor instructions

`/AGENTS.md` is the authoritative operating contract for AI coding assistants and contributors. GitHub Copilot also receives `.github/copilot-instructions.md`.

Before changing behavior, an AI assistant should read:

1. `AGENTS.md`
2. `VERSION` and `CHANGELOG.md`
3. `docs/AI-CONTEXT.md`
4. the relevant topic document
5. the implementation source

## Documentation principles

1. **Public-safe by default.** Examples must not contain production credentials, private keys, real tokens, student information, or site secrets.
2. **Configuration over hard-coding.** District names, domains, device addresses, schedules, stream URLs, and integration endpoints belong in configuration.
3. **Operationally useful.** Documentation should include commands, expected results, recovery procedures, and failure symptoms.
4. **Version-aware.** Behavioral changes should be reflected in `CHANGELOG.md` and relevant documentation at the same time as code changes.
5. **Preserve persistent data.** Upgrade instructions must treat databases, uploaded media, secrets, and site configuration as persistent state outside replaceable application images/source.
6. **Keep AI context current.** Architecture, installation-path, integration-health, scheduler, or priority changes must be reflected in `AGENTS.md`/`AI-CONTEXT.md` when they materially change how future work should be performed.

## GitHub Wiki

Corrections should be made in `/docs` and the relevant `wiki/` mirror page as part of the same change. The `wiki/` directory is version-controlled with the application and should be synchronized to the actual GitHub Wiki after changes.
