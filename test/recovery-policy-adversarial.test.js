"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const os=require("node:os");
const crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const AdmZip=require("adm-zip");

const ROOT=path.resolve(__dirname,"..");
const policy=require(path.join(ROOT,"maintenance-agent/backup-policy"));

function portableZip(){
  const zip=new AdmZip();
  zip.addFile("classroom-hub/data/classroom-control-hub.db",Buffer.from("db"));
  zip.addFile("recovery-secrets/classroom-hub-master.key",Buffer.alloc(32,7));
  return zip;
}

test("full recovery policy rejects non-canonical paths and namespace collisions",()=>{
  for(const candidate of [
    "./classroom-hub/data/media/file.bin",
    "classroom-hub//data/media/file.bin",
    "classroom-hub/data/./media/file.bin",
    "classroom-hub/data/media/file.bin/",
    "classroom-hub/data/media\u0000/file.bin"
  ]) assert.equal(policy.fullRecoveryEntryAllowed(candidate,false),false,candidate);

  const zip=portableZip();
  const files=policy.archiveInventory(zip.getEntries());
  const base={version:6,scope:"full",integrityAlgorithm:"sha256",files,managedServices:[]};
  assert.doesNotThrow(()=>policy.verifyArchiveInventory(zip.getEntries(),{...base,version:5}),"legacy v5 integrity remains inspectable but is not full-restorable");
  assert.throws(()=>policy.verifyArchiveInventory(zip.getEntries(),{...base,version:7}),/supported full manifest/i);
});

