# GitHub Copilot Instructions

Read `/AGENTS.md` before making changes. Use `/docs/AI-CONTEXT.md` for the current technical/operational model.

Key rules:

- `VERSION` and `CHANGELOG.md` define the current release state.
- Standard production checkout: `/opt/classroom-hub`.
- Preserve runtime `.env`, `data/`, databases, uploads, backups, keys, and secrets during upgrades.
- Never hardcode or commit production IPs, credentials, tokens, stream IDs, school-specific calendars, or private URLs.
- Keep backend/controller/display/maintenance/host-agent version strings converged for every release.
- Morning Announcements are highest priority. When they end, re-evaluate and re-trigger the currently applicable winning display automations before Background Music resumes; do not restore stale snapshots.
- Timer chaining is only for the matching Bison continuation of the same base period.
- Integration health must be independent. A Pluto failure must not falsely mark MQTT/Govee offline.
- Optional or slow hardware probes must not block initial Overview rendering.
- Update the relevant `docs/` and `wiki/` mirror pages when behavior or operations change.
- Run the validation steps in `.github/workflows/validate.yml` before release and do not claim tests that were not actually run.
