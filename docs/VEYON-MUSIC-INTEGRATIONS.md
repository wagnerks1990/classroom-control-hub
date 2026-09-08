# Veyon and Music Assistant Integration Contract

This document defines the supported appliance architecture for Veyon classroom workstation control and Music Assistant classroom audio.

## Ownership model

Classroom Control Hub separates **service lifecycle ownership** from **application configuration ownership**.

### Veyon

`veyon.service` and `veyon-webapi.service` are native Ubuntu/systemd services. Classroom Control Hub discovers and monitors them through the Host Agent. The Hub must not deploy a second Veyon WebAPI container when the native service exists, and it must not remove or recreate the native services from a managed-integration action.

The Hub still owns the Veyon application configuration used by Classroom Control Hub. A host-managed service is therefore **configurable**, not monitor-only.

### Music Assistant

Music Assistant normally runs as `music-assistant-server` with host networking so local player discovery works. Classroom Control Hub may deploy or adopt that container, but container presence alone does not mean the integration is ready.

A valid long-lived Music Assistant access token is mandatory before the Hub reports Music Assistant as operational.

## Database authority

The SQLite database is the Classroom Control Hub source of truth.

### Veyon computers

The Veyon workstation inventory is stored through the database-backed `veyon-computers` namespace. Records include, as applicable:

- stable computer ID;
- IP address;
- hostname;
- display name;
- `teacher` or `student` role;
- discovery timestamps;
- last-known online/authentication information and related metadata.

Legacy `data/veyon-computers.json` is migration input only. Startup recovery merges it into the SQLite namespace, verifies the record count, records the migration, and removes the active legacy file. Production runs with `LEGACY_JSON_MIRROR=false`, so subsequent writes remain database-only.

### Veyon authentication material

The Veyon private authentication key is stored encrypted in `secret_store` under `veyon.private-key`. The Veyon public key and non-secret deployment metadata may be stored as managed-integration configuration.

Native Veyon may need operating-system key files to run. Those files are derived/imported runtime material, not the Hub's authoritative configuration. During upgrade compatibility, an existing host key file may be mounted long enough for the application to import it into the encrypted database secret store.

### Optional endpoint deployment credentials

Windows/domain and Linux/SSH credentials are separate from Veyon's normal control authentication. They are optional credentials for installing/configuring Veyon on endpoints.

Supported configuration concepts include:

- Windows domain/workgroup;
- Windows deployment username;
- encrypted Windows deployment password;
- Linux SSH username;
- encrypted SSH private key;
- encrypted SSH key passphrase.

Do not describe domain credentials or SSH keys as Veyon control authentication. Veyon control uses the Veyon authentication key pair.

### Music Assistant credentials

The Music Assistant long-lived token is stored encrypted in SQLite as `musicassistant.token`. The browser never receives the stored token. A blank token field preserves an existing stored token unless an explicit clear operation is implemented.

## Veyon required configuration

The guided configuration surface should expose:

- WebAPI URL, normally `http://host.docker.internal:11080` from containers;
- authentication key name;
- private key import/replacement;
- public key metadata for endpoint deployment;
- optional subnet scan prefix and start/end range;
- connection-pool maximum;
- authentication retry limit;
- thumbnail concurrency;
- optional Windows/domain endpoint-deployment credentials;
- optional Linux/SSH endpoint-deployment credentials.

Existing database computers do not require a new subnet scan. A blank scan subnet is valid when the inventory is already populated.

## Veyon health model

Do not treat an HTTP response from `/` as proof that Veyon control works. Current native Veyon WebAPI correctly returns `404 Invalid command or non-matching HTTP method` for an unsupported root request.

Health should distinguish:

1. native service installed/running;
2. WebAPI network reachable;
3. Veyon authentication key configured;
4. number of database computers;
5. number of TCP-reachable computers;
6. number of successfully authenticated Veyon computers;
7. command/control errors.

The managed-integration save path performs a real computer/status probe after applying Veyon settings and reports total, online, and authenticated counts. A zero-sized connection cache by itself is not a failure; cached Veyon connections are opened on demand and expire when idle.

## Music Assistant setup flow

Music Assistant uses a two-phase setup when the server is not already installed:

1. deploy/adopt the Music Assistant server;
2. open the Music Assistant UI and complete its own first-run setup;
3. in Music Assistant, go to **Settings → Profile → Long-lived access tokens** and create a token for Classroom Control Hub;
4. return to Classroom Control Hub, enter the token, and choose **Save & Verify**;
5. Classroom Control Hub stores the token encrypted and performs an authenticated API check;
6. only after authentication succeeds is Music Assistant considered ready.

The setup/controller card includes an **Open Music Assistant** action. When the container-facing URL uses `host.docker.internal`, the browser link substitutes the current Hub hostname so an administrator can open port 8095 from the workstation browser.

## Music Assistant API validation

Every Music Assistant API request requires:

```text
Authorization: Bearer <long-lived-token>
```

Classroom Control Hub uses the Music Assistant API at `/api` and the existing authenticated command path. A stored token that receives an authentication error must leave the integration in `authentication-required` / setup-required state rather than reporting success.

Container state and API state are separate concepts:

- `installed/running`: the Music Assistant process/container exists;
- `configured`: a token is stored;
- `online/ready`: an authenticated API request succeeds.

## Security boundaries

- Integration secrets are written by the main application, not directly by the maintenance container.
- The maintenance agent uses token-bound internal routes that mirror the existing database-backed application handlers.
- Internal maintenance routes must never be exposed without `MAINTENANCE_TOKEN` validation.
- Secret values must not be included in audit payloads, diagnostics, module responses, or browser-visible configuration.
- Host-managed Veyon lifecycle controls must remain blocked even though configuration controls are available.

## Upgrade verification

After an upgrade, verify at minimum:

```bash
systemctl status veyon.service veyon-webapi.service --no-pager
ss -lntp | grep -E '11080|11100'
docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

In the UI verify:

- Veyon shows host-managed and exposes configuration;
- the existing Veyon computer count is preserved after legacy JSON migration;
- Veyon reports authenticated computers when reachable clients are available;
- Music Assistant shows setup-required until a valid token is saved;
- **Open Music Assistant** opens the appliance Music Assistant UI;
- invalid/missing Music Assistant tokens fail Save & Verify instead of silently succeeding.
