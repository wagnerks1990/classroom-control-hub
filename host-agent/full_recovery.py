#!/usr/bin/env python3
"""Root-owned, journaled full-recovery transaction for RoomGoblin.

The maintenance container authenticates/decrypts and extracts an archive into
the fixed host backup staging tree.  This module independently verifies that
tree, stops every affected workload, snapshots host state, and only then swaps
allowlisted roots.  A durable journal makes an interrupted transaction roll
back when the Host Agent starts again.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shutil
import stat
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

RECOVERY_ID_RE = re.compile(r"^fr-[0-9a-f]{32}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MODE_RE = re.compile(r"^0?[0-7]{3,4}$")
SERVICE_IDS = {"mosquitto", "govee2mqtt", "music-assistant", "nodered"}
SERVICE_DIRS = {
    "mosquitto": "mosquitto",
    "govee2mqtt": "govee2mqtt",
    "music-assistant": "music-assistant",
    "nodered": "nodered",
}
SERVICE_CONTAINERS = {
    "mosquitto": "mosquitto",
    "govee2mqtt": "govee2mqtt",
    "music-assistant": "music-assistant-server",
    "nodered": "nodered",
}
SERVICE_IMAGES = {
    "mosquitto": "eclipse-mosquitto:2.0.22",
    "govee2mqtt": "ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72",
    "music-assistant": "ghcr.io/music-assistant/server:2.9.13",
    "nodered": "nodered/node-red:4.1.14-22",
}
SUPPORTED_SCHEMA_VERSION = 10
VERSION_RE = re.compile(r"^(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")
CORE_CONTAINERS = ("classroom-control-hub", "classroom-control-hub-maintenance")
NATIVE_VEYON = ("veyon-webapi.service", "veyon.service")


def _json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _fsync_dir(path: Path):
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _atomic_json(path: Path, value, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as handle:
        handle.write(_json_bytes(value))
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(tmp, mode)
    os.replace(tmp, path)
    _fsync_dir(path.parent)


def _sha256(path: Path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _tree_bytes(path: Path):
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file() and not item.is_symlink())


def _fsync_tree(path: Path):
    files = [path] if path.is_file() else [item for item in path.rglob("*") if item.is_file()]
    for item in files:
        with open(item, "rb") as handle:
            os.fsync(handle.fileno())
    directories = [path] if path.is_dir() else []
    if path.is_dir(): directories.extend(item for item in path.rglob("*") if item.is_dir())
    for directory in reversed(directories): _fsync_dir(directory)


def _remove_path(path: Path):
    if not os.path.lexists(path): return
    if path.is_symlink() or not path.is_dir(): path.unlink()
    else: shutil.rmtree(path)


class FullRecoveryManager:
    def __init__(self, run, *, hub_root=None, services_root=None, backup_root=None,
                 state_root=None, master_key=None, signing_root=None, veyon_root=None,
                 lock_file=None, app_uid=None, app_gid=None):
        self.run = run
        self.hub_root = Path(hub_root or os.environ.get("CLASSROOM_HUB_DIR", "/opt/classroom-hub")).resolve()
        self.services_root = Path(services_root or os.environ.get("HOST_SERVICES_DIR", "/opt/services")).resolve()
        self.backup_root = Path(backup_root or os.environ.get("HOST_BACKUP_DIR", "/opt/classroom-hub-backups")).resolve()
        self.state_root = Path(state_root or os.environ.get("FULL_RECOVERY_STATE_DIR", "/var/lib/classroom-hub/full-recovery")).resolve()
        self.master_key = Path(master_key or os.environ.get("CLASSROOM_HUB_MASTER_KEY_FILE", "/etc/classroom-control-hub/master.key")).resolve()
        self.signing_root = Path(signing_root or os.environ.get("CLASSROOM_HUB_ANDROID_SIGNING_DIR", "/etc/classroom-control-hub/android-agent-signing")).resolve()
        self.veyon_root = Path(veyon_root or os.environ.get("CLASSROOM_HUB_VEYON_DIR", "/etc/classroom-control-hub/veyon")).resolve()
        self.lock_file = Path(lock_file or os.environ.get("CLASSROOM_HUB_MUTATION_LOCK", "/run/classroom-control-hub-appliance-mutation.lock"))
        self.app_uid = int(app_uid if app_uid is not None else os.environ.get("APP_UID", "10001"))
        self.app_gid = int(app_gid if app_gid is not None else os.environ.get("APP_GID", "10001"))
        self.status_file = self.state_root / "status.json"
        self.journal_file = self.state_root / "journal.json"
        self._guard = threading.Lock()
        self._thread = None
        self._handoff = threading.Event()

    def status(self):
        try:
            value = json.loads(self.status_file.read_text())
        except FileNotFoundError:
            value = {"phase": "idle", "running": False, "ok": None, "message": "No full recovery has been started."}
        except Exception as exc:
            value = {"phase": "failed", "running": False, "ok": False, "message": f"Recovery status is unreadable: {exc}"}
        value["running"] = bool(self._thread and self._thread.is_alive())
        return value

    def _status(self, phase, message, ok=None, **extra):
        value = {"phase": phase, "message": message, "ok": ok, "updatedAt": int(time.time()), **extra}
        value["running"] = phase not in ("completed", "failed", "rolled-back", "rollback-failed")
        _atomic_json(self.status_file, value)
        return value

    def start(self, body):
        if body != {"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": body.get("recoveryId"), "manifestSha256": body.get("manifestSha256")}:
            raise RuntimeError("Full recovery request contains unsupported fields")
        recovery_id = str(body.get("recoveryId") or "")
        manifest_sha = str(body.get("manifestSha256") or "")
        if not RECOVERY_ID_RE.fullmatch(recovery_id):
            raise RuntimeError("Invalid full recovery staging identifier")
        if not SHA256_RE.fullmatch(manifest_sha):
            raise RuntimeError("Invalid full recovery manifest checksum")
        with self._guard:
            if self._thread and self._thread.is_alive():
                raise RuntimeError("A full recovery is already running")
            if self.journal_file.exists():
                raise RuntimeError("An interrupted recovery must be rolled back before another can start")
            # Validate before returning 202 so malformed/missing staging never
            # creates a background job that appears to have started.
            self._validate_staging(recovery_id, manifest_sha)
            self._status("queued", "Full recovery has been queued.", recoveryId=recovery_id)
            self._handoff.clear()
            self._thread = threading.Thread(target=self._worker, args=(recovery_id, manifest_sha), daemon=True)
            self._thread.start()
        return {"ok": True, "started": True, "recoveryId": recovery_id, "job": self.status()}

    def release_handoff(self, recovery_id):
        if self.status().get("recoveryId") != recovery_id:
            raise RuntimeError("Full recovery handoff identifier does not match")
        self._handoff.set()

    def startup_recover(self):
        """Rollback a transaction interrupted after Docker is available."""
        if not self.journal_file.exists():
            return False
        self._status("rollback", "Rolling back an interrupted full recovery.")
        try:
            journal = json.loads(self.journal_file.read_text())
            if journal.get("phase") == "committed":
                self._discard_safety(journal)
                self._cleanup_plaintext(journal.get("recoveryId"))
                self.journal_file.unlink(missing_ok=True)
                _fsync_dir(self.journal_file.parent)
                self._status("completed", "Committed full recovery cleanup completed after restart.", True, recoveryId=journal.get("recoveryId"), reloginRequired=True)
            else:
                self._rollback(journal)
                self._cleanup_plaintext(journal.get("recoveryId"))
                self._status("rolled-back", "Interrupted full recovery was rolled back.", False, recoveryId=journal.get("recoveryId"), rollback={"attempted": True, "ok": True})
        except Exception as exc:
            self._status("rollback-failed", f"Interrupted recovery rollback failed: {exc}", False, recoveryId=(journal.get("recoveryId") if 'journal' in locals() else None), rollback={"attempted": True, "ok": False, "error": str(exc)[:500]})
            raise
        return True

    def _worker(self, recovery_id, manifest_sha):
        if not self._handoff.wait(timeout=30):
            self._cleanup_plaintext(recovery_id)
            self._status("failed", "Full recovery handoff was not acknowledged; no state was changed.", False, recoveryId=recovery_id)
            return
        time.sleep(max(0.0, min(10.0, float(os.environ.get("FULL_RECOVERY_HANDOFF_GRACE_SECONDS", "2")))))
        self.lock_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.lock_file, "a+b") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                self._status("failed", "Another appliance mutation is running.", False, recoveryId=recovery_id)
                return
            try:
                self._execute(recovery_id, manifest_sha)
            except Exception as exc:
                try:
                    if self.journal_file.exists():
                        journal = json.loads(self.journal_file.read_text())
                        if journal.get("phase") == "committed":
                            # The new appliance already passed validation.
                            # Cleanup is retryable at startup; rollback is no
                            # longer safe because safety roots may be partially
                            # discarded.
                            self._status("completed", f"Full recovery committed; deferred cleanup is pending: {exc}", True, recoveryId=recovery_id, cleanupPending=True, reloginRequired=True)
                        else:
                            self._rollback(journal)
                            self._cleanup_plaintext(recovery_id)
                            self._status("rolled-back", f"Full recovery failed and was rolled back: {exc}", False, recoveryId=recovery_id, rollback={"attempted": True, "ok": True})
                    else:
                        self._cleanup_plaintext(recovery_id)
                        self._status("failed", f"Full recovery failed before mutation: {exc}", False, recoveryId=recovery_id)
                except Exception as rollback_exc:
                    self._status("rollback-failed", f"Recovery failed ({exc}); rollback also failed ({rollback_exc}).", False, recoveryId=recovery_id, rollback={"attempted": True, "ok": False, "error": str(rollback_exc)[:500]})

    def _validate_staging(self, recovery_id, expected_sha, *, cryptographic_identity=True):
        stage = self.backup_root / "recovery-staging" / recovery_id
        if not stage.is_dir() or stage.is_symlink():
            raise RuntimeError("Full recovery staging directory is missing or unsafe")
        manifest_path = stage / "backup-manifest.json"
        if not manifest_path.is_file() or manifest_path.is_symlink() or _sha256(manifest_path) != expected_sha:
            raise RuntimeError("Full recovery manifest checksum does not match staged content")
        manifest = json.loads(manifest_path.read_text())
        required = {"version", "scope", "confidentiality", "integrityAlgorithm", "applicationVersion", "databaseSchemaVersion", "files", "topology", "managedServices"}
        if set(manifest) != required:
            raise RuntimeError("Full recovery manifest has unexpected or missing fields")
        if manifest["version"] != 6 or manifest["scope"] != "full" or manifest["confidentiality"] != "scrypt-aes-256-gcm" or manifest["integrityAlgorithm"] != "sha256":
            raise RuntimeError("Unsupported full recovery contract")
        if not isinstance(manifest["databaseSchemaVersion"], int) or manifest["databaseSchemaVersion"] < 1:
            raise RuntimeError("Invalid database schema version")
        if not isinstance(manifest["applicationVersion"], str) or len(manifest["applicationVersion"]) > 100:
            raise RuntimeError("Invalid application version")
        installed = self._installed_version()
        incoming_match, installed_match = VERSION_RE.fullmatch(manifest["applicationVersion"]), VERSION_RE.fullmatch(installed)
        if not incoming_match or not installed_match or incoming_match.group(1) != installed_match.group(1):
            raise RuntimeError("Full recovery application version is incompatible with this installed release")
        if manifest["databaseSchemaVersion"] > SUPPORTED_SCHEMA_VERSION:
            raise RuntimeError("Full recovery database schema is newer than this installed release supports")
        self._validate_tree(stage)
        inventory = {}
        for entry in manifest["files"]:
            if set(entry) != {"path", "role", "size", "sha256", "mode"}:
                raise RuntimeError("Invalid recovery file inventory entry")
            rel = self._safe_rel(entry["path"])
            if rel in inventory:
                raise RuntimeError("Duplicate recovery inventory path")
            path = stage / rel
            if not path.is_file() or path.is_symlink() or entry["size"] != path.stat().st_size or entry["sha256"] != _sha256(path):
                raise RuntimeError(f"Recovery file integrity check failed: {rel}")
            if not isinstance(entry["role"], str) or len(entry["role"]) > 80 or not MODE_RE.fullmatch(str(entry["mode"])):
                raise RuntimeError("Invalid recovery file policy metadata")
            inventory[rel] = entry
        actual = {str(path.relative_to(stage)) for path in stage.rglob("*") if path.is_file()}
        if actual != set(inventory) | {"backup-manifest.json"}:
            raise RuntimeError("Staged recovery files do not exactly match the signed inventory")
        self._validate_topology(manifest, inventory, stage)
        self._validate_services(manifest["managedServices"], inventory)
        self._database_preflight(stage, inventory)
        self._identity_preflight(stage, inventory, cryptographic=cryptographic_identity)
        return stage, manifest

    def _installed_version(self):
        try: return self.hub_root.joinpath("VERSION").read_text().strip()
        except Exception: return ""

    def _identity_preflight(self, stage, inventory, *, cryptographic=True):
        present = set(inventory)
        pairs = (
            ("classroom-hub/data/android-tv/.android/adbkey", "classroom-hub/data/android-tv/.android/adbkey.pub", "ADB trust"),
            ("recovery-secrets/android-agent-signing/android-agent/RoomGoblin-Display-Agent.keystore", "recovery-secrets/android-agent-signing/android-agent/password", "Android signing identity"),
            ("recovery-secrets/veyon/private.pem", "recovery-secrets/veyon/key-name", "Veyon identity"),
        )
        for left, right, label in pairs:
            if (left in present) != (right in present): raise RuntimeError(f"Full recovery contains an incomplete {label} pair")
        if cryptographic and pairs[0][0] in present:
            container_private = f"/host-backups/recovery-staging/{stage.name}/{pairs[0][0]}"
            result = self.run(["docker", "exec", "classroom-control-hub-maintenance", "adb", "pubkey", container_private], 30, False)
            expected_public = (stage / pairs[0][1]).read_text().strip().split()[0]
            observed_public = result.stdout.strip().split()[0] if result.returncode == 0 and result.stdout.strip() else ""
            if not expected_public or observed_public != expected_public:
                raise RuntimeError("ADB private/public trust identity does not match")
        devices = stage / "classroom-hub/data/android-tv/devices.json"
        if devices.is_file():
            try: value = json.loads(devices.read_text())
            except Exception: raise RuntimeError("Managed Android inventory is invalid")
            if isinstance(value, dict) and isinstance(value.get("devices"), list) and value["devices"] and pairs[0][0] not in present:
                raise RuntimeError("Managed Android inventory requires the complete ADB trust pair")

    @staticmethod
    def _safe_rel(value):
        if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
            raise RuntimeError("Invalid recovery path")
        path = Path(value)
        if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
            raise RuntimeError("Recovery path escapes the staging root")
        normalized = path.as_posix()
        if normalized != value:
            raise RuntimeError("Recovery path is not canonical")
        return normalized

    def _validate_tree(self, root):
        for path in [root, *root.rglob("*")]:
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise RuntimeError(f"Symbolic links and special files are forbidden in recovery staging: {path}")

    def _validate_topology(self, manifest, inventory, stage):
        if not isinstance(manifest["topology"], list):
            raise RuntimeError("Recovery topology must be an array")
        seen = set()
        for entry in manifest["topology"]:
            if set(entry) != {"path", "type", "role", "uid", "gid", "mode"}:
                raise RuntimeError("Invalid recovery topology entry")
            rel = self._safe_rel(entry["path"])
            if rel in seen or entry["type"] not in ("file", "directory") or not MODE_RE.fullmatch(str(entry["mode"])):
                raise RuntimeError("Invalid recovery topology")
            if entry["uid"] not in (0, self.app_uid) or entry["gid"] not in (0, self.app_gid):
                raise RuntimeError("Recovery topology requests an untrusted owner")
            self._classify(rel)  # exact path-policy check
            staged = stage / rel
            if not staged.exists() or staged.is_symlink() or (entry["type"] == "file") != staged.is_file() or (entry["type"] == "directory") != staged.is_dir():
                raise RuntimeError(f"Recovery topology type does not match staged content: {rel}")
            expected = self._topology_policy(rel, entry["type"])
            observed = (entry["uid"], entry["gid"], int(str(entry["mode"]), 8))
            if observed != expected:
                raise RuntimeError(f"Recovery topology violates fixed ownership/mode policy: {rel}")
            expected_role = self._expected_role(rel, entry["type"])
            if entry["role"] != expected_role:
                raise RuntimeError(f"Recovery topology has an invalid role: {rel}")
            seen.add(rel)
        for rel in inventory:
            self._classify(rel)
            if rel not in seen:
                raise RuntimeError(f"Recovery topology is missing file: {rel}")
            declared = next(entry for entry in manifest["topology"] if entry["path"] == rel)
            if inventory[rel]["role"] != declared["role"]:
                raise RuntimeError(f"Recovery file role conflicts with topology: {rel}")
        declared_dirs = {entry["path"] for entry in manifest["topology"] if entry["type"] == "directory"}
        actual_dirs = {str(path.relative_to(stage)) for path in stage.rglob("*") if path.is_dir()}
        actual_dirs -= {"classroom-hub"}
        if declared_dirs != actual_dirs:
            raise RuntimeError("Recovery directory topology does not exactly match staged content")

    def _topology_policy(self, rel, entry_type):
        kind = self._classify(rel)
        is_dir = entry_type == "directory"
        if kind == "services-root": return (0, self.app_gid, 0o770)
        if kind == "recovery-root": return (0, self.app_gid, 0o750)
        if kind == "master": return (0, self.app_gid, 0o640)
        if kind == "env": return (0, 0, 0o600)
        if kind == "adb":
            if is_dir: return (self.app_uid, self.app_gid, 0o700)
            return (self.app_uid, self.app_gid, 0o644 if rel.endswith("adbkey.pub") else 0o600)
        if kind == "signing": return (self.app_uid, self.app_gid, 0o700 if is_dir else 0o600)
        if kind == "veyon":
            if is_dir: return (0, self.app_gid, 0o750)
            return (0, 0, 0o644) if rel.endswith("/key-name") else (0, self.app_gid, 0o640)
        if kind == "data":
            if rel == "classroom-hub/data": return (0, self.app_gid, 0o770)
            if rel == "classroom-hub/data/android-tv": return (0, self.app_gid, 0o2770)
            if rel == "classroom-hub/data/android-tv/devices.json": return (0, self.app_gid, 0o660)
        # RoomGoblin-owned application and reviewed service state runs under the
        # non-root appliance identity.
        return (self.app_uid, self.app_gid, 0o770 if is_dir else 0o660)

    def _expected_role(self, rel, entry_type):
        if entry_type == "directory":
            kind = self._classify(rel)
            if kind == "services-root": return "service-state"
            if kind == "recovery-root": return "recovery-secrets"
            if kind == "data" or kind == "adb": return "application-data"
            if kind.startswith("service:"): return "service-state"
            return "recovery-secrets"
        if rel == "classroom-hub/data/classroom-control-hub.db": return "database"
        if rel == "classroom-hub/data/android-tv/devices.json": return "android-inventory"
        if self._classify(rel) == "adb": return "adb-trust"
        if self._classify(rel) == "data": return "application-data"
        if self._classify(rel).startswith("service:"): return "service-state"
        if self._classify(rel) == "master": return "master-key"
        if self._classify(rel) == "signing": return "android-signing"
        if self._classify(rel) == "veyon": return "veyon-identity"
        if self._classify(rel) == "env": return "deployment-env"
        raise RuntimeError(f"Recovery role is outside policy: {rel}")

    def _classify(self, rel):
        if rel == "services": return "services-root"
        if rel == "recovery-secrets": return "recovery-root"
        if rel == "classroom-hub/.env": return "env"
        if rel == "recovery-secrets/classroom-hub-master.key": return "master"
        if rel == "classroom-hub/data" or rel.startswith("classroom-hub/data/"):
            return "adb" if rel == "classroom-hub/data/android-tv/.android" or rel.startswith("classroom-hub/data/android-tv/.android/") else "data"
        if rel == "recovery-secrets/android-agent-signing" or rel.startswith("recovery-secrets/android-agent-signing/"): return "signing"
        if rel == "recovery-secrets/veyon" or rel.startswith("recovery-secrets/veyon/"): return "veyon"
        for service, directory in SERVICE_DIRS.items():
            if rel == f"services/{directory}" or rel.startswith(f"services/{directory}/"): return f"service:{service}"
        raise RuntimeError(f"Recovery path is outside the exact host policy: {rel}")

    def _validate_services(self, services, inventory):
        if not isinstance(services, list):
            raise RuntimeError("Invalid managed-service inventory")
        seen = set()
        for service in services:
            if set(service) != {"id", "container", "image", "enabled", "running", "deploymentOwnership"}:
                raise RuntimeError("Invalid managed-service declaration")
            sid = service["id"]
            if sid not in SERVICE_IDS or sid in seen or service["container"] != SERVICE_CONTAINERS[sid] or service["image"] != SERVICE_IMAGES[sid] or service["deploymentOwnership"] != "roomgoblin":
                raise RuntimeError("Managed-service identity is outside the recovery policy")
            if not isinstance(service["enabled"], bool) or not isinstance(service["running"], bool):
                raise RuntimeError("Managed-service desired state must be boolean")
            if service["running"] and not service["enabled"]:
                raise RuntimeError("A running managed service must be enabled")
            # Prevent a same-name externally owned/adopted container from being
            # silently replaced by restore reconciliation.
            inspected = self.run(["docker", "inspect", service["container"]], 15, False)
            if inspected.returncode == 0:
                try:
                    labels = json.loads(inspected.stdout)[0].get("Config", {}).get("Labels") or {}
                except Exception:
                    raise RuntimeError("Existing managed-service container identity is unreadable")
                image = json.loads(inspected.stdout)[0].get("Config", {}).get("Image")
                if labels.get("org.roomgoblin.deployment-ownership") != "roomgoblin" or image != SERVICE_IMAGES[sid]:
                    raise RuntimeError(f"Container {service['container']} is adopted/external and cannot be replaced")
            seen.add(sid)
        staged = {rel.split("/", 2)[1] for rel in inventory if rel.startswith("services/")}
        declared = {SERVICE_DIRS[sid] for sid in seen}
        undeclared = staged - declared
        if undeclared:
            raise RuntimeError(f"Service state lacks an exact RoomGoblin-owned declaration: {sorted(undeclared)[0]}")

    def _database_preflight(self, stage, inventory):
        # Portable exports always normalize the active snapshot to this stable
        # recovery identity. The host preserves other .env settings but rewrites
        # DATABASE_FILE transactionally, preventing a stale alternate DB after
        # restore.
        rel = "classroom-hub/data/classroom-control-hub.db"
        if rel not in inventory or inventory[rel]["role"] != "database":
            raise RuntimeError("The authoritative DATABASE_FILE is absent from the recovery inventory")
        check = self.run(["sqlite3", str(stage / rel), "PRAGMA quick_check;"], 60, False)
        if check.returncode != 0 or check.stdout.strip() != "ok":
            raise RuntimeError("The staged authoritative database failed PRAGMA quick_check")

    def _execute(self, recovery_id, manifest_sha):
        # Cryptographic identity was verified synchronously before the 202
        # handoff. Rehash here closes handoff races without invoking tooling in
        # the maintenance container twice.
        stage, manifest = self._validate_staging(recovery_id, manifest_sha, cryptographic_identity=False)
        self._status("preflight", "Checking capacity and current appliance state.", recoveryId=recovery_id)
        targets = self._targets(stage, manifest)
        self._capacity_preflight(targets)
        prior = self._capture_desired_state(manifest)
        # Prior desired state must be durable before the first stop. A crash in
        # quiescence can then restore services rather than strand the appliance.
        journal = {"version": 1, "recoveryId": recovery_id, "phase": "quiescing", "targets": [], "prior": prior}
        _atomic_json(self.journal_file, journal)
        try:
            self._status("quiescing", "Stopping affected containers and native services.", recoveryId=recovery_id)
            self._quiesce(manifest, prior)
            # Close the validation-to-use window after the staging producer has
            # handed off and every possible writer is stopped.
            stage, manifest = self._validate_staging(recovery_id, manifest_sha, cryptographic_identity=False)
            journal["phase"] = "snapshot"
            _atomic_json(self.journal_file, journal)
            # Every writer is now verified stopped; safety copies prepared from
            # here form the complete quiesced snapshot.
            for source, target, kind in targets:
                self._prepare_swap(source, target, kind, journal)
                _atomic_json(self.journal_file, journal)
            journal["phase"] = "prepared"
            _atomic_json(self.journal_file, journal)
            for item in journal["targets"]:
                item["activating"] = True
                _atomic_json(self.journal_file, journal)
                self._activate_swap(item)
                item["activated"] = True
                item["activating"] = False
                _atomic_json(self.journal_file, journal)
            journal["phase"] = "activated"
            _atomic_json(self.journal_file, journal)
            self._apply_permissions(manifest)
            self._restart_and_validate(manifest, prior)
            journal["phase"] = "committed"
            _atomic_json(self.journal_file, journal)
            self._cleanup_plaintext(recovery_id)
            self._discard_safety(journal)
            self.journal_file.unlink()
            _fsync_dir(self.journal_file.parent)
            self._status("completed", "Full recovery completed and passed health validation.", True, recoveryId=recovery_id, reloginRequired=True)
        except Exception:
            raise

    def _targets(self, stage, manifest):
        targets = []
        candidates = [
            (stage / "classroom-hub/data", self.hub_root / "data", "data"),
            (stage / "recovery-secrets/classroom-hub-master.key", self.master_key, "master"),
            (stage / "recovery-secrets/android-agent-signing", self.signing_root, "signing"),
            (stage / "recovery-secrets/veyon", self.veyon_root, "veyon"),
        ]
        for sid, directory in SERVICE_DIRS.items():
            candidates.append((stage / "services" / directory, self.services_root / directory, f"service:{sid}"))
        for source, target, kind in candidates:
            if source.exists(): targets.append((source, target, kind))
        targets.append((self._canonical_env_source(), self.hub_root / ".env", "env"))
        if not any(kind == "data" for _, _, kind in targets) or not any(kind == "master" for _, _, kind in targets):
            raise RuntimeError("Recovery staging lacks indispensable data or master-key roots")
        # ADB trust is moved from the portable data tree into the named volume,
        # once Docker can resolve/create its host mountpoint.
        adb_source = stage / "classroom-hub/data/android-tv/.android"
        if adb_source.exists():
            volume = os.environ.get("CLASSROOM_HUB_ADB_VOLUME", "classroom-control-hub-android-adb")
            inspect = self.run(["docker", "volume", "inspect", volume], 20, False)
            if inspect.returncode != 0:
                raise RuntimeError("The installer-managed ADB trust volume is missing; repair the compatible installation before recovery")
            try:
                metadata = json.loads(inspect.stdout)[0]
                labels = metadata.get("Labels") or {}
                mount = Path(metadata["Mountpoint"]).resolve()
            except Exception: raise RuntimeError("Managed ADB volume metadata is unreadable")
            owned = labels.get("org.roomgoblin.deployment-ownership") == "roomgoblin"
            compose_owned = labels.get("com.docker.compose.volume") == "classroom-hub-android-adb" and labels.get("com.docker.compose.project") in ("classroom-hub", "classroom-control-hub", "roomgoblin")
            if not owned and not compose_owned: raise RuntimeError("The canonical ADB volume is not owned by RoomGoblin")
            docker_volumes_root = Path(os.environ.get("DOCKER_VOLUMES_ROOT", "/var/lib/docker/volumes")).resolve()
            exact_mount = mount.name == "_data" and mount.parent.name == volume and mount.parent.parent == docker_volumes_root
            if inspect.returncode != 0 or not mount.is_absolute() or not exact_mount:
                raise RuntimeError("Managed ADB volume mountpoint is unavailable or unsafe")
            if not mount.is_dir() or mount.is_symlink() or not (mount.stat().st_mode & 0o222):
                raise RuntimeError("Managed ADB volume is not a writable safe directory")
            targets.append((adb_source, mount, "adb"))
        return targets

    def _canonical_env_source(self):
        source = self.state_root / f"env-source-{os.getpid()}"
        lines = self.hub_root.joinpath(".env").read_text().splitlines() if self.hub_root.joinpath(".env").is_file() else []
        lines = [line for line in lines if not line.startswith("DATABASE_FILE=")]
        lines.append("DATABASE_FILE=/app/data/classroom-control-hub.db")
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("\n".join(lines) + "\n")
        os.chmod(source, 0o600)
        return source

    def _capacity_preflight(self, targets):
        needed = {}
        for source, target, _ in targets:
            anchor = target.parent
            while not anchor.exists(): anchor = anchor.parent
            device = anchor.stat().st_dev
            needed[device] = needed.get(device, 0) + _tree_bytes(source) + _tree_bytes(target)
            free = shutil.disk_usage(anchor).free
            if free < needed[device] + 64 * 1024 * 1024:
                raise RuntimeError(f"Insufficient free space for atomic recovery near {target}")

    def _capture_desired_state(self, manifest):
        state = {"containers": {}, "native": {}}
        for name in (*CORE_CONTAINERS, *(SERVICE_CONTAINERS[s["id"]] for s in manifest["managedServices"])):
            result = self.run(["docker", "inspect", "--format", "{{.State.Running}}", name], 10, False)
            state["containers"][name] = None if result.returncode != 0 else result.stdout.strip() == "true"
        for unit in NATIVE_VEYON:
            result = self.run(["systemctl", "is-active", unit], 10, False)
            state["native"][unit] = result.returncode == 0 and result.stdout.strip() == "active"
        return state

    def _quiesce(self, manifest, prior):
        names = [*CORE_CONTAINERS, *(SERVICE_CONTAINERS[s["id"]] for s in manifest["managedServices"])]
        for name in dict.fromkeys(names):
            result = self.run(["docker", "stop", "--time", "30", name], 45, False)
            if prior["containers"].get(name) and result.returncode != 0:
                raise RuntimeError(f"Unable to stop recovery writer container: {name}")
            verify = self.run(["docker", "inspect", "--format", "{{.State.Running}}", name], 10, False)
            if verify.returncode == 0 and verify.stdout.strip() != "false":
                raise RuntimeError(f"Recovery writer container is still running: {name}")
        for unit in NATIVE_VEYON:
            result = self.run(["systemctl", "stop", unit], 45, False)
            if prior["native"].get(unit) and result.returncode != 0:
                raise RuntimeError(f"Unable to stop recovery writer service: {unit}")
            verify = self.run(["systemctl", "is-active", unit], 10, False)
            if verify.returncode == 0 and verify.stdout.strip() == "active":
                raise RuntimeError(f"Recovery writer service is still active: {unit}")

    def _prepare_swap(self, source, target, kind, journal):
        target.parent.mkdir(parents=True, exist_ok=True)
        if os.path.lexists(target):
            mode = target.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise RuntimeError(f"Recovery target is a symbolic link or special file: {target}")
        suffix = journal["recoveryId"]
        prepared = target.parent / f".{target.name}.roomgoblin-new-{suffix}"
        safety = target.parent / f".{target.name}.roomgoblin-old-{suffix}"
        for item in (prepared, safety):
            _remove_path(item)
        record = {"target": str(target), "prepared": str(prepared), "safety": str(safety), "existed": os.path.lexists(target), "kind": kind, "activated": False, "preparing": True}
        journal["targets"].append(record)
        _atomic_json(self.journal_file, journal)
        if source.is_dir(): shutil.copytree(source, prepared)
        else: shutil.copy2(source, prepared)
        if kind == "data": _remove_path(prepared / "android-tv/.android")
        _fsync_tree(prepared)
        _fsync_dir(prepared.parent)
        record["preparing"] = False

    def _activate_swap(self, item):
        target, prepared, safety = map(Path, (item["target"], item["prepared"], item["safety"]))
        if os.path.lexists(target): os.replace(target, safety)
        os.replace(prepared, target)
        _fsync_dir(target.parent)

    def _apply_permissions(self, manifest):
        # Ownership/modes are accepted only after topology policy validation.
        for entry in sorted(manifest["topology"], key=lambda x: x["path"].count("/"), reverse=True):
            rel = entry["path"]
            kind = self._classify(rel)
            if kind == "recovery-root": continue
            if kind == "services-root": path = self.services_root
            elif kind == "data": path = self.hub_root / rel.removeprefix("classroom-hub/")
            elif kind == "adb":
                suffix = rel.removeprefix("classroom-hub/data/android-tv/.android").lstrip("/")
                path = self._active_target("adb") / suffix
            elif kind == "env": path = self.hub_root / ".env"
            elif kind == "master": path = self.master_key
            elif kind == "signing": path = self.signing_root / rel.removeprefix("recovery-secrets/android-agent-signing").lstrip("/")
            elif kind == "veyon": path = self.veyon_root / rel.removeprefix("recovery-secrets/veyon").lstrip("/")
            else:
                directory = SERVICE_DIRS[kind.split(":",1)[1]]
                suffix = rel.removeprefix(f"services/{directory}").lstrip("/")
                path = self.services_root / directory / suffix
            if path.exists():
                os.chown(path, entry["uid"], entry["gid"], follow_symlinks=False)
                os.chmod(path, int(str(entry["mode"]), 8), follow_symlinks=False)

    def _active_target(self, kind):
        journal = json.loads(self.journal_file.read_text())
        return Path(next(item["target"] for item in journal["targets"] if item["kind"] == kind))

    def _restart_and_validate(self, manifest, prior=None):
        result = self.run(["docker", "compose", "-f", str(self.hub_root / "docker-compose.yml"), "up", "-d", "--force-recreate", "--remove-orphans", "maintenance-agent", "classroom-hub"], 600, False)
        if result.returncode != 0: raise RuntimeError("Core services failed force-recreation")
        body = {"services": [{"id": s["id"], "enabled": s["enabled"], "running": s["running"]} for s in manifest["managedServices"]]}
        self._http_json("POST", self._maintenance_url("/recovery/reconcile-services"), body)
        for unit, was_running in (prior or {}).get("native", {}).items():
            result = self.run(["systemctl", "start" if was_running else "stop", unit], 60, False)
            if result.returncode != 0 and was_running:
                raise RuntimeError(f"Unable to restore native service state: {unit}")
        expected = self._installed_version()
        deadline = time.time() + int(os.environ.get("RESTORE_HEALTH_TIMEOUT_SECONDS", "120"))
        last = "not ready"
        while time.time() < deadline:
            try:
                runtime = self._http_json("GET", self._main_url("/health"))
                health = self._http_json("GET", self._main_url("/api/v1/internal/maintenance/status"))
                maintenance = self._http_json("GET", self._maintenance_url("/health"))
                checked = health.get("secretDecryption", {}).get("checked")
                secrets = health.get("database", {}).get("secrets")
                schema = health.get("database", {}).get("schemaVersion")
                checks = runtime.get("checks", {})
                adb_ok = self._validate_active_adb(manifest)
                if runtime.get("ok") and runtime.get("version") == expected and maintenance.get("version") == expected and maintenance.get("hostAgent", {}).get("version") == expected and checks.get("database", {}).get("ok") and checks.get("scheduler", {}).get("ok") and health.get("ok") and health.get("secretDecryption", {}).get("ok") and isinstance(checked, int) and checked == secrets and isinstance(schema, int) and manifest["databaseSchemaVersion"] <= schema <= SUPPORTED_SCHEMA_VERSION and adb_ok:
                    return
                last = json.dumps({"runtime":runtime,"database":health,"maintenance":maintenance,"adb":adb_ok})[:500]
            except Exception as exc: last = str(exc)
            time.sleep(2)
        raise RuntimeError(f"Restored application health/secret validation failed: {last}; expected {expected}")

    def _validate_active_adb(self, manifest):
        expected = {entry["path"].rsplit("/", 1)[-1]: entry["sha256"] for entry in manifest.get("files", []) if entry["role"] == "adb-trust"}
        if not expected: return True
        target = self._active_target("adb")
        if target.is_symlink() or not target.is_dir() or not (target.stat().st_mode & 0o222): return False
        return set(expected) == {"adbkey", "adbkey.pub"} and all((target / name).is_file() and not (target / name).is_symlink() and _sha256(target / name) == digest for name, digest in expected.items())

    def _maintenance_url(self, path):
        return f"http://127.0.0.1:{int(os.environ.get('MAINTENANCE_PORT','3010'))}{path}"

    def _main_url(self, path):
        bind = os.environ.get("HUB_BIND_ADDRESS", "127.0.0.1")
        if bind in ("0.0.0.0", "::", "[::]"): bind = "127.0.0.1"
        if ":" in bind and not bind.startswith("["): bind = f"[{bind}]"
        return f"http://{bind}:{int(os.environ.get('HUB_PORT','3000'))}{path}"

    def _http_json(self, method, url, body=None):
        data = None if body is None else _json_bytes(body)
        request = urllib.request.Request(url, data=data, method=method, headers={"content-type": "application/json", "x-maintenance-token": os.environ.get("MAINTENANCE_TOKEN", "")})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                value = json.load(response)
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Recovery service request failed ({exc.code}): {exc.read(1000).decode(errors='replace')}")
        if not value.get("ok"): raise RuntimeError(value.get("error") or "Recovery service rejected request")
        return value

    def _rollback(self, journal):
        # Stop possible writers before reversing every activated root.
        for name in journal.get("prior", {}).get("containers", {}):
            result = self.run(["docker", "stop", "--time", "20", name], 35, False)
            prior_state = journal.get("prior", {}).get("containers", {}).get(name)
            if prior_state is not None and result.returncode != 0:
                raise RuntimeError(f"Unable to stop {name} before rollback")
            verify = self.run(["docker", "inspect", "--format", "{{.State.Running}}", name], 10, False)
            if verify.returncode == 0 and verify.stdout.strip() != "false":
                raise RuntimeError(f"Container remains active before rollback: {name}")
        for unit in journal.get("prior", {}).get("native", {}):
            result = self.run(["systemctl", "stop", unit], 45, False)
            if journal.get("prior", {}).get("native", {}).get(unit) and result.returncode != 0:
                raise RuntimeError(f"Unable to stop {unit} before rollback")
            verify = self.run(["systemctl", "is-active", unit], 10, False)
            if verify.returncode == 0 and verify.stdout.strip() == "active":
                raise RuntimeError(f"Native service remains active before rollback: {unit}")
        for item in reversed(journal.get("targets", [])):
            target, prepared, safety = map(Path, (item["target"], item["prepared"], item["safety"]))
            if item.get("activated") or item.get("activating"):
                # File existence resolves both crash windows around the two
                # renames. Never delete the untouched original merely because
                # the durable intent marker was written.
                changed = os.path.lexists(safety) if item.get("existed") else not os.path.lexists(prepared)
                if changed:
                    _remove_path(target)
                    if item.get("existed") and os.path.lexists(safety): os.replace(safety, target)
            _remove_path(prepared)
            _fsync_dir(target.parent)
        self._reconcile_prior(journal.get("prior", {}))
        self.journal_file.unlink(missing_ok=True)
        _fsync_dir(self.journal_file.parent)

    def _reconcile_prior(self, prior):
        # Core is force-recreated so changed mounts/environment cannot survive a
        # rollback. Containers/services intentionally stopped before recovery
        # remain stopped.
        if any(prior.get("containers", {}).get(name) is True for name in CORE_CONTAINERS):
            result = self.run(["docker", "compose", "-f", str(self.hub_root / "docker-compose.yml"), "up", "-d", "--force-recreate", "maintenance-agent", "classroom-hub"], 600, False)
            if result.returncode != 0: raise RuntimeError("Core services failed during recovery rollback")
        for name, running in prior.get("containers", {}).items():
            if name in CORE_CONTAINERS: continue
            if running is None:
                result = self.run(["docker", "rm", "-f", name], 60, False)
                # Missing is already the desired state.
                verify = self.run(["docker", "inspect", name], 10, False)
                if verify.returncode == 0: raise RuntimeError(f"Unable to remove newly created {name} during rollback")
            else:
                result = self.run(["docker", "start" if running else "stop", name], 60, False)
                if result.returncode != 0: raise RuntimeError(f"Unable to restore {name} state during rollback")
        for unit, running in prior.get("native", {}).items():
            result = self.run(["systemctl", "start" if running else "stop", unit], 60, False)
            if running and result.returncode != 0: raise RuntimeError(f"Unable to restart {unit} during rollback")

    def _discard_safety(self, journal):
        for item in journal["targets"]:
            for key in ("safety", "prepared"):
                path = Path(item[key])
                _remove_path(path)
        for pattern in ("source-*", "env-source-*"):
            for path in self.state_root.glob(pattern):
                if path.is_dir(): shutil.rmtree(path)
                elif path.is_file(): path.unlink()

    def _cleanup_plaintext(self, recovery_id):
        if not isinstance(recovery_id, str) or not RECOVERY_ID_RE.fullmatch(recovery_id): return
        stage = self.backup_root / "recovery-staging" / recovery_id
        _remove_path(stage)
        for pattern in ("source-*", "env-source-*"):
            for path in self.state_root.glob(pattern): _remove_path(path)
        staging_root = self.backup_root / "recovery-staging"
        if staging_root.is_dir(): _fsync_dir(staging_root)
