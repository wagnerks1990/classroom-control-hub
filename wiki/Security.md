# Security

See [Host Networking](Host-Networking) for the current Linux container topology, loopback-only maintenance API, explicit add-on migration, listener ports and recovery rules.

RoomGoblin controls real classroom infrastructure and should be treated as an administrative system.

## Core principles

- Keep production secrets out of Git.
- Avoid privileged containers when a narrow host agent can perform the required operation.
- Restrict controller access to trusted users/networks.
- Require authentication and authorization for write-capable APIs.
- Keep logs and diagnostics free of credentials.
- Back up production state securely.
- Treat the current HTTP-only transport as temporary and network-restricted.

## Current HTTP-only boundary

The current appliance intentionally exposes RoomGoblin directly over HTTP on TCP/3000 while HTTPS/TLS is redesigned. Caddy is not part of the current deployment.

Default network settings:

```text
HUB_BIND_ADDRESS=0.0.0.0
HUB_PORT=3000
TRUST_PROXY_HOPS=0
```

Because HTTP does not encrypt credentials or session traffic, the appliance must be limited to a trusted classroom/admin LAN or equivalent protected management segment. Do not port-forward TCP/3000 to the Internet and do not expose it to an untrusted guest/student wireless network.

Use host/network firewall rules to limit access to expected management subnets. Keep the maintenance service private inside Docker and keep the Host Agent reachable only through its local Unix socket.

HTTPS should return later as a separately reviewed feature with certificate trust, DNS/SNI, migration, proxy-trust, cold-start, and rollback coverage. Do not restore Caddy ad hoc on individual appliances.

## Windows lab-agent transport

Windows agent enrollment over HTTP requires the explicit `-AllowHttp` switch. This acknowledgement must remain while the Hub is HTTP-only because the enrollment exchange is otherwise unencrypted.

Use `-AllowHttp` only on a trusted, isolated classroom/admin network. When HTTPS/WSS returns, normal enrollment should no longer require this acknowledgement.

## Secrets

Use runtime environment variables, mounted secret files, or encrypted application storage for passwords, API tokens, MQTT credentials, Music Assistant tokens, private keys, and other sensitive values.

Never commit `.env`, production databases, backups, SSH keys, or certificate/private-key material.

`MAINTENANCE_TOKEN` must remain non-empty and synchronized between the native Host Agent, main application, and maintenance service. Troubleshooting should compare token presence/length rather than printing the secret.

The master encryption key is stored at:

```text
/etc/classroom-control-hub/master.key
```

Upgrades from the older `/etc/classroom-hub/master.key` location must preserve the existing key rather than silently rotating it.

## Display credentials

Provision each classroom display with a one-time enrollment link from the controller. The resulting credential is unique, revocable, bound to a stable display ID, and stored locally by that receiver. Enrollment links expire and cannot be reused. The database stores only SHA-256 hashes, and administration APIs expose metadata rather than raw tokens. Disable the legacy shared display token after migration coverage is complete.

## Host privileges

The main application should not receive unrestricted access to the Docker socket or host filesystem merely for convenience. Host-level actions belong in the Host Agent with a narrow authenticated API and explicit allowlist of operations.

The shared application data root intentionally uses `root:10001` ownership so the non-root app and hardened maintenance container can both traverse it without allowing the app to lock maintenance out by changing the shared root to mode `0700`.

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

A successful update must verify direct HTTP backend health, database/scheduler readiness, maintenance health, Host Agent health, and version convergence. TLS/Caddy is intentionally not a current release gate.

## Reporting

Security concerns should be reported without posting live credentials, student information, or exploitable production details in a public GitHub issue. The repository `SECURITY.md` contains the current public reporting policy.
