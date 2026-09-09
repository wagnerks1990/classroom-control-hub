# Classroom Control Hub Documentation

## Host-network deployment contract

The Linux Hub and maintenance containers, plus reviewed managed add-on templates, now use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

This directory is the canonical technical documentation set for Classroom Control Hub. `wiki/` contains the Git-tracked mirror of the GitHub Wiki.

## Documentation index

- [Music Assistant Sendspin](MUSIC-ASSISTANT-SENDSPIN.md) — dedicated audio transport, PR #22 selective review, regression coverage and migration acceptance.

- [AI Project Context](AI-CONTEXT.md) — compact current architecture, production conventions, behavioral invariants, and AI handoff context.
- [Architecture](ARCHITECTURE.md) — system components, process boundaries, persistence, scheduling, priority arbitration, and service relationships.
- [Deployment](DEPLOYMENT.md) — Docker Compose deployment, persistent storage, host-agent placement, Git updates, backups, and rollback.
- [Configuration](CONFIGURATION.md) — environment variables, site-specific settings, secrets, displays, integrations, and safe public-repository practices.
- [Operations](OPERATIONS.md) — normal classroom operation, automations, announcements, Background Music, display recovery, and maintenance.
- [Troubleshooting](TROUBLESHOOTING.md) — diagnostic workflow and common failure modes.
- [Development](DEVELOPMENT.md) — source layout, local validation, release workflow, version convergence, and contribution practices.
- [Controller](CONTROLLER.md) — controller-specific information.
- [Database](DATABASE.md) — SQLite storage and migration notes.
- [Host Agent](HOST-AGENT.md) — host-level service responsibilities, migration verification, and security boundary.
- [Windows Lab Agent](LAB-AGENT.md) — one-time enrollment, per-computer credentials, signing, removal, and privacy controls.
- [Wiki Synchronization](WIKI-SYNC.md) — how the Git-tracked `wiki/` mirror is published to the actual GitHub Wiki.

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
7. **Keep the Wiki mirror current.** Changes that affect user/admin documentation should update both the relevant `docs/` page and the corresponding `wiki/` page.

## GitHub Wiki

The `wiki/` directory is version-controlled with the application and is the repository-side Wiki source/mirror. Publish it to the actual GitHub Wiki from an authenticated clone with:

```bash
bash scripts/sync-wiki.sh
```

See [WIKI-SYNC.md](WIKI-SYNC.md) for details.
