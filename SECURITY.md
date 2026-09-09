# Security Policy

## Host-network deployment contract

The Linux Hub and maintenance containers, plus reviewed managed add-on templates, now use host networking. Maintenance is loopback-only; custom ports are actual listeners. Preserve explicit bind addresses, persistent mounts and secrets, and never silently recreate adopted containers. See [Host networking and migration](docs/HOST-NETWORKING.md) for preflight, port inventory, compatibility, acceptance tests and rollback. Do not reintroduce Docker service DNS or port-publishing assumptions.

Classroom Control Hub can control real classroom displays, AV equipment, lighting, media, and lab infrastructure. Treat every deployment as an administrative system.

## Do not commit secrets

Never commit:

- `.env`
- production databases
- API tokens or passwords
- MQTT credentials
- private keys or certificates
- recovery backups
- real site-specific secret configuration

## Recommended deployment

- Place the controller behind HTTPS.
- Enable the built-in authentication/access controls or an authenticated reverse proxy/Zero Trust layer.
- Use a strong `MAINTENANCE_TOKEN`.
- Keep the maintenance API unexposed to the public network.
- Keep the host agent on its local Unix socket.
- Do not mount the Docker socket into web-facing containers. Maintenance Docker requests cross the local Host Agent and its operation/container/image allowlist.
- Back up the database and encryption master key separately and securely.

## Classroom display credentials

Provision each receiver with a one-time enrollment link from the controller.
Each display receives its own revocable credential; the database stores only
its SHA-256 hash. Disable the legacy shared `DISPLAY_TOKEN` after all enabled
displays are enrolled. Raw display credentials and enrollment codes must not
appear in logs, diagnostics, database records, or administrative read APIs.

## Classroom computer agents and student data

Enroll every Windows classroom computer with a one-time GUI-generated command.
Each computer receives a revocable credential whose raw value is DPAPI-protected
locally and stored only as a hash in the Hub database. Disable the legacy shared
lab-agent token after migration. If Authenticode enforcement is configured, the
installer and self-update path reject scripts not signed by the selected publisher.

Browser history, screenshots, Veyon framebuffers, and monitoring alerts require
the `lab.sensitive.read` capability. Configure the retention periods under
**Settings → Student Data Retention** and apply the shortest policy appropriate
for the school. Do not include student information in diagnostic bundles or
public issue reports.

## Reporting vulnerabilities

Do not publish credentials, exploit details against a live school network, or student information in public issues. Use a private contact method with the repository owner for sensitive reports.

### Maintenance mutation boundary

Authenticated maintenance mutations share an appliance-wide limit of 30 requests per 60 seconds, enforced after token authentication and before both legacy and extension-wrapped routes. Excess writes return HTTP 429 with a Retry-After header; GET/HEAD/OPTIONS polling and health checks do not consume this budget. Forwarding headers cannot create new budgets. The counter is in memory and resets on a maintenance process restart.
