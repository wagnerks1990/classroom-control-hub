"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const AdmZip=require("adm-zip");
const {diagnosticBackupEntryAllowed,backupContainsSensitiveData,diagnosticSupportDocuments,fullRecoveryEntryAllowed,archiveInventory,verifyArchiveInventory,parseMasterKey}=require("../maintenance-agent/backup-policy");
const {publicDevice}=require("../maintenance-agent/android-tv-lib");

function filesUnder(root,prefix){
  const selected=[];
  function walk(directory,relativePrefix){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      const full=path.join(directory,entry.name),relative=path.posix.join(relativePrefix,entry.name);
      if(!diagnosticBackupEntryAllowed(relative,entry.isDirectory()))continue;
      if(entry.isDirectory())walk(full,relative);
      else if(entry.isFile())selected.push({full,relative});
    }
  }
  walk(root,prefix);
  return selected;
}

test("diagnostic archive allowlist excludes runtime, student, device, ADB, and service data",t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"roomgoblin-diagnostic-"));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const hub=path.join(temp,"hub"),services=path.join(temp,"services");
  const fixtures={
    "VERSION":"1.2.3\n",
    "package.json":"{\"name\":\"roomgoblin\",\"privateRegistryToken\":\"RAW_ALLOWLIST_SECRET_SENTINEL\"}\n",
    "package-lock.json":"https://user:RAW_ALLOWLIST_SECRET_SENTINEL@registry.invalid/pkg.tgz\n",
    "docker-compose.override.yml":"services:\n  app:\n    environment:\n      TOKEN: RAW_ALLOWLIST_SECRET_SENTINEL\n",
    "maintenance-agent/package.json":"{\"name\":\"maintenance\"}\n",
    "data/classroom-control-hub.db":"STUDENT_DB_SENTINEL",
    "data/lab-screenshots/student-alice.png":"STUDENT_SCREENSHOT_SENTINEL",
    "data/lab-history.json":"STUDENT_HISTORY_SENTINEL",
    "data/android-tv/devices.json":"{\"agentV2\":{\"token\":\"DEVICE_TOKEN_SENTINEL\"}}",
    "data/android-tv/.android/adbkey":"ADB_PRIVATE_KEY_SENTINEL",
    "data/android-tv/.android/adbkey.pub":"ADB_PUBLIC_KEY_SENTINEL"
  };
  for(const [relative,contents] of Object.entries(fixtures)){
    const target=path.join(hub,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,contents);
  }
  const serviceSecret=path.join(services,"govee","data","credentials.json");
  fs.mkdirSync(path.dirname(serviceSecret),{recursive:true});fs.writeFileSync(serviceSecret,"SERVICE_SECRET_SENTINEL");

  const zip=new AdmZip();
  for(const item of [...filesUnder(hub,"classroom-hub"),...filesUnder(services,"services")]){
    zip.addLocalFile(item.full,path.posix.dirname(item.relative),path.posix.basename(item.relative));
  }
  const entries=zip.getEntries().map(entry=>entry.entryName);
  assert.deepEqual(entries,[]);
  const archive=zip.getEntries().map(entry=>entry.getData().toString("utf8")).join("\n");
  for(const sentinel of ["RAW_ALLOWLIST_SECRET_SENTINEL","STUDENT_DB_SENTINEL","STUDENT_SCREENSHOT_SENTINEL","STUDENT_HISTORY_SENTINEL","DEVICE_TOKEN_SENTINEL","ADB_PRIVATE_KEY_SENTINEL","ADB_PUBLIC_KEY_SENTINEL","SERVICE_SECRET_SENTINEL"]){
    assert.equal(archive.includes(sentinel),false,`${sentinel} leaked into diagnostic archive`);
  }
});

test("only the explicit diagnostic scope is classified support-safe",()=>{
  assert.equal(backupContainsSensitiveData("diagnostic"),false);
  for(const scope of ["quick","configuration","operational","full",undefined,"unknown"]){
    assert.equal(backupContainsSensitiveData(scope),true,`${scope} must be treated as sensitive`);
  }
});

