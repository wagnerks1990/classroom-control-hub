"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const ui=fs.readFileSync("public/managed-displays/kiosk-clean-mode.js","utf8");

test("kiosk audit inventories all packages without dumpsys package",()=>{
  assert.match(ui,/pm list packages/);
  assert.match(ui,/===== ALL PACKAGES =====/);
  assert.doesNotMatch(ui,/dumpsys package/);
});

test("kiosk clean mode removes user apps and preserves Classroom Hub agent",()=>{
  assert.match(ui,/pm uninstall --user 0/);
  assert.match(ui,/org\.classroomhub\.display/);
  assert.match(ui,/com\.google\.android\.youtube\.tv/);
  assert.match(ui,/com\.google\.android\.youtube\.tvmusic/);
  assert.match(ui,/com\.netflix\.ninja/);
});
