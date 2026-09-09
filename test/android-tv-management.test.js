"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const {JsonStore,normalizeProfile,normalizeDevice,adbArgsForAction}=require("../maintenance-agent/android-tv-lib");

test("standard profile is normalized and bounded",()=>{
  const p=normalizeProfile({id:"school-standard",name:"School Standard",defaultVolume:999,wakeTime:"06:45",sleepTime:"25:00",recovery:{rebootAfterFailures:50}});
  assert.equal(p.defaultVolume,100);assert.equal(p.wakeTime,"06:45");assert.equal(p.sleepTime,"16:00");assert.equal(p.recovery.rebootAfterFailures,20);
});

test("managed device inventory and persistent ADB policy survive reload",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"hub-android-"));
  try{
    const store=new JsonStore(root);
    const saved=store.upsertDevice({id:"room-127",name:"Room 127 TV",host:"192.168.1.50",port:5555,profileId:"classroom-standard",persistentAdb:{enabled:true,targetPort:5555,bootRestore:true,bootstrapAt:"2026-09-09T19:00:00Z"}});
    const loaded=new JsonStore(root).getDevice("room-127");
    assert.equal(saved.serial,"192.168.1.50:5555");
    assert.equal(loaded.name,"Room 127 TV");
    assert.equal(loaded.platform,"android-tv");
    assert.equal(loaded.persistentAdb.enabled,true);
    assert.equal(loaded.persistentAdb.targetPort,5555);
    assert.equal(loaded.persistentAdb.bootRestore,true);
    assert.equal(loaded.persistentAdb.bootstrapAt,"2026-09-09T19:00:00Z");
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test("remote actions map to bounded adb argument arrays",()=>{
  const d=normalizeDevice({id:"tv1",host:"10.0.0.5",serial:"10.0.0.5:5555"});
  assert.deepEqual(adbArgsForAction(d,"wake"),["-s","10.0.0.5:5555","shell","input","keyevent","KEYCODE_WAKEUP"]);
  assert.deepEqual(adbArgsForAction(d,"reboot"),["-s","10.0.0.5:5555","reboot"]);
  assert.throws(()=>adbArgsForAction(d,"not-real"),/Unsupported Android action/);
});

test("Android management runtime JavaScript parses cleanly",()=>{
  for(const file of ["maintenance-agent/android-tv-lib.js","maintenance-agent/android-tv-extension.js","maintenance-agent/android-tv-persistent-adb.js","public/managed-displays/app.js"]){
    const r=spawnSync(process.execPath,["--check",path.join(process.cwd(),file)],{encoding:"utf8"});
    assert.equal(r.status,0,`${file} failed syntax validation: ${r.stderr||r.stdout}`);
  }
});

test("managed display enrollment and configuration are separate workflows",()=>{
  const html=fs.readFileSync(path.join(process.cwd(),"public/managed-displays/index.html"),"utf8");
  const app=fs.readFileSync(path.join(process.cwd(),"public/managed-displays/app.js"),"utf8");
  const enroll=html.match(/<form id="enroll">([\s\S]*?)<\/form>/)?.[1]||"";
  assert.match(enroll,/name="host"/);
  assert.match(enroll,/name="pairingPort"/);
  assert.doesNotMatch(enroll,/name="school"/);
  assert.doesNotMatch(enroll,/name="building"/);
  assert.doesNotMatch(enroll,/name="room"/);
  assert.doesNotMatch(enroll,/name="displayUrl"/);
  assert.match(html,/id="editDialog"/);
  assert.match(html,/Change assignment and content settings without touching the ADB enrollment/i);
  assert.match(html,/name="school" id="editSchool"/);
  assert.match(html,/name="displayUrl" id="editDisplayUrl"/);
  assert.match(app,/data-op="edit"/);
  assert.match(app,/method:'PUT'/);
  assert.match(app,/openEdit\(j\.device\.id\)/);
});

test("persistent ADB devices use fast bounded reboot recovery and agent launch acceleration",()=>{
  const app=fs.readFileSync(path.join(process.cwd(),"public/managed-displays/app.js"),"utf8");
  assert.match(app,/async function recoverStatus/);
  assert.match(app,/Recovering…/);
  assert.match(app,/timeoutMs=90000/);
  assert.match(app,/intervalMs=1500/);
  assert.match(app,/async function accelerateAgentStart/);
  assert.match(app,/Starting…/);
  assert.match(app,/scheduleRefresh/);
  assert.match(app,/document\.hidden\?15000:delay/);
});

test("managed minimal mode only targets third-party packages and preserves the Classroom Hub agent",()=>{
  const app=fs.readFileSync(path.join(process.cwd(),"public/managed-displays/app.js"),"utf8");
  assert.match(app,/data-op="audit-apps"/);
  assert.match(app,/data-op="minimal"/);
  assert.match(app,/data-op="restore-apps"/);
  assert.match(app,/pm list packages -3/);
  assert.match(app,/pm disable-user --user 0/);
  assert.match(app,/pm enable/);
  assert.match(app,/org\.classroomhub\.display/);
});

test("maintenance image installs an ADB build that supports wireless pairing",()=>{
  const dockerfile=fs.readFileSync(path.join(process.cwd(),"maintenance-agent/Dockerfile"),"utf8");
  assert.match(dockerfile,/platform-tools-latest-linux\.zip/);
  assert.match(dockerfile,/adb help 2>&1 \| grep -q "pair HOST"/);
  assert.match(dockerfile,/\/usr\/local\/bin\/adb/);
  assert.match(dockerfile,/android-tv-persistent-adb\.js/);
});

test("secure wireless ADB reconnect rediscovery is installed",()=>{
  const source=fs.readFileSync(path.join(process.cwd(),"maintenance-agent/android-tv-extension.js"),"utf8");
  assert.match(source,/\["mdns","services"\]/);
  assert.match(source,/_adb-tls-connect\._tcp/);
  assert.match(source,/async function ensureDevice/);
  assert.match(source,/adb-mdns-recovery/);
  assert.match(source,/res\.status\(202\).*reboot/s);
});

test("persistent ADB bootstrap uses direct-boot-safe agent storage",()=>{
  const manifest=fs.readFileSync(path.join(process.cwd(),"agents/android-tv/app/src/main/AndroidManifest.xml"),"utf8");
  const boot=fs.readFileSync(path.join(process.cwd(),"agents/android-tv/app/src/main/java/org/classroomhub/display/BootReceiver.java"),"utf8");
  const config=fs.readFileSync(path.join(process.cwd(),"agents/android-tv/app/src/main/java/org/classroomhub/display/ConfigReceiver.java"),"utf8");
  const storage=fs.readFileSync(path.join(process.cwd(),"agents/android-tv/app/src/main/java/org/classroomhub/display/HubStorage.java"),"utf8");
  const bridge=fs.readFileSync(path.join(process.cwd(),"maintenance-agent/android-tv-persistent-adb.js"),"utf8");
  assert.match(manifest,/android\.permission\.WRITE_SECURE_SETTINGS/);
  assert.match(manifest,/android:directBootAware="true"/);
  assert.match(boot,/ACTION_LOCKED_BOOT_COMPLETED/);
  assert.match(boot,/HubStorage\.prefs/);
  assert.match(config,/HubStorage\.prefs/);
  assert.match(storage,/createDeviceProtectedStorageContext/);
  assert.match(storage,/moveSharedPreferencesFrom/);
  assert.match(bridge,/pm","grant/);
  assert.match(bridge,/WRITE_SECURE_SETTINGS/);
  assert.match(bridge,/"tcpip"/);
  assert.match(bridge,/persistent-adb\/bootstrap/);
});
