# Database-First and Full Recovery

> **Status in alpha.80:** RoomGoblin supports a passphrase-encrypted,
> authenticated, one-export/one-import full recovery on the reviewed Ubuntu
> Server 24.04 LTS `amd64` appliance profile.

## One export, one import

**Full Recovery Export** creates one `.rgbak` containing exactly the
non-regenerable RoomGoblin state needed by a compatible clean installation:

- the SQLite-safe snapshot of the configured active database;
- the matching external master encryption key;
- uploaded media, presentations and required application assets;
- Android/Google TV inventory, ADB trust keys and Android signing identity;
- allowlisted persistent state for supported RoomGoblin-owned services;
- bounded native Veyon recovery identity; and
- a versioned manifest and exact file inventory.

Source code, Docker images/layers, caches, logs, nested backups, arbitrary host
files and host network configuration are excluded. Android inventory remains in
the compatibility file `data/android-tv/devices.json` in alpha.80, but it is
covered automatically and restores stable IDs/assignments without re-pairing.

Export briefly quiesces running add-ons only when their RoomGoblin ownership
marker and pinned image both match, then restarts them in dependency-safe order.
Adopted/external services are neither stopped nor copied. A stop/restart failure
fails the export and removes the incomplete bundle.

## `.rgbak` security

The envelope uses AES-256-GCM with a scrypt-derived key
(`N=32768`, `r=8`, `p=1`), a random 16-byte salt and 12-byte nonce, and a
canonical authenticated header. The inner allowlisted manifest also verifies
every file by SHA-256 before host mutation.

Passphrases must contain at least 16 characters and no more than 1024 UTF-8
bytes. They are not persisted or logged. Losing the passphrase makes the export
unrecoverable, so keep it separately from the `.rgbak`. The browser may submit
a recovery passphrase only over loopback or HTTPS terminated by a same-host
loopback reverse proxy;
RoomGoblin's temporary direct-HTTP LAN mode is not safe for this operation.
For HTTPS, configure the exact `TRUST_PROXY_HOPS` count and firewall direct
client access to port 3000 so forwarded transport headers cannot be spoofed.

The buffered payload limit is 256 MiB by default and 512 MiB absolutely. Ensure
the target data and host-backup filesystems have room for staging, the imported
state and a complete pre-restore safety snapshot.

## Host transaction and rollback

Maintenance authenticates the envelope and stages allowlisted content beneath
`/host-backups/recovery-staging` (`${HOST_BACKUP_DIR}/recovery-staging` on the
host). The native Host Agent:

1. acquires `/run/classroom-control-hub-appliance-mutation.lock` so update and
   recovery cannot overlap;
2. writes a durable journal beneath `/var/lib/classroom-hub/full-recovery`;
3. snapshots every state root the transaction can change;
4. quiesces affected RoomGoblin and bounded Veyon services;
5. commits the database/master-key, assets, ADB/signing identities and supported
   service state with fixed host-owned paths, permissions and ownership;
6. recreates/restarts the installed RoomGoblin release as required;
7. verifies SQLite integrity/schema/readiness, every encrypted `secret_store`
   row, application/scheduler/maintenance/Host Agent/version health, assets and
   managed-device recovery; and
8. rolls every changed root back from the safety snapshot if commit,
   verification or interrupted-transaction recovery fails.

Do not remove staging, journal or safety-snapshot data while a recovery is
active or failed.

## Service ownership

RoomGoblin recreates a Docker add-on only when saved
`deploymentOwnership` is `roomgoblin` and its image matches the fixed reviewed
service identity. It never replaces an adopted/external service. A same-name,
ownership or image collision fails closed for operator review. A
RoomGoblin-owned service that was stopped at export remains stopped after
restore.

Native Veyon recovery is restricted to the reviewed
`VEYON_RECOVERY_ROOT=/veyon-recovery` mount. Recovery does not create a generic
root filesystem-write API.

ADB private/public keys and the named
`classroom-control-hub-android-adb` volume are one identity and must remain
writable after recreation. Android keystore/password and SQLite database/master
key are likewise indivisible pairs. RoomGoblin must not generate a replacement
identity and report recovery success.

Export snapshots the application-reported active SQLite file, including a
historical/custom source filename. On the clean host, recovery retains fresh
host-specific `.env` values but normalizes the restored database and
`DATABASE_FILE` to `/app/data/classroom-control-hub.db`. It does not copy stale
source-host listener, token, network or root-path settings.

## Clean-host recovery drill

On an isolated compatible host:

1. install the compatible RoomGoblin release and establish administrator access;
2. use loopback or HTTPS through the same-host proxy to import the one `.rgbak`
   and enter its separately stored passphrase;
3. review the restore plan and start Full Recovery;
4. verify login/site identity, database integrity and encrypted integrations;
5. verify schedules, displays, automations/scenes, Morning Announcements
   priority and post-release resync, and Background Music reconciliation;
6. verify assets, Android inventory/agent state and previously paired devices
   without re-pairing, lab/Veyon state, and owned service running/stopped state;
7. confirm adopted/external services were not replaced and all component
   versions converge; and
8. test wrong passphrases, corrupted/truncated/oversized bundles, collisions,
   insufficient space, injected phase failures and interruption/restart rollback
   in a disposable environment.

Keep the source appliance and older off-host exports until the restored system
passes the drill. A bundle that has never been test-imported is not a verified
disaster-recovery plan.

Import validates envelope, v6 manifest, release-major and schema compatibility.
The clean-host installer separately enforces the supported Ubuntu `amd64` host
profile; architecture is not stored as a portable v6 manifest field.

## Persistence rule for future work

Application-owned durable configuration should be SQLite-authoritative whenever
practical. Large/non-regenerable files and external-service data may remain on
disk, but every such path must be explicitly classified, added to the Full
Recovery allowlist/manifest, and covered by recovery tests. Environment values
may bootstrap or migrate a setting; they must not overwrite an established
database value.

See `docs/DATABASE-FIRST-RECOVERY.md` in the repository for the complete
technical contract and acceptance matrix.
