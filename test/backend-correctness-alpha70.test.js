"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { defaultSchoolScheduleProfile, normalizeSchoolScheduleProfile } = require("../src/school-schedule");

const serverSource = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");

test("schedule profiles reject non-finite continuation gaps without persisting NaN", () => {
  const profile = normalizeSchoolScheduleProfile(
    { continuation: { maximumGapMinutes: "not-a-number" } },
    defaultSchoolScheduleProfile()
  );
  assert.equal(profile.continuation.maximumGapMinutes, 15);
  assert.equal(Number.isFinite(profile.continuation.maximumGapMinutes), true);
});

test("class-relative automation occurrences retain their scheduled calendar date", () => {
  assert.match(serverSource, /const dayOffset=Math\.floor\(rawMinutes\/1440\)/);
  assert.match(serverSource, /_scheduledDateKey:localDateKey\(scheduledDate\)/);
  assert.match(serverSource, /referenceDates=\[-1,0,1\]/);
  assert.match(serverSource, /filter\(event=>event\._scheduledDateKey===dateKey\)/);
});

test("alternating schedules use their configured anchor", () => {
  assert.match(serverSource, /function classAlternatingPhaseForDate\(anchorDate,date=new Date\(\)\)/);
  assert.match(serverSource, /dateFromKey\(validDateKey\(anchorDate\)\?anchorDate:schoolCycleAnchor\(\)\)/);
  assert.match(serverSource, /classAlternatingPhaseForDate\(cls\.anchorDate,date\)/);
});

test("manual automation failures and partial results are persisted", () => {
  assert.match(serverSource, /ok:result\.ok!==false,manual:true/);
  assert.match(serverSource, /if\(event\)\{event\.lastRun=\{at:new Date\(\)\.toISOString\(\),ok:false,manual:true,message:err\.message\}/);
});

test("overnight music windows evaluate policy against their starting day", () => {
  assert.match(serverSource, /if\(a>b&&n<b\)scheduleDate\.setDate\(scheduleDate\.getDate\(\)-1\)/);
  assert.match(serverSource, /cfg\.days\.includes\(scheduleDate\.getDay\(\)\)/);
  assert.match(serverSource, /isAutomationSuppressed\(scheduleDate\)/);
});

test("presentation rebuild and recurring callbacks are single-flight and guarded", () => {
  assert.match(serverSource, /const presentationBuilds=new Map\(\)/);
  assert.match(serverSource, /if\(presentationBuilds\.has\(key\)\)return presentationBuilds\.get\(key\)/);
  assert.match(serverSource, /presentationAutoAdvanceBusy/);
  assert.match(serverSource, /operation:"periodic-prune"/);
});

