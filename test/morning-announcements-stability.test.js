"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("receiver suppresses duplicate Morning Announcements teardown/reassert commands",()=>{
  const source=read("public/shared/attribution.js");
  assert.match(source,/duplicate-stream-reassert-suppressed/);
  assert.match(source,/duplicate-takeover-clear-suppressed/);
  assert.match(source,/morning-announcements-release/);
  assert.match(source,/window\.ClassroomStreamDiagnostics/);
  assert.match(source,/message\.meta\.stream=/);
});

test("integrated Ant Media player emits detailed telemetry and recovers in place",()=>{
  const source=read("public/antmedia-player/index.html");
  assert.match(source,/enableWorker:false/);
  assert.match(source,/classroom-hub\.antmedia\.telemetry/);
  assert.match(source,/Hls\.ErrorTypes\.NETWORK_ERROR/);
  assert.match(source,/hls\.startLoad\(\)/);
  assert.match(source,/Hls\.ErrorTypes\.MEDIA_ERROR/);
  assert.match(source,/hls\.recoverMediaError\(\)/);
  assert.match(source,/watchdog-recover/);
  assert.match(source,/bufferedAhead/);
  assert.match(source,/fragmentLoaded/);
  assert.match(source,/networkErrors/);
  assert.match(source,/mediaErrors/);
});

test("Morning Announcements documentation preserves transition-based monitoring contract",()=>{
  const operator=read("docs/MORNING-ANNOUNCEMENTS-DIAGNOSTICS.md");
  const ai=read("docs/AI-MORNING-ANNOUNCEMENTS.md");
  assert.match(operator,/successful probe: keep current player untouched/i);
  assert.match(operator,/six consecutive confirmed-offline/i);
  assert.match(operator,/window\.ClassroomStreamDiagnostics\(\)/);
  assert.match(ai,/must \*\*not\*\* re-send the active announcement takeover/i);
  assert.match(ai,/confirmed live -> confirmed live\s+: observe only/i);
});
