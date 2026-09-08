# GitHub Copilot Instructions

Read `/AGENTS.md` before making changes. Use `/docs/AI-CONTEXT.md` for the current technical/operational model, `/docs/DISPLAY-ACCESS.md` for the classroom display access contract, `/docs/AUTOMATION-DISPLAY-MEDIA.md` for automation media/class-target behavior, and `/docs/VEYON-MUSIC-INTEGRATIONS.md` for the Veyon/Music Assistant contract.

Key rules:

- `VERSION` and `CHANGELOG.md` define the current release state.
- Standard production checkout: `/opt/classroom-hub`.
- Preserve runtime `.env`, `data/`, databases, uploads, backups, keys, and secrets during upgrades.
- Never hardcode or commit production IPs, credentials, tokens, stream IDs, school-specific calendars, or private URLs.
- Keep backend/controller/display/maintenance/host-agent version strings converged for every release.
- Classroom display receivers use stable direct URLs `/display/<id>` on the trusted classroom/admin network. An enabled configured display ID is sufficient; do not require display enrollment links, per-browser display credentials, or the legacy shared `DISPLAY_TOKEN` for normal display access.
- Unknown or disabled display IDs must still be rejected. Controller/user authentication and Windows lab-agent enrollment remain credentialed and must not be weakened when changing display access.
- Display credential/enrollment database tables may remain for schema/rollback compatibility, but they are legacy state rather than runtime authority.
- Direct displays still use short-lived signed, device-bound asset tokens for protected `/media/*` and `/presentations/*` requests. Do not gate those signed tokens on the retired display-enrollment policy.
- A successful automation result does not prove media rendered; tests for display media must verify the receiver can fetch and render the protected asset.
- `Use class default display targets` is persisted independently of the primary action domain. Do not silently clear it just because an event starts with lighting or another non-display action.
- Morning Announcements are highest priority. When they end, re-evaluate and re-trigger the currently applicable winning display automations before Background Music resumes; do not restore stale snapshots.
- Timer chaining is only for the matching Bison continuation of the same base period.
- Integration health must be independent. A Pluto failure must not falsely mark MQTT/Govee offline.
- Optional or slow hardware probes must not block initial Overview rendering.
- Veyon computer inventory and Hub-side Veyon configuration are database-authoritative. `veyon-computers.json` is migration input only; do not reintroduce it as runtime state.
- Native `veyon.service` / `veyon-webapi.service` are host-managed but remain fully configurable from Classroom Control Hub. Do not deploy the obsolete Veyon proxy when native services exist.
- Veyon control authentication uses the Veyon key pair. Domain credentials and SSH keys, when configured, are optional endpoint-deployment credentials and must not be described as Veyon control authentication.
- Veyon private keys and endpoint deployment secrets must be encrypted in SQLite. Native Veyon filesystem keys are derived/imported runtime material, not Hub configuration authority.
- Music Assistant is not ready merely because its container is running. A valid long-lived token is mandatory; Save & Verify must fail on missing/rejected credentials and the token must remain encrypted/database-backed.
- Do not treat Veyon WebAPI `GET /` returning HTTP 404 as proof of successful Veyon authentication/control. Use computer/authentication status for operational validation.
- Update the relevant `docs/` and `wiki/` mirror pages when behavior or operations change.
- Run the validation steps in `.github/workflows/validate.yml` before release and do not claim tests that were not actually run.
