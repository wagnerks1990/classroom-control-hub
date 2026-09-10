"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("production startup preserves credential-bound display authentication",()=>{
  const recovery=read("src/startup-recovery.js");
  const compat=read("src/direct-display-compat.js");
  assert.doesNotMatch(recovery,/enableDirectDisplayAccess|authenticateConfiguredDisplay/);
  assert.doesNotMatch(compat,/authenticateDisplay|legacySharedTokenAllowed/);
  assert.match(compat,/installDisplayGatewayCompatibility/);
});

test("controller retains one-use, revocable display enrollment",()=>{
  const branding=read("public/shared/branding.js");
  const controller=read("public/controller/app.js");
  assert.doesNotMatch(branding,/window\.loadDisplayCredentialSecurity=loadDirectDisplayUrls/);
  assert.match(controller,/Create Link/);
  assert.match(controller,/revokeDisplayCredential/);
  assert.match(controller,/j\.enrollment\.url/);
});
