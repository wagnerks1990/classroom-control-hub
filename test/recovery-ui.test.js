"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const html=fs.readFileSync("public/controller/index.html","utf8");
const ui=fs.readFileSync("public/controller/app.js","utf8");
const server=fs.readFileSync("src/server.js","utf8");

test("controller recovery surface reports the release version",()=>{
  const version=fs.readFileSync("VERSION","utf8").trim().split(/\s+/)[0];
  assert.match(ui,new RegExp(`const CLASSROOM_HUB_VERSION='${version.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}'`));
});

test("full recovery creates an encrypted single-export bundle with ephemeral passphrase fields",()=>{
  assert.match(html,/<h2 class="sectionTitle">Full Recovery Export<\/h2>/);
  assert.match(html,/\.rgbak/);
  assert.match(html,/id="fullRecoveryExportPassphrase"[^>]+type="password"[^>]+minlength="16"[^>]+autocomplete="new-password"/);
  assert.match(html,/id="fullRecoveryExportConfirm"[^>]+type="password"/);
  assert.match(ui,/scope:'full',confirmSensitiveData:true,confirmSecrets:true,passphrase/);
  assert.match(ui,/j\.encrypted!==true/);
  assert.match(ui,/passField\.value=''/);
  assert.doesNotMatch(ui,/(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:passphrase|password)/i);
});

test("browser import authenticates a raw encrypted bundle without putting its passphrase in a URL",()=>{
  assert.match(html,/id="fullRecoveryImportFile"[^>]+accept="\.rgbak,application\/octet-stream"/);
  assert.match(html,/Import &amp; Verify Bundle/);
  assert.match(ui,/maintApi\('\/backup\/import',[\s\S]*?'X-Recovery-Passphrase':passphrase[\s\S]*?body:file/);
  assert.doesNotMatch(ui,/encodeURIComponent\(passphrase\)/);
  assert.match(ui,/fileField\.value=''/);
});

test("catalog unlock and destructive restore require verification and exact typed confirmation",()=>{
  for(const label of ["SQLite database","RoomGoblin data","Managed services","Recovery secrets"]){
    assert.ok(ui.includes(label),`missing backup capability label: ${label}`);
  }
  assert.match(ui,/Unlock Full Recovery/);
  assert.match(html,/Unlock &amp; Verify Recovery Plan/);
  assert.match(html,/RESTORE_FULL_RECOVERY/);
  assert.match(ui,/FULL_RECOVERY_VERIFIED!==FULL_RECOVERY_SELECTED/);
  assert.match(ui,/mode:'full-recovery',confirm:'RESTORE_FULL_RECOVERY',passphrase/);
  assert.match(ui,/const recoveryId=rememberRecoveryId\(j\.recoveryId\)/);
});

test("legacy partial restore remains available and clearly separate",()=>{
  assert.match(ui,/Restore Database<\/button>/);
  assert.match(ui,/Restore Database \+ RoomGoblin Data<\/button>/);
  assert.match(ui,/mode==='configuration'/);
  assert.match(ui,/confirm:'RESTORE'/);
});

test("client and server enforce HTTPS or direct loopback before handling recovery secrets",()=>{
  assert.match(ui,/location\.protocol==='https:'/);
  assert.match(ui,/ensureFullRecoveryTransport/);
  assert.match(server,/requireFullRecoveryTransport/);
  assert.match(server,/status\(426\)/);
  assert.match(server,/trustProxyHops:TRUST_PROXY_HOPS/);
});

test("restart-safe public status stores only an unguessable id and supports reconnect and relogin",()=>{
  assert.match(ui,/sessionStorage\.setItem\(FULL_RECOVERY_STATUS_KEY,String\(value\)\)/);
  assert.match(ui,/\/api\/v1\/recovery-status\/\$\{encodeURIComponent\(recoveryId\)\}/);
  assert.match(ui,/temporarily unavailable while recovery runs\. Retrying/);
  assert.match(ui,/Sign in again to verify the restored appliance/);
  assert.match(server,/auditPath=req\.path\.startsWith\("\/api\/v1\/recovery-status\/"\)\?"\/api\/v1\/recovery-status\/:recoveryId"/);
  assert.match(server,/boundedRecoveryStatus\(upstream,recoveryId\)/);
});
