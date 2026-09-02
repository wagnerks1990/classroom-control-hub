# Security Policy

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
- Restrict Docker socket and host filesystem access to the maintenance component only.
- Back up the database and encryption master key separately and securely.

## Reporting vulnerabilities

Do not publish credentials, exploit details against a live school network, or student information in public issues. Use a private contact method with the repository owner for sensitive reports.
