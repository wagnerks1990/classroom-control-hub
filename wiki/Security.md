# Security

Classroom Control Hub controls real classroom infrastructure and should be treated as an administrative system.

## Core principles

- Keep production secrets out of Git.
- Avoid privileged containers when a narrow host agent can perform the required operation.
- Restrict controller access to trusted users/networks.
- Require authentication and authorization for write-capable APIs.
- Keep logs and diagnostics free of credentials.
- Back up production state securely.

## Secrets

Use runtime environment variables, Docker secrets, or another secrets manager for passwords, API tokens, MQTT credentials, Music Assistant tokens, private keys, and other sensitive values.

Never commit `.env`, production databases, backups, SSH keys, or certificate private keys.

## Network exposure

The controller should normally be reachable only through a trusted management network or authenticated reverse proxy. WebSocket forwarding must be supported, but broad public exposure is not required for ordinary classroom use.

## Display credentials

Provision each classroom display with a one-time enrollment link from the
controller. The resulting credential is unique, revocable, bound to a stable
display ID, and stored locally by that receiver. Enrollment links expire and
cannot be reused. The database stores only SHA-256 hashes, and administration
APIs expose metadata rather than raw tokens. Disable the legacy shared display
token after migration coverage is complete.

## Host privileges

The main application should not receive unrestricted access to the Docker socket or host filesystem merely for convenience. Host-level actions belong in the host agent with a narrow authenticated API and explicit allowlist of operations.

## Public repository sanitization

Before publishing production-derived code, review for:

- credentials and tokens
- internal IP addresses and topology
- private DNS names
- student/user information
- room-specific device secrets
- private certificates/keys
- production database contents
- diagnostic bundles and backups

Some infrastructure identifiers may not be secret by themselves, but they should still be externalized when they are deployment-specific and unnecessary for the generic project.

## Updates

Review dependency and container-image updates before production rollout. Validate the new build against a copy of persistent state and preserve a rollback path.

## Reporting

Security concerns should be reported without posting live credentials, student information, or exploitable production details in a public GitHub issue. The repository `SECURITY.md` contains the current public reporting policy.
