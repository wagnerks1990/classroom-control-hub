"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("manual display media exposes explicit playback volume",()=>{
  const helper=read("public/shared/manual-media-volume.js");
  const attribution=read("public/shared/attribution.js");
  const receiver=read("public/display/index.html");
  assert.match(attribution,/manual-media-volume\.js/);
  assert.match(helper,/id=\"mediaVolume\"/);
  assert.match(helper,/type=\"range\" min=\"0\" max=\"100\"/);
  assert.match(helper,/volume,\n\s*\.\.\.\(isWeb\?\{forceAudio:volume>0\}/);
  assert.match(helper,/muted:muted\.checked\|\|volume<=0/);
  assert.match(receiver,/n\.volume=Math\.max\(0,Math\.min\(1,Number\(m\.volume\?\?1\)\)\)/);
});