test("portable full recovery uses an exact runtime-state allowlist",()=>{
  for(const name of [
    "classroom-hub/data/classroom-control-hub.db",
    "classroom-hub/data/media/lesson.mp4",
    "classroom-hub/data/android-tv/.android/adbkey",
    "classroom-hub/data/android-tv/devices.json",
    "services/music-assistant/state.db",
    "recovery-secrets/classroom-hub-master.key",
    "recovery-secrets/android-agent-signing/android-agent/RoomGoblin-Display-Agent.keystore",
    "recovery-secrets/android-agent-signing/android-agent/password"
  ])assert.equal(fullRecoveryEntryAllowed(name,false),true,name);
  for(const name of [
    "classroom-hub/.env","classroom-hub/package.json","classroom-hub/src/server.js",
    "classroom-hub/data/state.json","classroom-hub/data/sessions.json",
    "classroom-hub/data/backups/nested.zip","classroom-hub/data/legacy/stale.json",
    "services/unmanaged/state.db","services/mosquitto/log/private.log",
    "recovery-secrets/android-agent-signing/unreviewed.txt","../escape"
  ])assert.equal(fullRecoveryEntryAllowed(name,false),false,name);
});

test("portable recovery inventory rejects changed, extra, and colliding payloads",()=>{
  const zip=new AdmZip();
  zip.addFile("classroom-hub/data/classroom-control-hub.db",Buffer.from("consistent snapshot"));
  zip.addFile("recovery-secrets/classroom-hub-master.key",Buffer.alloc(32,7));
  const files=archiveInventory(zip.getEntries()),manifest={version:5,scope:"full",integrityAlgorithm:"sha256",files};
  zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify(manifest)));
  assert.deepEqual(verifyArchiveInventory(zip.getEntries(),manifest),files);

  const changed=new AdmZip();
  changed.addFile("classroom-hub/data/classroom-control-hub.db",Buffer.from("tampered snapshot"));
  changed.addFile("recovery-secrets/classroom-hub-master.key",Buffer.alloc(32,7));
  changed.addFile("backup-manifest.json",Buffer.from(JSON.stringify(manifest)));
  assert.throws(()=>verifyArchiveInventory(changed.getEntries(),manifest),/integrity check failed/);

  const extra=new AdmZip();
  extra.addFile("classroom-hub/data/classroom-control-hub.db",Buffer.from("consistent snapshot"));
  extra.addFile("recovery-secrets/classroom-hub-master.key",Buffer.alloc(32,7));
  extra.addFile("classroom-hub/package.json",Buffer.from("unreviewed"));
  extra.addFile("backup-manifest.json",Buffer.from(JSON.stringify(manifest)));
  assert.throws(()=>verifyArchiveInventory(extra.getEntries(),manifest),/Unexpected portable recovery entry/);

  const fake=data=>({entryName:"classroom-hub/data/media/ROOM.txt",isDirectory:false,getData:()=>Buffer.from(data)});
  assert.throws(()=>verifyArchiveInventory([fake("one"),{...fake("two"),entryName:"classroom-hub/data/media/room.txt"}],{...manifest,files:[]}),/duplicate or case-colliding/);

  const missingKey=new AdmZip();
  missingKey.addFile("classroom-hub/data/classroom-control-hub.db",Buffer.from("consistent snapshot"));
  const incomplete={version:5,scope:"full",integrityAlgorithm:"sha256",files:archiveInventory(missingKey.getEntries())};
  missingKey.addFile("backup-manifest.json",Buffer.from(JSON.stringify(incomplete)));
  assert.throws(()=>verifyArchiveInventory(missingKey.getEntries(),incomplete),/missing indispensable entry: recovery-secrets\/classroom-hub-master\.key/);
});

test("portable recovery master keys are canonicalized and invalid keys fail closed",()=>{
  const key=Buffer.alloc(32,0xab);
  assert.deepEqual(parseMasterKey(key),key);
  assert.deepEqual(parseMasterKey(Buffer.from(`${key.toString("hex")}\n`)),key);
  assert.deepEqual(parseMasterKey(Buffer.from(`${key.toString("base64")}\n`)),key);
  assert.throws(()=>parseMasterKey(Buffer.from("MASTER_KEY_SENTINEL")),/exactly 32 bytes/);
});

