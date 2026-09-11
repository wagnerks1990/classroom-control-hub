"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const html=fs.readFileSync("public/controller/index.html","utf8");
const ui=fs.readFileSync("public/controller/app.js","utf8");

test("full recovery is the primary single-export action",()=>{
  assert.match(html,/<h2 class="sectionTitle">Full Recovery Export<\/h2>/);
  assert.match(html,/Create & Download Full Recovery Export/);
  assert.match(html,/single portable archive/);
  assert.match(html,/SQLite database/);
  assert.match(html,/managed-service state/);
  assert.match(html,/encryption master key/);
  assert.match(ui,/function createFullRecoveryExport\(\)\{return createManagedBackup\('full',\{download:true\}\)\}/);
});

test("full recovery export requires separate data and secrets confirmations",()=>{
  assert.match(ui,/A Full Recovery Export contains private appliance data/);
  assert.match(ui,/also contains protected recovery secrets/);
  assert.match(ui,/confirmSensitiveData:sensitive,confirmSecrets:full/);
  assert.match(ui,/downloadManagedBackup\(j\.name,true,true\)/);
});

test("recovery catalog presents manifest capabilities and only implemented restore modes",()=>{
  for(const label of ["SQLite database","RoomGoblin data","Managed services","Recovery secrets"]){
    assert.ok(ui.includes(label),`missing backup capability label: ${label}`);
  }
  assert.match(ui,/Restore Database<\/button>/);
  assert.match(ui,/Restore Database \+ RoomGoblin Data<\/button>/);
  assert.match(ui,/Secrets\/services are export-only here/);
  assert.match(ui,/does not restore recovery secrets or managed-service state/);
  assert.doesNotMatch(ui,/>Full Recovery Restore<\/button>/);
});

test("controller does not advertise an unsupported browser import",()=>{
  assert.match(html,/Browser upload\/import and complete clean-host restoration[^<]+not implemented/);
  assert.doesNotMatch(html,/id="backupImport/);
  assert.doesNotMatch(html,/<button[^>]*>Import Full Recovery<\/button>/);
});
