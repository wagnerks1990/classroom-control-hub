"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const stub=fs.readFileSync("public/managed-displays/kiosk-clean-mode.js","utf8");
const app=fs.readFileSync("public/managed-displays/app.js","utf8");
const html=fs.readFileSync("public/managed-displays/index.html","utf8");

test("obsolete kiosk cleanup loader remains an inert compatibility stub",()=>{
  assert.doesNotMatch(html,/kiosk-clean-mode\.js/);
  assert.doesNotMatch(stub,/addEventListener|fetch\(|pm (?:uninstall|disable|enable|list)/);
});

test("one reversible Minimal Mode owner disables and restores third-party apps",()=>{
  assert.match(app,/async function enableMinimalMode/);
  assert.match(app,/pm disable-user --user 0/);
  assert.match(app,/async function restoreApps/);
  assert.match(app,/pm enable/);
  assert.match(app,/org\.roomgoblin\.display/);
  assert.doesNotMatch(app,/pm uninstall --user 0/);
});
