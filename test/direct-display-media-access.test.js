"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("configured and credentialed displays receive policy-bound signed media access",async()=>{
  const compat=read("src/direct-display-compat.js");
  const server=read("src/server.js");
  const display=read("public/display/index.html");
  assert.doesNotMatch(compat,/authenticateConfiguredDisplay|prototype\.authenticateDisplay/);
  assert.match(server,/issueAssetAccessToken\(deviceId,displayCredential\?\.id\|\|""\)/);
  assert.match(server,/if\(parts\[2\]==="direct"\)return !policy\.authenticationRequired/);
  assert.match(display,/function authorizeAssetUrl\(value\)/);
  assert.match(display,/authorizeMediaUrl\(value,location\.origin,displayAuth\.assetAccessToken\)/);
  // Exercise the policy module, rather than requiring token injection to remain
  // inline in the renderer. Local protected assets need the token; external
  // signage and executable URLs must never receive it.
  const {authorizeMediaUrl}=await import("../public/display/security.mjs");
  const origin="https://hub.example.test";
  const token="fixture-signed-token";
  for(const asset of ["/media/lesson.png","/presentations/slide.jpg"]){
    const authorized=new URL(authorizeMediaUrl(asset,origin,token));
    assert.equal(authorized.origin,origin);
    assert.equal(authorized.searchParams.get("access_token"),token);
  }
  const viewer=new URL(authorizeMediaUrl("/document-viewer/?file=%2Fmedia%2Flesson.pdf",origin,token));
  assert.equal(new URL(viewer.searchParams.get("file")).searchParams.get("access_token"),token);
  assert.equal(new URL(authorizeMediaUrl("https://signage.example.test/media/lesson.png",origin,token)).searchParams.has("access_token"),false);
  assert.throws(()=>authorizeMediaUrl("javascript:alert(1)",origin,token));
});
