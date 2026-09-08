# Veyon and Music Assistant Integration Contract

This document defines the supported appliance architecture for Veyon classroom workstation control and Music Assistant classroom audio.

## Ownership model

Classroom Control Hub separates **service lifecycle ownership** from **application configuration ownership**.

### Veyon

`veyon.service` and `veyon-webapi.service` are native Ubuntu/systemd services. Classroom Control Hub discovers and monitors them through the Host Agent. The Hub must not deploy a second Veyon WebAPI container when the native service exists, and it must not remove or recreate the native services from a managed-integration action.

The Hub still owns the Veyon application configuration used by Classroom Control Hub. A host-managed service is therefore **configurable**, not monitor-only.

The current appliance profile is standardized on Veyon **key-file authentication** using one matching key pair named `master`. The native private and public keys must share the same Veyon Pair ID. The Host Agent synchronizes `master/private` and `master/public` into `/etc/classroom-control-hub/veyon/` before startup when native Veyon is present. The main application imports the private key into the encrypted SQLite secret store.

Veyon also supports logon/username-password authentication in other deployments. That alternative must not be presented as active unless the backend authentication path is implemented and validated for it. Linux SSH credentials are not Veyon control credentials; they are endpoint-administration/deployment credentials.

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

The authoritative Veyon private authentication key is stored encrypted in `secret_store` under `veyon.private-key`. The Veyon public key and non-secret deployment metadata may be stored as managed-integration configuration.

For the current appliance, the canonical native key name is `master`. The pre-start key synchronization helper exports the existing native `master/private` key and its matching `master/public` key into the Classroom Control Hub compatibility path. The application then imports the private key into SQLite. Native key files remain required runtime material for Veyon, but they are not the Hub configuration authority after import.

The Hub never silently creates or rotates a Veyon key pair during discovery. Key generation/rotation must be an explicit administrator action because the matching public key must also be distributed to all managed endpoints.

### Optional endpoint deployment credentials

Windows/domain and Linux/SSH credentials can be stored for endpoint installation and administration. In the current key-file authentication profile they are not used for normal Veyon control authentication.

Supported deployment configuration concepts include:

- Windows domain/workgroup;
- Windows deployment username;
- encrypted Windows deployment password;
- Linux SSH username;
- encrypted SSH private key;
- encrypted SSH key passphrase.

If a future release adds Veyon logon authentication, its domain username/password must be stored and modeled separately from deployment credentials so the authentication purpose is unambiguous.

### Music Assistant credentials

The Music Assistant long-lived token is stored encrypted in SQLite as `musicassistant.token`. The browser never receives the stored token. A blank token field preserves an existing stored token unless an explicit clear operation is implemented.

## Veyon required configuration

The guided configuration surface exposes:

- WebAPI URL, normally `http://host.docker.internal:11080` from containers;
- authentication key name, default `master` for this appliance profile;
- private key import/replacement state;
- public key metadata for endpoint deployment;
- optional subnet scan prefix and start/end range;
- connection-pool maximum;
- authentication retry limit;
- thumbnail concurrency;
- optional Windows/domain endpoint-deployment credentials;
- optional Linux/SSH endpoint-deployment credentials.

Existing database computers do not require a new subnet scan. A blank scan subnet is valid when the inventory is already populated.

## Veyon health model

Do not treat an HTTP response from `/` as proof that Veyon control works. Native Veyon WebAPI can correctly return `404 Invalid command or non-matching HTTP method` for an unsupported root request.

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

Every Music Assistant API request requires an authenticated long-lived token. Classroom Control Hub uses the Music Assistant API at `/api` and the existing authenticated command path. A stored token that receives an authentication error must leave the integration in `authentication-required` / setup-required state rather than reporting success.

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
- Veyon key synchronization may read the native Veyon key store and write only the dedicated `/etc/classroom-control-hub/veyon` compatibility path.

## Upgrade verification

After an upgrade, verify at minimum:

```bash
systemctl status veyon.service veyon-webapi.service --no-pager
veyon-cli authkeys list details
ss -lntp | grep -E '11080|11100'
docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

For the standardized key-file profile, `master/private` and `master/public` must show the same Pair ID.

In the UI verify:

- Veyon shows host-managed and exposes configuration;
- the Veyon key name is `master` unless explicitly migrated to another validated pair;
- the existing Veyon computer count is preserved after legacy JSON migration;
- Veyon reports authenticated computers when reachable clients are available;
- Music Assistant shows setup-required until a valid token is saved;
- **Open Music Assistant** opens the appliance Music Assistant UI;
- invalid/missing Music Assistant tokens fail Save & Verify instead of silently succeeding.
