# RoomGoblin Documentation

**RoomGoblin — Classroom & Lab Management Hub**  
*Run the room. Manage the lab.*

## Host-network deployment contract

The Linux RoomGoblin appliance and maintenance containers, plus reviewed managed add-on templates, use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

This directory is the canonical technical documentation set for RoomGoblin. `wiki/` contains the Git-tracked mirror of the GitHub Wiki. Legacy `Classroom Hub` / `Classroom Control Hub` identifiers may remain where they are part of the deployed compatibility contract; see [RoomGoblin Rebrand and Compatibility](ROOMGOBLIN-REBRAND.md).

## Documentation index

- [RoomGoblin Rebrand and Compatibility](ROOMGOBLIN-REBRAND.md) — canonical naming, compatibility boundaries, migration acceptance criteria, and repository audit policy.
- [RoomGoblin Brand Guide](brand/BRAND-GUIDE.md) — authoritative visual/verbal identity, colors, typography, logo usage, and copy rules.
- [RoomGoblin AI Brand Context](brand/AI-BRAND-CONTEXT.md) — compact machine-readable guidance for assistants and automated contributors.
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
- [Database-First Recovery](DATABASE-FIRST-RECOVERY.md) — future persistence and one-export recovery acceptance contract, including an explicit alpha.79 implemented/not-implemented boundary.
- [Host Agent](HOST-AGENT.md) — host-level service responsibilities, migration verification, and security boundary.
- [Windows Lab Agent](LAB-AGENT.md) — one-time enrollment, per-computer credentials, signing, removal, and privacy controls.
- [Android TV Displays](ANDROID-TV-DISPLAYS.md) — pairing, assignment, Display Agent lifecycle, and device recovery.
- [Persistent Android ADB](PERSISTENT-ANDROID-ADB.md) — trusted-network wireless-debugging recovery and boundaries.
- [Android TV Support Matrix](ANDROID-TV-SUPPORT-MATRIX.md) — tested, pending, and unsupported physical-device behavior.
- [Display Access](DISPLAY-ACCESS.md) — one-use receiver enrollment and credential rotation/revocation.
- [Display Layout Contract](DISPLAY-LAYOUT-CONTRACT.md) — single layout owner, bounded sizing, hard containment, and compact timers.
- [Managed Display Gateway](MANAGED-DISPLAY-GATEWAY.md) — configured media relay, header isolation, sandboxing, and verification.
- [Automation Framework](AUTOMATION-FRAMEWORK.md) — schedule resolution, actions, targets, and execution evidence.
- [Manual Media Audio](MANUAL-MEDIA-AUDIO.md) — operator video/web volume behavior and limitations.
- [Veyon and Music Integrations](VEYON-MUSIC-INTEGRATIONS.md) — native Veyon and Music Assistant ownership.
- [Wiki Synchronization](WIKI-SYNC.md) — how the Git-tracked `wiki/` mirror is published to the actual GitHub Wiki.

## AI and contributor instructions

`/AGENTS.md` is the authoritative operating contract for AI coding assistants and contributors. GitHub Copilot also receives `.github/copilot-instructions.md`. Branding work must also follow `docs/brand/AI-BRAND-CONTEXT.md`.

Before changing behavior, an AI assistant should read:

1. `AGENTS.md`
2. `VERSION` and `CHANGELOG.md`
3. `docs/AI-CONTEXT.md`
4. `docs/brand/AI-BRAND-CONTEXT.md`
5. the relevant topic document
6. the implementation source

## Documentation principles

1. **Public-safe by default.** Examples must not contain production credentials, private keys, real tokens, student information, or site secrets.
2. **Configuration over hard-coding.** District names, domains, device addresses, schedules, stream URLs, and integration endpoints belong in configuration.
3. **Operationally useful.** Documentation should include commands, expected results, recovery procedures, and failure symptoms.
4. **Version-aware.** Behavioral changes should be reflected in `CHANGELOG.md` and relevant documentation at the same time as code changes.
5. **Preserve persistent data.** Upgrade instructions must treat databases, uploaded media, secrets, and site configuration as persistent state outside replaceable application images/source.
6. **Keep AI context current.** Architecture, installation-path, integration-health, scheduler, priority, or branding changes must be reflected in `AGENTS.md`/`AI-CONTEXT.md`/brand AI context when they materially change how future work should be performed.
7. **Keep the Wiki mirror current.** Changes that affect user/admin documentation should update both the relevant `docs/` page and the corresponding `wiki/` page.
8. **Brand current surfaces as RoomGoblin.** Do not use the old product names for new user-facing copy. Preserve old strings only when they identify a compatibility-sensitive internal contract or historical release.

## GitHub Wiki

The `wiki/` directory is version-controlled with the application and is the repository-side Wiki source/mirror. Publish it to the actual GitHub Wiki from an authenticated clone with:

```bash
bash scripts/sync-wiki.sh
```

See [WIKI-SYNC.md](WIKI-SYNC.md) for details.
