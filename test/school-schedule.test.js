"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  defaultSchoolScheduleProfile,
  legacySchoolScheduleProfile,
  normalizeSchoolScheduleProfile,
  effectiveTimesForRule,
  groupForCycleDay
}=require("../src/school-schedule");

test("fresh school profiles are generic and configurable",()=>{
  const profile=defaultSchoolScheduleProfile({anchorDate:"2027-08-23"});
  assert.deepEqual(profile.cycleDays,["A","B"]);
  assert.equal(profile.dayGroups[0].label,"Day A");
  assert.equal(profile.continuation.legacyBisonCompatibility,false);
  assert.equal(profile.anchorDate,"2027-08-23");
});

test("normalization rejects empty cycles and filters unknown group days",()=>{
  assert.throws(()=>normalizeSchoolScheduleProfile({cycleDays:[]}),/cycle day/i);
  const profile=normalizeSchoolScheduleProfile({
    cycleDays:["Blue","Gold"],
    dayGroups:[{id:"blue",label:"Blue Day",cycleDays:["Blue","Unknown"]}]
  });
  assert.deepEqual(profile.dayGroups[0].cycleDays,["Blue"]);
  assert.equal(groupForCycleDay(profile,"Blue").label,"Blue Day");
});

test("exception rules support explicit period times and proportional delays",()=>{
  const profile=normalizeSchoolScheduleProfile({
    cycleDays:["A"],dayGroups:[{id:"a",label:"Day A",cycleDays:["A"]}],
    exceptionRules:{
      "half-day":{periodTimes:{"Advisory":{startTime:"08:00",endTime:"08:30"}}},
      "delay":{transform:{normalStart:"08:00",normalEnd:"15:00",delayedStart:"10:00"}}
    }
  });
  assert.deepEqual(effectiveTimesForRule(profile,{period:"Advisory",startTime:"09:00",endTime:"10:00"},"half-day"),{startTime:"08:00",endTime:"08:30"});
  assert.deepEqual(effectiveTimesForRule(profile,{period:"1",startTime:"08:00",endTime:"09:00"},"delay"),{startTime:"10:00",endTime:"10:43"});
});

test("legacy behavior is isolated to imported profiles",()=>{
  const imported=legacySchoolScheduleProfile({});
  const fresh=defaultSchoolScheduleProfile();
  assert.equal(imported.continuation.legacyBisonCompatibility,true);
  assert.equal(fresh.continuation.legacyBisonCompatibility,false);
});