test("full recovery controller, maintenance, and host layers share one destructive contract",()=>{
  const controller=fs.readFileSync(path.join(ROOT,"public/controller/app.js"),"utf8");
  const maintenance=fs.readFileSync(path.join(ROOT,"maintenance-agent/server.js"),"utf8");
  const host=fs.readFileSync(path.join(ROOT,"host-agent/server.py"),"utf8");
  const transaction=fs.readFileSync(path.join(ROOT,"host-agent/full_recovery.py"),"utf8");

  for(const source of [controller,maintenance,transaction])assert.match(source,/RESTORE_FULL_RECOVERY/);
  assert.match(controller,/mode:'full-recovery',confirm:'RESTORE_FULL_RECOVERY',passphrase/);
  assert.match(maintenance,/hostAgentRequest\("POST","\/recovery\/full\/start"/);
  assert.match(maintenance,/app\.post\("\/recovery\/reconcile-services"/);
  assert.match(host,/path=='\/recovery\/full\/start'/);
  assert.match(host,/path=='\/recovery\/full\/job'/);

  const execute=transaction.slice(transaction.indexOf("def _execute("),transaction.indexOf("def _targets("));
  const journal=execute.indexOf('phase": "quiescing"');
  const stop=execute.indexOf("self._quiesce(manifest, prior)");
  const commit=execute.indexOf('journal["phase"] = "committed"');
  const discard=execute.indexOf("self._discard_safety(journal)");
  assert.ok(journal>=0&&journal<stop,"prior state and journal must be durable before stopping writers");
  assert.ok(commit>=0&&commit<discard,"commit intent must be durable before rollback snapshots are discarded");
});

test("host-only recovery reconciliation is not exposed through the browser proxy",()=>{
  const server=fs.readFileSync(path.join(ROOT,"src/server.js"),"utf8");
  assert.match(server,/req\.path==="\/recovery\/reconcile-services"\)return res\.status\(404\)/);
});

test("host policy rejects forged path, topology, and service identities",()=>{
  const script=String.raw`
import os, sys
from types import SimpleNamespace
sys.path.insert(0, os.path.join(os.getcwd(), "host-agent"))
from full_recovery import FullRecoveryManager

def run(*_args, **_kwargs):
    return SimpleNamespace(returncode=1, stdout="", stderr="not found")

m=FullRecoveryManager(run, app_uid=10001, app_gid=10001)
for value in ("classroom-hub//data/file", "classroom-hub/data/./file", "../escape", "/absolute"):
    try:
        m._safe_rel(value)
    except RuntimeError:
        pass
    else:
        raise AssertionError("accepted non-canonical path: " + value)

for services in (
    [{"id":"musicassistant","container":"wrong","image":"ghcr.io/music-assistant/server:2.9.13","enabled":True,"running":True,"deploymentOwnership":"roomgoblin"}],
    [{"id":"mosquitto","container":"mosquitto","image":"attacker/image:latest","enabled":True,"running":True,"deploymentOwnership":"roomgoblin"}],
    [{"id":"veyonwebapi","container":"veyon-webapi","image":"","enabled":True,"running":True,"deploymentOwnership":"adopted"}],
):
    try:
        m._validate_services(services, {})
    except RuntimeError:
        pass
    else:
        raise AssertionError("accepted forged managed-service declaration")

assert m._topology_policy("classroom-hub/data/android-tv/devices.json", "file") == (0, 10001, 0o660)
assert m._topology_policy("classroom-hub/data/android-tv/.android/adbkey", "file") == (10001, 10001, 0o600)
`;
  const result=spawnSync("python3",["-c",script],{cwd:ROOT,encoding:"utf8"});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test("maintenance-produced manifest passes the independent host validator",t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"roomgoblin-contract-"));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const recoveryId=`fr-${"a".repeat(32)}`,stage=path.join(temp,"backups","recovery-staging",recoveryId);
  fs.mkdirSync(path.join(temp,"hub"),{recursive:true});fs.writeFileSync(path.join(temp,"hub","VERSION"),"1.0.0-alpha.80\n");
  const zip=portableZip(),files=policy.archiveInventory(zip.getEntries());
  for(const entry of zip.getEntries()){
    const target=path.join(stage,entry.entryName);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.writeFileSync(target,entry.getData());
  }
  const manifest={version:6,scope:"full",confidentiality:"scrypt-aes-256-gcm",integrityAlgorithm:"sha256",applicationVersion:"1.0.0-alpha.80",databaseSchemaVersion:1,files,topology:policy.recoveryTopology(files),managedServices:[]};
  const manifestPath=path.join(stage,"backup-manifest.json");
  fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const checksum=crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
  const script=String.raw`
import os, sys
from types import SimpleNamespace
sys.path.insert(0, os.path.join(os.getcwd(), "host-agent"))
from full_recovery import FullRecoveryManager

def run(args, *_rest):
    if args[0] == "sqlite3": return SimpleNamespace(returncode=0, stdout="ok\n", stderr="")
    return SimpleNamespace(returncode=1, stdout="", stderr="not found")

m=FullRecoveryManager(run, hub_root=os.path.join(os.environ["FIXTURE"],"hub"), services_root=os.path.join(os.environ["FIXTURE"],"services"), backup_root=os.path.join(os.environ["FIXTURE"],"backups"), state_root=os.path.join(os.environ["FIXTURE"],"state"), master_key=os.path.join(os.environ["FIXTURE"],"master.key"), signing_root=os.path.join(os.environ["FIXTURE"],"signing"), veyon_root=os.path.join(os.environ["FIXTURE"],"veyon"), lock_file=os.path.join(os.environ["FIXTURE"],"lock"), app_uid=10001, app_gid=10001)
m._validate_staging(os.environ["RECOVERY_ID"], os.environ["MANIFEST_SHA"])
`;
  const result=spawnSync("python3",["-c",script],{cwd:ROOT,encoding:"utf8",env:{...process.env,FIXTURE:temp,RECOVERY_ID:recoveryId,MANIFEST_SHA:checksum}});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test("recovery implementation includes bounded input and crash-safe state restoration",()=>{
  const maintenance=fs.readFileSync(path.join(ROOT,"maintenance-agent/server.js"),"utf8");
  const host=fs.readFileSync(path.join(ROOT,"host-agent/server.py"),"utf8");
  const transaction=fs.readFileSync(path.join(ROOT,"host-agent/full_recovery.py"),"utf8");

  assert.match(maintenance,/RESTORE_MAX_ARCHIVE_BYTES/);
  assert.match(maintenance,/RESTORE_MAX_EXPANDED_BYTES/);
  assert.match(maintenance,/entries\.length\s*>\s*100000/);
  assert.match(maintenance,/Symbolic links and special archive entries are not permitted|Symbolic links are not permitted/);
  assert.match(transaction,/startup_recover/);
  assert.match(transaction,/journal\.get\("phase"\) == "committed"/);
  assert.match(transaction,/Containers\/services intentionally stopped before recovery/);
  assert.match(transaction,/"start" if running else "stop"/);
  assert.match(transaction,/secretDecryption/);
  assert.match(transaction,/classroom-control-hub-android-adb/);
  const main=host.slice(host.indexOf("if __name__=='__main__':"));
  assert.ok(main.indexOf("UnixHTTPServer(SOCKET_PATH,Handler)")<main.indexOf("FULL_RECOVERY.startup_recover()"),"host socket must be bound before interrupted recovery can recreate health-dependent containers");
  assert.ok(main.indexOf("serving.start()")<main.indexOf("FULL_RECOVERY.startup_recover()"),"host socket must serve health before interrupted recovery reconciliation");
  assert.match(host,/if STARTUP_RECOVERY_ACTIVE:\s+return self\.send_json\(423/);
});

test("native Veyon runtime data is outside the managed Docker recovery namespace",()=>{
  assert.equal(policy.FULL_RECOVERY_SERVICE_ROOTS.includes("veyon-webapi"),false);
  assert.equal(policy.fullRecoveryEntryAllowed("services/veyon-webapi/runtime.db",false),false);
  const transaction=fs.readFileSync(path.join(ROOT,"host-agent/full_recovery.py"),"utf8");
  assert.doesNotMatch(transaction,/"veyon-webapi":\s*"veyon-webapi"/);
});
