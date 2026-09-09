# Image source permissions and restart-loop recovery

## Incident and scope

A Linux host-network migration built both images, started maintenance successfully, and then left the Hub restarting with `EACCES: permission denied, open '/app/src/server.js'`. Both containers reported `network=host`; this particular failure was source access, not network connectivity, MQTT, or database integrity. The installer subsequently failed to execute its health-URL lookup inside the restarting container before printing its final completion message.

The Hub intentionally runs as UID/GID `10001:10001`. Docker local-context COPY preserves source modes. A root-edited or restored source file with mode `0600`, or source directory with mode `0700`, can therefore become inaccessible to the application inside an image. The incident log confirms denied access, not the exact originating host mode; inspect metadata before assigning the cause to a particular editor, backup command or umask. Changing the shell umask later does not repair existing modes or an already-built image.

## Permanent build contract

The main Dockerfile now normalizes only its packaged non-secret application trees (`src`, `public`, stock `config`, and build/check `tools`) to root-owned directories `0755` and regular files `0644`, plus readable package metadata and VERSION. This occurs inside the build, after bundling/stamping and before switching to UID 10001. It does not recursively alter `/app`, dependency executables, host source files, data, backups, `.env`, or mounted keys.

`tools/verify-image-permissions.js` runs during the build as UID/GID 10001, opens packaged files, and rejects wrong ownership/modes and unexpected symlinks. A bad image fails before the installer reaches container recreation. The checker can also run with no network, a read-only root, all capabilities dropped and no runtime mounts. The application is not granted root or ownership of its own source.

The stock configuration in the image is not the same as the separately bind-mounted live `config` directory. Build-time normalization cannot repair permissions of runtime bind mounts or custom overrides that mask `/app/src`; inspect those separately if image verification succeeds but a deployed container still cannot read code.

The installer marker `/.classroom-hub-installation` is now ignored by the repository. Keep it; it is not a local source modification. Existing `.git/info/exclude` entries for this exact marker are harmless and need not be removed.

## Recovery

Retain existing migration/source backups. Do not delete either database, regenerate an existing encryption key, grant root to the Hub, disable read-only mode, or run `chmod -R 777` / a recursive permission change over the installation root. Do not bulk-recreate add-ons while the core Hub is unhealthy.

Review `git status --short`, preserve actual source edits, and update a clean `main` checkout with the approved fix. Build the Hub image from the corrected Dockerfile. A simple container restart or a pull of an older registry tag does not fix the copied source layer. Recreate from the locally built image using the current Compose definition; retain the normal mounts, UID, host networking and security options. Rerun the supported installer to converge both services and native Host Agent when the source update also includes service changes.

Before changing source permissions manually, metadata-only checks are sufficient:

```bash
stat -c '%a %u:%g %n' src src/server.js
image_id="$(docker inspect -f '{{.Image}}' classroom-control-hub)"
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user 0:0 --entrypoint stat "$image_id" \
  -c '%a %u:%g %n' /app/src /app/src/server.js
```

The second command uses root only in a disposable, network-disabled, mount-free diagnostic container to inspect metadata, never to run the live Hub. Do not paste a full `docker inspect` environment dump; it may contain secrets.

After rebuilding with this fix, test the built image without runtime data:

```bash
docker compose run --rm --no-deps -T --interactive=false --entrypoint node \
  classroom-hub tools/verify-image-permissions.js
```

This Compose one-off inherits runtime mounts; the script reads only packaged paths and does not start the application or change runtime data. Failure involving mounted stock config can indicate a separate host bind-mount permission problem. A plain `docker run` against the built image with no mounts isolates image content instead.

## Acceptance and testing

Verify both core containers report `network=host`, the Hub is healthy and its restart counter stops increasing, its `/health` reports `ok: true` and the expected VERSION, maintenance stays healthy and loopback-only, and the native Host Agent is active. Then verify a controller page and display connection. A successful build alone is not live health, and maintenance readiness does not prove the Hub is running.

`test/image-permissions.test.js` guards ordering, explicit modes, symlink rejection, ownership policy and the installer marker. `.github/workflows/image-permissions.yml` creates a separate Git archive context, deliberately sets copied source/assets to `0600` and directories to `0700`, builds the real Dockerfile, verifies access as UID 10001, and runs the existing host-network HTTP/authentication smoke test using that image. No live accounts, keys, database or devices are used; the smoke test uses a fake native Host Agent fixture. See the PR's actual CI results for executed evidence; live classroom acceptance remains separate.

## AI/contributor guardrails

Never interpret an `EACCES` opening source as a reason to loosen secret permissions or run the production Hub as root. Do not assume fresh Git checkouts represent permissions on long-lived, root-edited appliances. Keep default and restrictive-context tests, the non-root build check, operational documentation and wiki mirror together when changing COPY/build/runtime identity. Preserve the host-group prerequisite and host-network migration contracts.

References: Dockerfile COPY and USER documentation at https://docs.docker.com/reference/dockerfile/ and the current deployment contract in `docs/HOST-NETWORKING.md`.
