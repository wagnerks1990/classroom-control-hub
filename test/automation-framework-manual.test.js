"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const server=fs.readFileSync("src/server.js","utf8");
const controller=fs.readFileSync("public/controller/app.js","utf8");

test("manual automation tests do not weaken scheduled class-date enforcement",()=>{
  assert.match(server,/async function runAutomationTimerOverlay\(event,\{manual=false\}=\{\}\)/);
  assert.match(server,/if\(!manual&&!classScheduleMatchesDate\(cls,now\)\)/);
  assert.match(server,/runAutomationTimerOverlay\(event,\{manual\}\)/);
  assert.match(server,/resolveAutomationForManualTest\(event\)/);
});

test("class default display targets are framework-level and cross-domain",()=>{
  assert.match(server,/_classDefaultTargets:\[\.\.\.\(cls\.defaultTargets\|\|\[\]\)\]/);
  assert.match(server,/stepDomain==="display"&&event\.useClassTargets!==false&&Array\.isArray\(event\._classDefaultTargets\)/);
  assert.match(server,/const timerTargetSource=\(event\.useClassTargets!==false&&Array\.isArray\(event\._classDefaultTargets\)/);
  assert.match(controller,/useClassTargets:autoUseClassTargets\.checked/);
  assert.match(controller,/autoUseClassTargets\.checked=e\.useClassTargets!==false/);
});

test("alternating automation anchor follows the authoritative school profile",()=>{
  assert.match(controller,/anchorDate:mode==='alternating'\?\(S\.scheduleProfile\?\.anchorDate\|\|currentScheduleData\.anchorDate\|\|''\):''/);
  assert.doesNotMatch(controller,/getElementById\('autoAnchorDate'\)/);
});

test("Test Now and persisted run summaries expose action-level failures",()=>{
  assert.match(server,/function automationRunFailures\(result=\{\}\)/);
  assert.match(server,/failures:automationRunFailures\(result\)/);
  assert.match(server,/failures:automationRunFailures\(runResult\)/);
  assert.match(controller,/function automationRunFailureSummary\(result=\{\}\)/);
  assert.match(controller,/Test completed with errors:/);
});
