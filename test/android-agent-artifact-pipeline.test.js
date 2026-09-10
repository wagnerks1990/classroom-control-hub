"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");

test("Android agent builder uses current source and persistent signing storage",()=>{
  const compose=read("docker-compose.yml");
  const builder=read("agents/android-tv/Dockerfile.builder");
  const stage=read("agents/android-tv/stage-current.sh");
  assert.match(compose,/android-agent-builder:/);
  assert.match(compose,/condition: service_completed_successfully/);
  assert.match(compose,/android-agent-signing/);
  assert.match(compose,/pull_policy: build/);
  assert.match(builder,/stage-current-android-agent/);
  assert.match(stage,/ClassroomHub-Display-Agent\.keystore/);
  assert.match(stage,/keytool -genkeypair/);
  assert.match(stage,/signingMode.*persistent-per-appliance/s);
  assert.match(stage,/sourceDigest/);
  assert.match(stage,/apksigner verify/);
});

test("Android Gradle build accepts the appliance-managed signing identity",()=>{
  const gradle=read("agents/android-tv/app/build.gradle.kts");
  assert.match(gradle,/CLASSROOM_HUB_ANDROID_KEYSTORE/);
  assert.match(gradle,/CLASSROOM_HUB_ANDROID_STORE_PASSWORD/);
  assert.match(gradle,/signingConfigs/);
  assert.match(gradle,/getByName\("managed"\)/);
});

test("maintenance exposes verified staged metadata and explicit signature transition",()=>{
  const docker=read("maintenance-agent/Dockerfile");
  const extension=read("maintenance-agent/android-tv-agent-artifact.js");
  assert.match(docker,/android-tv-agent-artifact\.js/);
  assert.match(extension,/\/android\/agent\/artifact/);
  assert.match(extension,/\/agent\/artifact\/install/);
  assert.match(extension,/signature_transition_required/);
  assert.match(extension,/replaceExisting/);
  assert.match(extension,/restoreAgentConfiguration/);
  assert.match(extension,/signerSha256/);
  const syntax=spawnSync(process.execPath,["--check",path.join(__dirname,"..","maintenance-agent/android-tv-agent-artifact.js")],{encoding:"utf8"});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
});

test("managed-display UI compares installed and staged agent versions",()=>{
  const ui=read("public/managed-displays/agent-v2-ui.js");
  assert.match(ui,/stagedArtifact/);
  assert.match(ui,/update available/);
  assert.match(ui,/Update Agent →/);
  assert.match(ui,/signature_transition_required/);
  assert.match(ui,/persistent signing identity/);
  const syntax=spawnSync(process.execPath,["--check",path.join(__dirname,"..","public/managed-displays/agent-v2-ui.js")],{encoding:"utf8"});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
});
