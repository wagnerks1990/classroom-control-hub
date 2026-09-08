"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("configured classroom displays use direct URL access",()=>{
  const recovery=read("src/startup-recovery.js");
  assert.match(recovery,/Direct display URL access enabled/);
  assert.match(recovery,/SELECT id,enabled FROM display_devices WHERE id=\?/);
  assert.match(recovery,/Configured display URL/);
  assert.match(recovery,/enableDirectDisplayAccess\(\)/);
});

test("controller replaces enrollment UX with direct display URLs",()=>{
  const branding=read("public/shared/branding.js");
  assert.match(branding,/Classroom Display URLs/);
  assert.match(branding,/No enrollment token is required/);
  assert.match(branding,/\/display\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(branding,/window\.loadDisplayCredentialSecurity=loadDirectDisplayUrls/);
});
