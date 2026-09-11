"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");

test("maintenance image builds the current Android agent from repository source",()=>{
  const docker=read("maintenance-agent/Dockerfile");
  assert.match(docker,/FROM eclipse-temurin:17-jdk-jammy AS android-agent-build/);
  assert.match(docker,/COPY agents\/android-tv/);
  assert.match(docker,/GRADLE_OPTS=.*-Xmx3072m/);
  assert.match(docker,/org\.gradle\.workers\.max=2/);
  assert.match(docker,/gradle :app:assembleRelease --no-daemon --stacktrace --max-workers=2/);
  assert.match(docker,/app-release-unsigned\.apk/);
  assert.match(docker,/aapt dump badging/);
  assert.match(docker,/COPY --from=android-agent-build .*agent-release-unsigned\.apk/);
  assert.match(docker,/ANDROID_AGENT_BUNDLE_APK/);
  assert.match(docker,/apksigner --version/);
});

test("maintenance compose build sees Android source and keeps persistent signing outside app data",()=>{
  const compose=read("docker-compose.yml");
  assert.doesNotMatch(compose,/^\s{2}android-agent-builder:/m);
  assert.match(compose,/maintenance-agent:\n\s+build:\n\s+context: \.\n\s+dockerfile: maintenance-agent\/Dockerfile/);
  assert.match(compose,/CLASSROOM_HUB_ANDROID_SIGNING_DIR:-\/etc\/classroom-control-hub\/android-agent-signing/);
  assert.match(compose,/android-agent-signing}:\/signing/);
  assert.equal((compose.match(/network_mode: host/g)||[]).length,2);
  assert.match(compose,/group_add:\n\s+- "10001"/);
  assert.match(compose,/cap_drop:\n\s+- ALL/);
});

test("hardened host-network smoke mirrors the production Android signing boundary",()=>{
  const smoke=read("tools/smoke-host-network.sh");
  assert.match(smoke,/mkdir -p [^\n]*\$work\/signing/);
  assert.match(smoke,/chmod 0700 [^\n]*\$work\/signing/);
  assert.match(smoke,/--group-add 10001/);
  assert.match(smoke,/-v "\$work\/signing:\/signing"/);
  assert.doesNotMatch(smoke,/chmod (?:0777|777) [^\n]*signing/);
});

test("maintenance startup signs, verifies and stages the image-matched APK",()=>{
  const extension=read("maintenance-agent/android-tv-agent-artifact.js");
  assert.match(extension,/ensureCurrentArtifact\(\);/);
  assert.match(extension,/RoomGoblin-Display-Agent\.keystore/);
  assert.match(extension,/crypto\.randomBytes\(24\)/);
  assert.match(extension,/keytool/);
  assert.match(extension,/apksigner/);
  assert.match(extension,/bundleSha256/);
  assert.match(extension,/persistent-per-appliance/);
  assert.match(extension,/maintenance-image-current-android-source/);
  assert.doesNotMatch(extension,/console\.(?:log|warn|error)[^\n]*password/i);
  const syntax=spawnSync(process.execPath,["--check",path.join(__dirname,"..","maintenance-agent/android-tv-agent-artifact.js")],{encoding:"utf8"});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
});

test("apksigner receives independent environment-backed store and key passwords",()=>{
  const extension=read("maintenance-agent/android-tv-agent-artifact.js");
  assert.match(extension,/CLASSROOM_HUB_APK_KS_PASS:password/);
  assert.match(extension,/CLASSROOM_HUB_APK_KEY_PASS:password/);
  assert.match(extension,/"--ks-pass","env:CLASSROOM_HUB_APK_KS_PASS"/);
  assert.match(extension,/"--key-pass","env:CLASSROOM_HUB_APK_KEY_PASS"/);
  assert.doesNotMatch(extension,/"--ks-pass",`file:\$\{PASSWORD_FILE\}`/);
  assert.doesNotMatch(extension,/"--key-pass",`file:\$\{PASSWORD_FILE\}`/);
});

test("artifact API handles signing transitions and the legacy package reinstall",()=>{
  const extension=read("maintenance-agent/android-tv-agent-artifact.js");
  assert.match(extension,/\/android\/agent\/artifact/);
  assert.match(extension,/\/agent\/artifact\/install/);
  assert.match(extension,/meta\.bundleSha256===bundleSha/);
  assert.match(extension,/signature_transition_required/);
  assert.match(extension,/legacy_package_reinstall_required/);
  assert.match(extension,/LEGACY_PACKAGE="org\.classroomhub\.display"/);
  assert.match(extension,/CURRENT_PACKAGE="org\.roomgoblin\.display"/);
  assert.match(extension,/replaceExisting/);
  assert.match(extension,/restoreTrustedGrants/);
  assert.match(extension,/WRITE_SECURE_SETTINGS/);
  assert.match(extension,/restoreAgentConfiguration/);
  assert.match(extension,/signerSha256/);
});

test("managed-display UI compares installed and staged agent versions",()=>{
  const ui=read("public/managed-displays/agent-v2-ui.js");
  assert.match(ui,/stagedArtifact/);
  assert.match(ui,/update available/);
  assert.match(ui,/Update Agent →/);
  assert.match(ui,/signature_transition_required/);
  assert.match(ui,/legacy_package_reinstall_required/);
  assert.match(ui,/reinstall, not an in-place update/);
  assert.match(ui,/persistent signing identity/);
  const syntax=spawnSync(process.execPath,["--check",path.join(__dirname,"..","public/managed-displays/agent-v2-ui.js")],{encoding:"utf8"});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
});
