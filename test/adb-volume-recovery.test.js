"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

test("installer creates an owned ADB volume and seeds only a complete safe legacy identity",()=>{
  const source=fs.readFileSync("install.sh","utf8");
  const compose=fs.readFileSync("docker-compose.yml","utf8");
  assert.match(source,/ADB_VOLUME=classroom-control-hub-android-adb/);
  assert.match(source,/docker volume create --label org\.roomgoblin\.deployment-ownership=roomgoblin/);
  assert.match(source,/Existing ADB volume is not owned by RoomGoblin/);
  assert.match(source,/LEGACY_ADB_PRIVATE_PRESENT/);
  assert.match(source,/LEGACY_ADB_PUBLIC_PRESENT/);
  assert.match(source,/Legacy ADB identity is incomplete/);
  assert.match(source,/Existing ADB volume contains an incomplete or unsafe identity/);
  assert.match(source,/\[\[ -f "\$legacy_identity" && ! -L "\$legacy_identity" \]\]/);
  assert.match(compose,/classroom-hub-android-adb:\/app\/data\/android-tv\/\.android/);
});

test("recovery restricts the ADB mountpoint to the exact owned named volume",()=>{
  const source=fs.readFileSync("host-agent/full_recovery.py","utf8");
  assert.match(source,/mount\.name == "_data"/);
  assert.match(source,/mount\.parent\.name == volume/);
  assert.match(source,/mount\.parent\.parent == docker_volumes_root/);
  assert.match(source,/org\.roomgoblin\.deployment-ownership/);
  assert.match(source,/ADB private\/public trust identity does not match/);
});
