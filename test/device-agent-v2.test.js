"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {spawnSync}=require("node:child_process");

const read=p=>fs.readFileSync(p,"utf8");

test("Device Agent v2 maintenance bridge parses",()=>{
  const r=spawnSync(process.execPath,["--check","maintenance-agent/android-tv-agent-v2.js"],{encoding:"utf8"});
  assert.equal(r.status,0,r.stderr||r.stdout);
});

test("maintenance image loads Device Agent v2 bridge",()=>{
  const docker=read("maintenance-agent/Dockerfile");
  assert.match(docker,/COPY android-tv-agent-v2\.js/);
  assert.match(docker,/--require=\/app\/android-tv-agent-v2\.js/);
});

test("Device Agent v2 keeps the existing package identity",()=>{
  const gradle=read("agents/android-tv/app/build.gradle.kts");
  assert.match(gradle,/applicationId = "org\.classroomhub\.display"/);
  assert.match(gradle,/versionCode = 3/);
  assert.match(gradle,/versionName = "0\.2\.1-agent-v2"/);
});

test("Device Agent v2 declares durable boot and foreground service",()=>{
  const manifest=read("agents/android-tv/app/src/main/AndroidManifest.xml");
  assert.match(manifest,/android\.intent\.action\.LOCKED_BOOT_COMPLETED/);
  assert.match(manifest,/android\.intent\.action\.BOOT_COMPLETED/);
  assert.match(manifest,/android:name="\.AgentService"/);
  assert.match(manifest,/foregroundServiceType="specialUse"/);
});

test("Device Agent v2 control channel requires per-device authentication",()=>{
  const service=read("agents/android-tv/app/src/main/java/org/classroomhub/display/AgentService.java");
  assert.match(service,/x-classroom-hub-agent-token/);
  assert.match(service,/MessageDigest\.isEqual/);
  assert.doesNotMatch(service,/authorized\([^)]*\)\s*\{[^}]*return true;\s*\}/s);
});

test("Device Agent v2 exposes stock, accessibility, device-owner, local ADB and root tiers",()=>{
  const caps=read("agents/android-tv/app/src/main/java/org/classroomhub/display/AgentCapabilities.java");
  for(const capability of ["bootAutoStart","agentHttpApi","globalNavigation","deviceOwnerProvisioning","localAdbPairing","wirelessAdbDiscovery","legacyAdbPortSwitch","rootProbe"]){
    assert.match(caps,new RegExp(`\\"${capability}\\"`));
  }
});

test("local ADB recovery is first-party and root is policy gated",()=>{
  const service=read("agents/android-tv/app/src/main/java/org/classroomhub/display/AgentService.java");
  const root=read("agents/android-tv/app/src/main/java/org/classroomhub/display/RootTools.java");
  assert.match(service,/local-adb-pair/);
  assert.match(service,/local-adb-connect/);
  assert.match(service,/local-adb-self-grant/);
  assert.match(service,/local-adb-switch-port/);
  assert.match(root,/allow_root_tools/);
  assert.match(root,/Root tools are disabled by Classroom Hub policy/);
});

test("browser receives redacted Agent v2 configuration",()=>{
  const bridge=read("maintenance-agent/android-tv-agent-v2.js");
  assert.match(bridge,/token:\"configured\"/);
  assert.doesNotMatch(bridge,/res\.json\([^\n]*agentToken/);
});

test("Device Agent v2 architecture and wiki are documented",()=>{
  const docs=read("docs/DEVICE-AGENT-V2.md");
  const wiki=read("wiki/Device-Agent-v2.md");
  assert.match(docs,/capability-discovery build/i);
  assert.match(docs,/Root is \*\*not\*\* a production requirement/);
  assert.match(docs,/libadb-android/);
  assert.match(wiki,/dual-channel design/);
});
