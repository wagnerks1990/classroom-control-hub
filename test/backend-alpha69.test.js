"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {validDateKey,validTime}=require("../src/school-schedule");
const {ClassroomHubStorage}=require("../src/storage");

test("strict school clocks and calendar dates reject normalized-looking garbage",()=>{
  assert.equal(validTime("23:59"),true);
  assert.equal(validTime("24:00"),false);
  assert.equal(validTime("09:60"),false);
  assert.equal(validDateKey("2028-02-29"),true);
  assert.equal(validDateKey("2027-02-29"),false);
  assert.equal(validDateKey("2026-13-01"),false);
});

test("SQLite health includes integrity, writability, and WAL-aware sizes",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"classroom-hub-alpha69-"));
  const dbFile=path.join(dir,"hub.db"),store=new ClassroomHubStorage({dataDir:dir,dbFile,masterKeyFile:path.join(dir,"missing-key")});
  try{
    const health=store.healthCheck(),info=store.databaseInfo();
    assert.equal(health.ok,true);
    assert.equal(health.quickCheck,"ok");
    assert.equal(health.foreignKeyErrors,0);
    assert.equal(info.size,Object.values(info.fileSizes).reduce((sum,n)=>sum+n,0));
  }finally{store.db.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test("backend keeps validated changes atomic and retires the site-specific session",()=>{
  const source=fs.readFileSync(path.join(__dirname,"..","src","server.js"),"utf8");
  assert.match(source,/function commitClassSchedules\(next\)\{persistJson\(CLASS_SCHEDULES_FILE,next\);classScheduleStore=next/);
  assert.match(source,/function commitAutomations\(next\)\{persistJson\(AUTOMATIONS_FILE,next\);classroomAutomations=next/);
  assert.match(source,/if\(!AUTOMATION_ACTIONS\.has\(action\)\)throw new Error/);
  assert.match(source,/Legacy anonymous classroom participation has been retired/);
  assert.doesNotMatch(source,/MR\. WAGNER|L-127|it1-opening|\/opening-day\//i);
});