test("public Android device serialization never exposes the Device Agent token",()=>{
  const token="a".repeat(64);
  const stored={id:"display-1",name:"Room 101",agentV2:{enabled:true,port:8765,token,configuredAt:"2026-01-01T00:00:00.000Z"}};
  const result=publicDevice(stored);
  assert.equal(stored.agentV2.token,token,"sanitization must not mutate the server-side credential");
  assert.equal(Object.hasOwn(result.agentV2,"token"),false);
  assert.equal(result.agentV2.tokenConfigured,true);
  assert.equal(JSON.stringify(result).includes(token),false);
});

test("ADB failure serialization cannot echo a Device Agent token",()=>{
  const token="forced-failure-token-should-never-escape";
  const {safeAdbError}=require("../maintenance-agent/android-tv-agent-v2");
  const fromMessage=safeAdbError({message:`Command failed: adb --es agent_token ${token}`},[token]);
  assert.equal(fromMessage.message,"ADB command failed");
  const fromStderr=safeAdbError({stderr:`device rejected token ${token}`},[token]);
  assert.equal(fromStderr.message,"device rejected token [REDACTED]");
  assert.equal(JSON.stringify({error:fromStderr.message}).includes(token),false);
});

test("support diagnostic documents exclude seeded logs, tokens, student data, paths, and network inventory",()=>{
  const sentinel="STUDENT_AND_TOKEN_SENTINEL";
  const documents=diagnosticSupportDocuments({
    createdAt:"2026-01-01T00:00:00.000Z",agentVersion:"1.2.3",
    application:{ok:true,error:sentinel,database:{file:`/private/${sentinel}.db`,size:123,schemaVersion:10,journalMode:"WAL",encryptedSecrets:true,normalized:{students:sentinel}}},
    containers:[{Names:sentinel,Image:`private.invalid/${sentinel}`,State:"running",Labels:{token:sentinel},Log:sentinel,Mounts:sentinel}],
    system:{platform:"linux",architecture:"x64",cpuCount:4,memoryBytes:1024,ipAddress:sentinel,routes:sentinel},
    logs:[sentinel]
  });
  const zip=new AdmZip();
  zip.addFile("summary.json",Buffer.from(JSON.stringify(documents.summary)));
  zip.addFile("docker/containers.json",Buffer.from(JSON.stringify(documents.containers)));
  const serialized=zip.getEntries().map(entry=>entry.getData().toString("utf8")).join("\n");
  assert.equal(serialized.includes(sentinel),false);
  assert.deepEqual(documents.containers,{total:1,states:{running:1}});
  assert.deepEqual(zip.getEntries().map(entry=>entry.entryName).sort(),["docker/containers.json","summary.json"]);
  assert.deepEqual(documents.summary.privacy,{rawLogsIncluded:false,studentDataIncluded:false,secretsIncluded:false,networkInventoryIncluded:false});
});

test("maintenance image and UI use the centralized backup and response policies",()=>{
  const root=path.join(__dirname,"..");
  const dockerfile=fs.readFileSync(path.join(root,"maintenance-agent/Dockerfile"),"utf8");
  const server=fs.readFileSync(path.join(root,"maintenance-agent/server.js"),"utf8");
  const ui=fs.readFileSync(path.join(root,"public/controller/app.js"),"utf8");
  assert.match(dockerfile,/COPY maintenance-agent\/backup-policy\.js \.\//);
  assert.match(server,/scope==="diagnostic"/);
  assert.match(server,/zip\.addFile\("summary\.json"/);
  assert.match(server,/confirmSensitiveData/);
  assert.doesNotMatch(server,/zip\.addFile\(`logs\//);
  assert.match(ui,/Sensitive recovery data/);
  assert.match(ui,/downloadManagedBackup/);
});

test("restore ownership repair is host-bounded and cannot mutate the recovery master key",()=>{
  const root=path.join(__dirname,".."),host=fs.readFileSync(path.join(root,"host-agent/server.py"),"utf8"),compose=fs.readFileSync(path.join(root,"docker-compose.yml"),"utf8");
  assert.match(host,/\/recovery\/normalize-data/);
  assert.match(host,/NORMALIZE_RESTORED_DATA/);
  assert.match(host,/RoomGoblin must be stopped before recovery ownership repair/);
  assert.match(host,/for child in data_root\.iterdir\(\)/);
  assert.doesNotMatch(host,/\/recovery\/(?:master-key|apply-host-state)/);
  assert.doesNotMatch(compose,/cap_add:\s*\n\s*- CHOWN/);
});
