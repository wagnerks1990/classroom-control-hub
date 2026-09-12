"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {JsonStore}=require("../maintenance-agent/android-tv-lib");
const {parseMdnsConnectEndpoints,sameAndroidIdentity}=require("../maintenance-agent/android-tv-extension");

const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");

test("ADB configuration receiver rejects ordinary apps while preserving the shell delivery contract",()=>{
  const manifest=read("agents/android-tv/app/src/main/AndroidManifest.xml");
  const bridges=[
    read("maintenance-agent/android-tv-agent-v2.js"),
    read("maintenance-agent/android-tv-persistent-adb.js"),
    read("maintenance-agent/android-tv-extension.js")
  ].join("\n");
  assert.match(manifest,/android:name="\.ConfigReceiver"[\s\S]*android:exported="true"[\s\S]*android:permission="android\.permission\.DUMP"/);
  assert.match(bridges,/"shell","am","broadcast","-a","org\.roomgoblin\.display\.CONFIGURE","-p",pkg/);
});

test("Device Agent listener has bounded clients, queue, headers, and idle time",()=>{
  const service=read("agents/android-tv/app/src/main/java/org/roomgoblin/display/AgentService.java");
  assert.match(service,/new ThreadPoolExecutor\(/);
  assert.match(service,/MAX_CLIENT_WORKERS=8/);
  assert.match(service,/new ArrayBlockingQueue<>\(MAX_QUEUED_CLIENTS\)/);
  assert.match(service,/CLIENT_TIMEOUT_MS=5000/);
  assert.match(service,/MAX_HEADER_LINES=32/);
  assert.match(service,/catch\(RejectedExecutionException busy\)/);
  assert.doesNotMatch(service,/newCachedThreadPool/);
});

test("staged APK is reverified against the protected keystore at use time",()=>{
  const source=read("maintenance-agent/android-tv-agent-artifact.js");
  assert.match(source,/function signingIdentityDigest\(password\)/);
  assert.match(source,/"-exportcert"[\s\S]*"-storepass:env","CLASSROOM_HUB_KEYSTORE_PASS"/);
  assert.match(source,/crypto\.createHash\("sha256"\)\.update\(certificate\)/);
  assert.match(source,/const actualSigner=signerDigest\(APK\)/);
  assert.match(source,/actualSigner===expectedSigner/);
  assert.match(source,/meta\.signerSha256===actualSigner/);
  assert.match(source,/\.verified-install-/);
  assert.match(source,/installSigner!==expectedSigner/);
  assert.match(source,/"install","-r","-g",installCopy/);
  assert.match(source,/fs\.rmSync\(installCopy,\{force:true\}\)/);
  assert.doesNotMatch(source,/\/\^\[0-9a-f\]\{64\}\$\/i\.test\(String\(meta\.signerSha256/);
});

test("Android signing identity uses the same nested layout as Full Recovery",()=>{
  const artifact=read("maintenance-agent/android-tv-agent-artifact.js");
  const recovery=read("maintenance-agent/server.js");
  assert.match(artifact,/const SIGNING_ROOT=path\.join\(SIGNING_MOUNT_ROOT,"android-agent"\)/);
  assert.match(artifact,/function migrateLegacySigningIdentity\(\)/);
  assert.match(artifact,/fs\.renameSync\(legacyKey,KEYSTORE\);fs\.renameSync\(legacyPassword,PASSWORD_FILE\)/);
  assert.match(artifact,/Conflicting Android signing identities exist/);
  assert.match(recovery,/path\.join\(SIGNING_ROOT,"android-agent","RoomGoblin-Display-Agent\.keystore"\)/);
});

test("mDNS recovery records and requires a stable Android identity across DHCP changes",t=>{
  const endpoints=parseMdnsConnectEndpoints([
    "adb-ONE._adb-tls-connect._tcp. 192.0.2.41:38101",
    "adb-TWO._adb-tls-connect._tcp. 192.0.2.87:39202"
  ].join("\n"));
  assert.deepEqual(endpoints.map(x=>x.serial),["192.0.2.41:38101","192.0.2.87:39202"]);
  assert.equal(sameAndroidIdentity({androidId:"0123456789abcdef"},{androidId:"0123456789ABCDEF"}),true);
  assert.equal(sameAndroidIdentity({androidId:"0123456789abcdef"},{androidId:"fedcba9876543210"}),false);
  assert.equal(sameAndroidIdentity({fingerprint:"same-build"},{fingerprint:"same-build"}),false,"a non-unique build fingerprint must not authorize reassignment");
  const recoverySource=read("maintenance-agent/android-tv-extension.js");
  assert.match(recoverySource,/probe\(d\.serial\);if\(!d\.androidId\|\|sameAndroidIdentity\(d,status\)\)return/);
  assert.match(recoverySource,/discoverConnectEndpointByIdentity\(d/);

  const temp=fs.mkdtempSync(path.join(require("node:os").tmpdir(),"roomgoblin-android-id-"));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const store=new JsonStore(temp);
  store.upsertDevice({id:"tv-1",host:"192.0.2.41",port:38101,serial:"192.0.2.41:38101",androidId:"0123456789ABCDEF"});
  assert.equal(store.getDevice("tv-1").androidId,"0123456789abcdef");
});
