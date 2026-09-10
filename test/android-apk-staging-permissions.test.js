"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const compose=fs.readFileSync("docker-compose.yml","utf8");

test("maintenance container joins shared application data group",()=>{
  const section=compose.slice(compose.indexOf("  maintenance-agent:"));
  assert.match(section,/group_add:\s*\n\s*- ["']?10001["']?/);
});

test("maintenance healthcheck verifies staged Android agent APK readability",()=>{
  const section=compose.slice(compose.indexOf("  maintenance-agent:"));
  assert.match(section,/ClassroomHub-Display-Agent\.apk/);
  assert.match(section,/fs\.accessSync\(apk,fs\.constants\.R_OK\)/);
});
