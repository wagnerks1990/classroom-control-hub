# RoomGoblin brand and compatibility

RoomGoblin is the current product identity for the Classroom & Lab Management Hub.

**Tagline:** *Run the room. Manage the lab.*

## Brand defaults

The built-in interface uses Goblin Teal `#0F766E`, Electric Green `#22C55E`, Slate Navy `#1E293B`, Learning Amber `#F59E0B`, Cloud Gray `#E5E7EB`, and Mint Glow `#D1FAE5`. Poppins is preferred for headings and Inter for body copy, with system-font fallbacks.

Canonical runtime assets are stored in `public/brand/`. Full rules are maintained in `docs/brand/BRAND-GUIDE.md` and `docs/brand/AI-BRAND-CONTEXT.md`.

## Android app transition

Starting with `1.0.0-alpha.77`, the RoomGoblin Display Agent uses `org.roomgoblin.display`. If `org.classroomhub.display` is installed, uninstall the old Android app and install the new RoomGoblin version instead of attempting an in-place update. Android treats the two package IDs as separate apps.

The managed installer removes only the old app package, installs RoomGoblin, retains the server-side device enrollment and ADB trust, and reapplies saved configuration and supported grants. Device Administrator and Accessibility approval may need to be confirmed again on the TV.

## Why old names still appear internally

RoomGoblin is a compatibility-safe rebrand. Existing installations already depend on legacy paths and identifiers such as `/opt/classroom-hub`, `CLASSROOM_HUB_*`, `org.roomgoblin.display`, `classroom-control-hub*` service/container/image names, and persisted enrollment/storage identifiers.

Those are not the product's current name. They remain intentionally stable so an upgrade does not break installed appliances or managed endpoints.

Do not perform a repository-wide search-and-replace. A future migration of an internal identifier must include an upgrade path, rollback path, and validation of data, authentication, displays, Android/Google TV enrollment, Windows lab agents, updater, and backup/recovery behavior.

## Fresh-install behavior

Fresh installations should present **RoomGoblin** by default. Sites can still customize school identity, portal name, logo, favicon, and theme. Existing sites that retained the former built-in product defaults are promoted to RoomGoblin; deliberate custom branding should remain unchanged.

## Operational invariants

The rebrand must not change the current deployment architecture, database identity, managed-device IDs, Android package identity, ADB trust, API contracts, or updater/rollback expectations merely for naming consistency.

See `docs/ROOMGOBLIN-REBRAND.md` for the authoritative migration and audit policy.
