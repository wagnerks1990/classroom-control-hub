"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const source=fs.readFileSync(path.join(__dirname,"..","src","server.js"),"utf8");

test("student browser history is explicit opt-in and supports zero retention",()=>{
  assert.match(source,/browserHistoryEnabled:p\.browserHistoryEnabled===true/);
  assert.match(source,/LAB_HISTORY_RETENTION_HOURS \|\| 0/);
  assert.match(source,/historyPollSeconds:privacy\.browserHistoryEnabled\?30:0/);
  assert.match(source,/if\(!policy\.browserHistoryEnabled\|\|policy\.browserHistoryHours===0\)return/);
});

test("ordinary lab inventory does not expose history or screenshot details",()=>{
  assert.match(source,/function publicLabComputer\(id,\{sensitive=false\}=\{\}\)/);
  assert.match(source,/delete result\.screenshotFile/);
  assert.match(source,/if\(sensitive\)\{result\.latestWebsite=/);
});

test("controller sockets enforce current permissions and filter sensitive lab events",()=>{
  assert.match(source,/sensitive&&!hasCapability\(user,"lab\.sensitive\.read"\)/);
  assert.match(source,/Session expired or revoked/);
  assert.match(source,/Permission required: classroom\.read/);
});

test("login and socket abuse controls and JPEG validation remain enabled",()=>{
  assert.match(source,/LOGIN_DUMMY_HASH=crypto\.scryptSync/);
  assert.match(source,/function loginAddressKey/);
  assert.match(source,/WS_MAX_CONNECTIONS_PER_IP/);
  assert.match(source,/Screenshot is not a valid JPEG image/);
  assert.match(source,/fs\.writeFileSync\(full,bytes,\{mode:0o600\}\)/);
});
