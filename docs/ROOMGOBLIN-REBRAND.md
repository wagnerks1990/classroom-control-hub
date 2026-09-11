# RoomGoblin rebrand and compatibility plan

## Canonical identity

- Product name: **RoomGoblin**
- Descriptor: **Classroom & Lab Management Hub**
- Tagline: **Run the room. Manage the lab.**
- Brand package: RoomGoblin Brand Package v1

The RoomGoblin identity applies to operator-facing UI, setup, browser titles, icons, documentation, screenshots, release notes, user-facing agent names, installer messages, and future marketing material.

## Android application migration in alpha.77

RoomGoblin now uses the canonical Android application ID `org.roomgoblin.display`. Android treats this as a different application from the earlier `org.classroomhub.display` package.

If the old Android app exists, **uninstall it and install the new RoomGoblin Display Agent instead of attempting an in-place update**. The managed installation workflow performs that package replacement, preserves the RoomGoblin server-side device record and saved display URL, and restores supported configuration and grants after installation. Device Administrator or Accessibility approval may require confirmation again because Android associates those approvals with the application package.

Do not leave both packages installed on the same display. Rollback to a release before alpha.77 requires uninstalling `org.roomgoblin.display` and reinstalling the legacy APK; Android cannot cross-update between the two package identities.

## Compatibility rule

The rebrand is intentionally not a blind source-wide rename. Earlier Classroom Control Hub releases created identifiers that are part of the deployed contract. Cosmetic consistency is not sufficient justification to break them.

Keep the following stable unless a separately reviewed migration explicitly changes them:

- `/opt/classroom-hub` install path;
- `CLASSROOM_HUB_*` environment variables;
- `org.roomgoblin.display` Android application/package identity (alpha.77 and later);
- `classroom-control-hub*` container, GHCR, systemd, and socket identifiers;
- database filenames and persisted keys;
- setup/session/local-storage compatibility keys;
- device IDs, enrollment credentials, and ADB trust material;
- established API routes and public JavaScript compatibility globals;
- legacy Windows agent task/service/file identifiers used by installed endpoints.

Old identifiers should be described as **legacy-compatible internals**, not as the current product name.

## Runtime brand behavior

`public/shared/branding.js` is the common runtime brand layer. It:

1. uses RoomGoblin as the built-in product identity;
2. applies RoomGoblin default artwork and favicon;
3. supplies the RoomGoblin palette to existing `--brand-*` variables;
4. converts the old built-in product names to RoomGoblin while retaining deliberate site-specific custom names;
5. migrates only the previous built-in color defaults and preserves deliberate custom site colors;
6. keeps `window.ControlHubBranding` and the `controlhub:branding` event as compatibility aliases while also exposing `window.RoomGoblinBranding` and `roomgoblin:branding`;
7. does not rename storage keys, API paths, package IDs, or device identity.

Canonical browser assets live under `public/brand/` and shared visual overrides live in `public/shared/roomgoblin.css`.

## Color system

| Token | Value | Primary use |
| --- | --- | --- |
| Goblin Teal | `#0F766E` | primary controls, product identity |
| Electric Green | `#22C55E` | active/accent states |
| Slate Navy | `#1E293B` | elevated surfaces |
| Learning Amber | `#F59E0B` | attention and learning-state accents |
| Cloud Gray | `#E5E7EB` | borders and quiet UI |
| Mint Glow | `#D1FAE5` | positive/highlight surfaces |

Poppins is preferred for headings and Inter for body text. The application must retain system-font fallbacks because font binaries are not bundled with the repository.

## Migration acceptance criteria

A RoomGoblin release is acceptable only when all of the following remain true:

- an existing appliance can fast-forward update without moving or deleting its data;
- current administrators can sign in after the update;
- current browser display URLs and receiver IDs continue working;
- enrolled Android/Google TV devices retain ADB trust while the old Android app is explicitly uninstalled and the new RoomGoblin package is installed and reconfigured;
- Windows lab agents do not require re-enrollment solely due to the product rename;
- updater, rollback, backup, database, scheduler, and Host Agent health checks still pass;
- operator-facing default branding shows RoomGoblin on fresh installs;
- a site that deliberately configured a custom product name/color remains custom;
- old built-in Classroom Control Hub defaults are promoted to RoomGoblin without changing compatibility keys.

## Search/audit policy

A repository search for `Classroom Control Hub`, `Classroom Hub`, `classroom-hub`, `classroomhub`, and `classroom-control-hub` will continue to return results. Every result must be classified before changing it:

- **presentation/documentation current-name use** -> replace with RoomGoblin;
- **historical release note** -> retain when needed for history;
- **compatibility identifier** -> retain and, where confusing, document why;
- **test fixture for a compatibility identifier** -> retain;
- **obsolete accidental branding** -> replace.

Do not optimize for a zero-result grep. Optimize for a correctly branded product that upgrades safely.

## AI/contributor rule

AI assistants and contributors must read `docs/brand/AI-BRAND-CONTEXT.md` before branding work. They must not rename compatibility-sensitive identifiers unless the change includes an explicit migration, rollback path, and tests proving installed systems and managed devices survive the transition.

When behavior or branding rules change, update this document, the relevant `docs/` page, its `wiki/` mirror when one exists, and AI context in the same pull request.
