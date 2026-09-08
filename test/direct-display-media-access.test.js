"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("direct displays receive signed media access without enrollment credential IDs",()=>{
  const compat=read("src/direct-display-compat.js");
  const server=read("src/server.js");
  const display=read("public/display/index.html");
  assert.match(compat,/prototype\.authenticateDisplay\s*=\s*authenticateConfiguredDisplay/);
  assert.match(compat,/authenticateConfiguredDisplay\.__directDisplayAccess\s*=\s*true/);
  assert.doesNotMatch(compat,/return\s*\{[^}]*id:\s*`direct:/s);
  assert.match(server,/issueAssetAccessToken\(deviceId,displayCredential\?\.id\|\|""\)/);
  assert.match(server,/if\(parts\[2\]===\"legacy\"\)return dbStore\.displayCredentialPolicy\(\)\.legacySharedTokenAllowed/);
  assert.match(display,/function authorizeAssetUrl\(value\)/);
  assert.match(display,/u\.searchParams\.set\('access_token',displayAuth\.assetAccessToken\)/);
});
