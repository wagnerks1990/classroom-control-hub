#!/usr/bin/env python3
import hashlib
import json
import os
import tempfile
import time
import unittest
import sys
import subprocess
import shutil
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from full_recovery import FullRecoveryManager, SUPPORTED_SCHEMA_VERSION


class FakeRun:
    def __init__(self, docker_volume):
        self.calls = []
        self.docker_volume = docker_volume
        self.fail_compose = False

    def __call__(self, args, timeout=20, check=True):
        self.calls.append(tuple(args))
        if args[:2] == ["sqlite3", args[1]] if args and args[0] == "sqlite3" else False:
            return SimpleNamespace(returncode=0, stdout="ok\n", stderr="")
        if args[:3] == ["docker", "volume", "inspect"]:
            return SimpleNamespace(returncode=0, stdout=json.dumps([{"Name":"classroom-control-hub-android-adb","Mountpoint":str(self.docker_volume),"Labels":{"org.roomgoblin.deployment-ownership":"roomgoblin"}}]), stderr="")
        if args[:4] == ["docker", "exec", "classroom-control-hub-maintenance", "adb"]:
            return SimpleNamespace(returncode=0, stdout="public\n", stderr="")
        if args[:2] == ["docker", "inspect"]:
            # Validation probes use the two-argument form and should see no
            # existing adopted container; desired-state probes use --format.
            return SimpleNamespace(returncode=1, stdout="", stderr="not found")
        if args[:2] == ["docker", "compose"] and self.fail_compose:
            return SimpleNamespace(returncode=1, stdout="", stderr="failed")
        return SimpleNamespace(returncode=0, stdout="", stderr="")


class FullRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.hub = root / "hub"
        self.services = root / "services"
        self.backups = root / "backups"
        self.state = root / "state"
        self.master = root / "etc/master.key"
        self.signing = root / "etc/signing"
        self.veyon = root / "etc/veyon"
        self.volume = root / "docker-volumes/classroom-control-hub-android-adb/_data"
        for directory in (self.hub / "data", self.services, self.backups, self.state, self.volume):
            directory.mkdir(parents=True, exist_ok=True)
        (self.hub / "VERSION").write_text("1.0.0-test\n")
        self.fake = FakeRun(self.volume)
        self.manager = FullRecoveryManager(self.fake, hub_root=self.hub, services_root=self.services,
            backup_root=self.backups, state_root=self.state, master_key=self.master,
            signing_root=self.signing, veyon_root=self.veyon, lock_file=root / "mutation.lock",
            app_uid=os.getuid(), app_gid=os.getgid())
        self.env = patch.dict(os.environ, {"DOCKER_VOLUMES_ROOT": str(root / "docker-volumes"), "MAINTENANCE_TOKEN": "test-token", "FULL_RECOVERY_HANDOFF_GRACE_SECONDS": "0", "RESTORE_HEALTH_TIMEOUT_SECONDS": "2"})
        self.env.start()
        # The production Host Agent runs as root and must apply the validated
        # topology ownership. CI intentionally runs unprivileged, so isolate
        # only the privileged syscall while still exercising every policy and
        # transaction branch around it.
        self.chown = patch("full_recovery.os.chown")
        self.chown.start()

    def tearDown(self):
        self.chown.stop()
        self.env.stop()
        self.temp.cleanup()

    def stage(self, *, adb=True, services=None):
        recovery_id = "fr-" + "a" * 32
        root = self.backups / "recovery-staging" / recovery_id
        files = {
            "classroom-hub/data/classroom-control-hub.db": b"sqlite-snapshot",
            "classroom-hub/data/media/welcome.txt": b"restored",
            "recovery-secrets/classroom-hub-master.key": b"ab" * 32,
        }
        if adb:
            files["classroom-hub/data/android-tv/.android/adbkey"] = b"private"
            files["classroom-hub/data/android-tv/.android/adbkey.pub"] = b"public"
        for rel, data in files.items():
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        inventory = []
        roles = {"classroom-hub/data/classroom-control-hub.db": "database",
                 "recovery-secrets/classroom-hub-master.key": "master-key"}
        for rel, data in files.items():
            role = roles.get(rel, "adb-trust" if "/.android/" in rel else "application-data")
            mode = self.manager._topology_policy(rel, "file")[2]
            inventory.append({"path": rel, "role": role, "size": len(data),
                              "sha256": hashlib.sha256(data).hexdigest(), "mode": f"{mode:04o}"})
        topology = []
        directories = set()
        for rel in files:
            parent = Path(rel).parent
            while str(parent) != ".":
                if str(parent) != "classroom-hub":
                    directories.add(parent.as_posix())
                parent = parent.parent
            uid, gid, mode = self.manager._topology_policy(rel, "file")
            topology.append({"path": rel, "type": "file", "role": self.manager._expected_role(rel, "file"),
                             "uid": uid, "gid": gid, "mode": f"{mode:04o}"})
        for rel in sorted(directories):
            uid, gid, mode = self.manager._topology_policy(rel, "directory")
            topology.append({"path": rel, "type": "directory", "role": self.manager._expected_role(rel, "directory"),
                             "uid": uid, "gid": gid, "mode": f"{mode:04o}"})
        managed = services if services is not None else []
        manifest = {"version": 6, "scope": "full", "confidentiality": "scrypt-aes-256-gcm",
                    "integrityAlgorithm": "sha256", "applicationVersion": "1.0.0-test",
                    "databaseSchemaVersion": 1, "files": inventory, "topology": topology,
                    "managedServices": managed}
        manifest_path = root / "backup-manifest.json"
        manifest_path.write_text(json.dumps(manifest, separators=(",", ":")))
        return recovery_id, hashlib.sha256(manifest_path.read_bytes()).hexdigest(), root

    def wait(self):
        for _ in range(200):
            status = self.manager.status()
            if not status["running"]: return status
            time.sleep(.01)
        self.fail("recovery did not finish")

    def test_clean_host_success_restores_named_adb_volume(self):
        recovery_id, checksum, _ = self.stage()
        self.manager._restart_and_validate = lambda manifest, prior=None: None
        result = self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})
        self.assertTrue(result["started"])
        self.manager.release_handoff(recovery_id)
        status = self.wait()
        self.assertEqual(status["phase"], "completed", status)
        self.assertTrue(status["reloginRequired"])
        self.assertEqual((self.hub / "data/classroom-control-hub.db").read_bytes(), b"sqlite-snapshot")
        self.assertIn("DATABASE_FILE=/app/data/classroom-control-hub.db", (self.hub / ".env").read_text())
        self.assertEqual((self.volume / "adbkey").read_bytes(), b"private")
        self.assertEqual(sum(1 for call in self.fake.calls if call[:4] == ("docker", "exec", "classroom-control-hub-maintenance", "adb")), 1)
        self.assertFalse(self.manager.journal_file.exists())

    def test_failure_after_activation_restores_complete_quiesced_snapshot(self):
        (self.hub / "data/original.txt").write_text("original")
        self.master.parent.mkdir(parents=True, exist_ok=True)
        self.master.write_text("old-master")
        recovery_id, checksum, _ = self.stage(adb=False)
        self.manager._restart_and_validate = lambda manifest, prior=None: (_ for _ in ()).throw(RuntimeError("health failed"))
        self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})
        self.manager.release_handoff(recovery_id)
        status = self.wait()
        self.assertEqual(status["phase"], "rolled-back", status)
        self.assertEqual((self.hub / "data/original.txt").read_text(), "original")
        self.assertEqual(self.master.read_text(), "old-master")
        stop_index = next(i for i, call in enumerate(self.fake.calls) if call[:2] == ("docker", "stop"))
        self.assertGreater(len(self.fake.calls), stop_index)

    def test_startup_rolls_back_crash_between_atomic_renames(self):
        target = self.hub / "data"
        target.joinpath("new").write_text("new")
        safety = self.hub / (".data.roomgoblin-old-fr-" + "b" * 32)
        safety.mkdir(); safety.joinpath("old").write_text("old")
        prepared = self.hub / (".data.roomgoblin-new-fr-" + "b" * 32)
        journal = {"version": 1, "recoveryId": "fr-" + "b" * 32, "phase": "prepared",
                   "prior": {"containers": {}, "native": {}},
                   "targets": [{"target": str(target), "prepared": str(prepared), "safety": str(safety),
                                "existed": True, "kind": "data", "activated": False, "activating": True}]}
        self.manager.state_root.mkdir(parents=True, exist_ok=True)
        self.manager.journal_file.write_text(json.dumps(journal))
        self.assertTrue(self.manager.startup_recover())
        self.assertEqual(target.joinpath("old").read_text(), "old")
        self.assertFalse(target.joinpath("new").exists())

    def test_symlink_and_noncanonical_database_fail_before_mutation(self):
        recovery_id, checksum, root = self.stage(adb=False)
        outside = Path(self.temp.name) / "outside"
        outside.write_text("outside")
        (root / "classroom-hub/data/link").symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, "Symbolic links"):
            self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})
        self.assertFalse(any(call[:2] == ("docker", "stop") for call in self.fake.calls))

    def test_adopted_container_collision_fails_closed(self):
        service = {"id": "mosquitto", "container": "mosquitto", "image": "eclipse-mosquitto:2.0.22",
                   "enabled": True, "running": True, "deploymentOwnership": "roomgoblin"}
        recovery_id, checksum, _ = self.stage(adb=False, services=[service])
        original = self.fake.__call__
        def collision(args, timeout=20, check=True):
            if args == ["docker", "inspect", "mosquitto"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps([{"Config":{"Labels":{}}}]), stderr="")
            return original(args, timeout, check)
        self.manager.run = collision
        with self.assertRaisesRegex(RuntimeError, "adopted/external"):
            self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})

    def test_reconcile_is_one_bounded_maintenance_call_with_exact_desired_state(self):
        service = {"id": "mosquitto", "container": "mosquitto", "image": "eclipse-mosquitto:2.0.22",
                   "enabled": True, "running": False, "deploymentOwnership": "roomgoblin"}
        calls = []
        def http(method, url, body=None):
            calls.append((method, url, body))
            if url.endswith("/recovery/reconcile-services"):
                return {"ok": True, "reconciled": ["mosquitto"]}
            if url.endswith("/health"):
                if ":3010/" in url: return {"ok": True, "version": "1.0.0-test", "hostAgent": {"version": "1.0.0-test"}}
                return {"ok": True, "version": "1.0.0-test", "checks": {"database": {"ok": True}, "scheduler": {"ok": True}}}
            return {"ok": True, "database": {"secrets": 3, "schemaVersion": 10}, "secretDecryption": {"ok": True, "checked": 3}}
        self.manager._http_json = http
        self.manager._restart_and_validate({"applicationVersion": "1.0.0-test", "databaseSchemaVersion": 1, "files": [], "managedServices": [service]}, {"native": {}})
        reconcile = [call for call in calls if call[1].endswith("/recovery/reconcile-services")]
        self.assertEqual(reconcile, [("POST", "http://127.0.0.1:3010/recovery/reconcile-services",
                                      {"services": [{"id": "mosquitto", "enabled": True, "running": False}]})])

    def test_worker_waits_for_response_handoff_before_quiescing(self):
        recovery_id, checksum, _ = self.stage(adb=False)
        self.manager._restart_and_validate = lambda manifest, prior=None: None
        self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})
        time.sleep(.03)
        self.assertFalse(any(call[:2] == ("docker", "stop") for call in self.fake.calls))
        self.manager.release_handoff(recovery_id)
        self.assertEqual(self.wait()["phase"], "completed")

    def test_rollback_command_failure_is_reported_and_journal_retained(self):
        recovery_id, checksum, _ = self.stage(adb=False)
        self.manager._restart_and_validate = lambda manifest, prior=None: (_ for _ in ()).throw(RuntimeError("health failed"))
        self.manager._rollback = lambda journal: (_ for _ in ()).throw(RuntimeError("writer still active"))
        self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})
        self.manager.release_handoff(recovery_id)
        status = self.wait()
        self.assertEqual(status["phase"], "rollback-failed")
        self.assertEqual(status["rollback"]["ok"], False)
        self.assertTrue(self.manager.journal_file.exists())

    def test_committed_cleanup_failure_never_rolls_back_validated_state(self):
        recovery_id, checksum, _ = self.stage(adb=False)
        self.manager._restart_and_validate = lambda manifest, prior=None: None
        discard = self.manager._discard_safety
        self.manager._discard_safety = lambda journal: (_ for _ in ()).throw(RuntimeError("cleanup interrupted"))
        self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})
        self.manager.release_handoff(recovery_id)
        status = self.wait()
        self.assertEqual(status["phase"], "completed")
        self.assertTrue(status["cleanupPending"])
        self.assertEqual(json.loads(self.manager.journal_file.read_text())["phase"], "committed")
        self.manager._discard_safety = discard
        self.assertTrue(self.manager.startup_recover())
        self.assertFalse(self.manager.journal_file.exists())

    def test_managed_service_image_is_not_manifest_controlled(self):
        service = {"id": "mosquitto", "container": "mosquitto", "image": "attacker.invalid/latest",
                   "enabled": True, "running": True, "deploymentOwnership": "roomgoblin"}
        recovery_id, checksum, _ = self.stage(adb=False, services=[service])
        with self.assertRaisesRegex(RuntimeError, "outside the recovery policy"):
            self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})

    def test_roomgoblin_owned_standalone_container_is_accepted(self):
        service = {"id": "mosquitto", "container": "mosquitto", "image": "eclipse-mosquitto:2.0.22",
                   "enabled": True, "running": True, "deploymentOwnership": "roomgoblin"}
        recovery_id, checksum, _ = self.stage(adb=False, services=[service])
        original = self.fake.__call__
        def owned(args, timeout=20, check=True):
            if args == ["docker", "inspect", "mosquitto"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps([{"Config":{"Image":"eclipse-mosquitto:2.0.22","Labels":{"org.roomgoblin.deployment-ownership":"roomgoblin"}}}]), stderr="")
            return original(args, timeout, check)
        self.manager.run = owned
        self.manager._validate_staging(recovery_id, checksum)

    def test_staged_docker_service_state_requires_owned_declaration(self):
        recovery_id, checksum, root = self.stage(adb=False)
        payload = root / "services/mosquitto/config/mosquitto.conf"
        payload.parent.mkdir(parents=True); payload.write_text("listener 1883")
        manifest_path = root / "backup-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        rel = "services/mosquitto/config/mosquitto.conf"
        data = payload.read_bytes()
        manifest["files"].append({"path": rel, "role": "service-state", "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "mode": "0660"})
        for directory in ("services", "services/mosquitto", "services/mosquitto/config"):
            uid, gid, mode = self.manager._topology_policy(directory, "directory")
            manifest["topology"].append({"path": directory, "type": "directory", "role": "service-state", "uid": uid, "gid": gid, "mode": f"{mode:04o}"})
        uid, gid, mode = self.manager._topology_policy(rel, "file")
        manifest["topology"].append({"path": rel, "type": "file", "role": "service-state", "uid": uid, "gid": gid, "mode": f"{mode:04o}"})
        manifest_path.write_text(json.dumps(manifest, separators=(",", ":")))
        checksum = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(RuntimeError, "lacks an exact RoomGoblin-owned declaration"):
            self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})

    def test_current_maintenance_topology_producer_is_a_valid_host_fixture(self):
        recovery_id, _, root = self.stage(adb=True)
        manifest_path = root / "backup-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        script = "const p=require('./maintenance-agent/backup-policy');process.stdout.write(JSON.stringify(p.recoveryTopology(JSON.parse(process.argv[1]))))"
        produced = subprocess.run(["node", "-e", script, json.dumps(manifest["files"])],
                                  cwd=Path(__file__).resolve().parents[1], text=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        manifest["topology"] = json.loads(produced.stdout)
        manifest_path.write_text(json.dumps(manifest, separators=(",", ":")))
        checksum = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
        production_ids = FullRecoveryManager(self.fake, hub_root=self.hub, services_root=self.services,
            backup_root=self.backups, state_root=self.state, master_key=self.master,
            signing_root=self.signing, veyon_root=self.veyon, lock_file=Path(self.temp.name) / "production.lock",
            app_uid=10001, app_gid=10001)
        production_ids._validate_staging(recovery_id, checksum)

    def test_capacity_failure_precedes_large_copy_and_removes_plaintext_stage(self):
        (self.hub / "data/original").write_text("kept")
        recovery_id, checksum, stage = self.stage(adb=True)
        self.manager._capacity_preflight = lambda targets: (_ for _ in ()).throw(RuntimeError("insufficient capacity"))
        self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})
        self.manager.release_handoff(recovery_id)
        status = self.wait()
        self.assertEqual(status["phase"], "failed")
        self.assertEqual((self.hub / "data/original").read_text(), "kept")
        self.assertFalse(stage.exists())
        self.assertEqual(list(self.state.glob("env-source-*")), [])

    def test_incompatible_version_schema_and_incomplete_identity_fail_closed(self):
        for mutate, expected in (
            (lambda m: m.update(applicationVersion="2.0.0"), "application version is incompatible"),
            (lambda m: m.update(databaseSchemaVersion=SUPPORTED_SCHEMA_VERSION + 1), "database schema is newer"),
        ):
            recovery_id, _, root = self.stage(adb=False)
            manifest_path = root / "backup-manifest.json"; manifest = json.loads(manifest_path.read_text()); mutate(manifest)
            manifest_path.write_text(json.dumps(manifest, separators=(",", ":"))); checksum = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(RuntimeError, expected):
                self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})
            shutil.rmtree(root)

    def test_partial_adb_identity_is_rejected_by_host(self):
        recovery_id, _, root = self.stage(adb=True)
        missing = root / "classroom-hub/data/android-tv/.android/adbkey.pub"; missing.unlink()
        manifest_path = root / "backup-manifest.json"; manifest = json.loads(manifest_path.read_text())
        manifest["files"] = [entry for entry in manifest["files"] if not entry["path"].endswith("adbkey.pub")]
        manifest["topology"] = [entry for entry in manifest["topology"] if not entry["path"].endswith("adbkey.pub")]
        manifest_path.write_text(json.dumps(manifest, separators=(",", ":"))); checksum = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(RuntimeError, "incomplete ADB trust pair"):
            self.manager.start({"confirm": "RESTORE_FULL_RECOVERY", "recoveryId": recovery_id, "manifestSha256": checksum})

    def test_adb_volume_mountpoint_and_ownership_are_exact(self):
        recovery_id, checksum, stage = self.stage(adb=True)
        _, manifest = self.manager._validate_staging(recovery_id, checksum)
        self.fake.docker_volume = Path(self.temp.name) / "docker-volumes/other-volume/_data"
        self.fake.docker_volume.mkdir(parents=True)
        with self.assertRaisesRegex(RuntimeError, "mountpoint is unavailable or unsafe"):
            self.manager._targets(stage, manifest)
        original = self.fake.__call__
        def unowned(args, timeout=20, check=True):
            if args[:3] == ["docker", "volume", "inspect"]:
                mount = Path(self.temp.name) / "docker-volumes/classroom-control-hub-android-adb/_data"; mount.mkdir(parents=True,exist_ok=True)
                return SimpleNamespace(returncode=0, stdout=json.dumps([{"Mountpoint":str(mount),"Labels":{}}]), stderr="")
            return original(args, timeout, check)
        self.manager.run = unowned
        with self.assertRaisesRegex(RuntimeError, "not owned by RoomGoblin"):
            self.manager._targets(stage, manifest)

    def test_prepare_copy_failure_is_journaled_and_cleans_partial_secret_copy(self):
        recovery_id = "fr-" + "c" * 32
        source = Path(self.temp.name) / "source-secret"; source.mkdir(); source.joinpath("key").write_text("secret")
        target = Path(self.temp.name) / "target-secret"
        journal = {"version": 1, "recoveryId": recovery_id, "phase": "snapshot", "targets": [], "prior": {"containers": {}, "native": {}}}
        self.manager.state_root.mkdir(parents=True, exist_ok=True); self.manager.journal_file.write_text(json.dumps(journal))
        original = shutil.copytree
        def interrupted(src, dst, *args, **kwargs):
            Path(dst).mkdir(); Path(dst, "partial").write_text("secret"); raise OSError("power loss")
        with patch("full_recovery.shutil.copytree", interrupted):
            with self.assertRaisesRegex(OSError, "power loss"): self.manager._prepare_swap(source, target, "signing", journal)
        durable = json.loads(self.manager.journal_file.read_text())
        prepared = Path(durable["targets"][0]["prepared"])
        self.assertTrue(prepared.exists())
        self.manager._rollback(durable)
        self.assertFalse(prepared.exists())


if __name__ == "__main__":
    unittest.main()
