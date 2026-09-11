"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {ClassroomHubStorage}=require("../src/storage");

const root=path.resolve(__dirname,"..");
const server=fs.readFileSync(path.join(root,"src/server.js"),"utf8");

test("Morning Announcements hold audio priority through display resynchronization",()=>{
  const release=server.slice(server.indexOf("async function releaseMorningAnnouncements"),server.indexOf("let morningAnnouncementsTickBusy"));
  assert.ok(release.indexOf("await resyncCurrentDisplayAutomationsAfterAnnouncements")<release.indexOf("await setMorningAnnouncementPriorityTargets(targets,false)"));
  assert.match(release,/await setMorningAnnouncementPriorityTargets\(targets,false\)/);
  assert.match(release,/finally\{/);
  const start=server.slice(server.indexOf("async function assertMorningAnnouncements"),server.indexOf("function queueAutomationDuringAnnouncements"));
  assert.ok(start.indexOf("morningAnnouncementsRuntime.active=true")<start.indexOf('type:"display.clear"'));
  assert.ok(start.indexOf("const priorityTask=setMorningAnnouncementPriorityTargets(targets,true)")<start.indexOf('type:"display.clear"'));
  assert.match(start,/await priorityTask/);
});

test("post-announcement resync applies each candidate only to targets it won",()=>{
  assert.match(server,/for\(const \[target,candidate\] of winnersByTarget\)/);
  assert.match(server,/winningTargets:\[\]/);
  assert.match(server,/runDisplayAutomationResync\(candidate\.event,candidate\.winningTargets\)/);
  assert.match(server,/automationDisplayTargets\(rawTargets\)\.filter\(id=>allowed\.has\(id\)\)/);
});

test("priority audio reconciliation observes Music Assistant instead of trusting restart-local flags",()=>{
  const reconcile=server.slice(server.indexOf("async function backgroundMusicReconcilePriority"),server.indexOf("function backgroundMusicObserveDisplayCommand"));
  assert.match(reconcile,/backgroundMusicActualPlayerState\(cfg,true\)/);
  assert.match(reconcile,/if\(!force&&!cfg\.pauseForPriorityAudio\)return/);
  assert.match(server,/backgroundMusicReconcilePriority\(\{force:true\}\)/);
  assert.match(reconcile,/if\(priority&&backgroundMusicRuntime\.playing\)/);
  assert.doesNotMatch(reconcile,/priority&&backgroundMusicRuntime\.scheduleActive&&backgroundMusicRuntime\.playing/);
  assert.doesNotMatch(reconcile,/!priority&&backgroundMusicRuntime\.scheduleActive&&backgroundMusicRuntime\.pausedForPriority/);
});

test("calendar and schedule profile persist in one SQLite transaction",()=>{
  const route=server.slice(server.indexOf('app.put("/api/v1/automations/calendar"'),server.indexOf("function timeToMinutes",server.indexOf('app.put("/api/v1/automations/calendar"')));
  assert.match(route,/dbStore\.tx\(\(\)=>\{/);
  assert.ok(route.indexOf('dbStore.setPreference("school.schedule.profile"')>route.indexOf("dbStore.tx"));
  assert.ok(route.indexOf("persistJson(SCHEDULER_CALENDAR_FILE,nextCalendar)")>route.indexOf("dbStore.tx"));
});

test("storage preserves the shared data mode and points fresh sites at a packaged favicon",t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"roomgoblin-storage-contract-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const key=path.join(dir,"master.key");
  fs.writeFileSync(key,"11".repeat(32),{mode:0o600});
  const store=new ClassroomHubStorage({dataDir:dir,dbFile:path.join(dir,"hub.db"),masterKeyFile:key});
  t.after(()=>store.db.close());
  assert.equal(fs.statSync(dir).mode&0o777,0o770);
  const favicon=store.getAdminConfig().site.faviconUrl;
  assert.equal(favicon,"/brand/roomgoblin_app_32x32.png");
  assert.equal(fs.existsSync(path.join(root,"public",favicon)),true);
});

test("update policy canonicalizes the legacy repository name to RoomGoblin",()=>{
  assert.match(server,/const TRUSTED_UPDATE_REPOSITORY="wagnerks1990\/RoomGoblin"/);
  assert.match(server,/LEGACY_TRUSTED_UPDATE_REPOSITORIES=new Set\(\["wagnerks1990\/classroom-control-hub"\]\)/);
  assert.match(server,/repository:TRUSTED_UPDATE_REPOSITORY/);
});

test("timer overlays reject non-finite fields before persistence, replay, or delivery",()=>{
  const normalizer=server.slice(server.indexOf("function finiteTimerOverlayNumber"),server.indexOf("function automationTargetDomain"));
  assert.match(normalizer,/Number\.isFinite\(candidate\)/);
  for(const field of ["durationSeconds","fontSize","borderWidth","borderRadius","followGapMinutes"]){
    assert.match(normalizer,new RegExp(`${field}:finiteTimerOverlayNumber`));
  }
  assert.match(normalizer,/timerOverlay:normalizeTimerOverlay\(input\.timerOverlay/);
  const run=server.slice(server.indexOf("async function runClassroomAutomation"),server.indexOf("function safeStoredName"));
  assert.ok(run.indexOf("normalizeTimerOverlay")<run.indexOf("displayScope"));
  const resync=server.slice(server.indexOf("async function runDisplayAutomationResync"),server.indexOf("function consumeDeferredAnnouncementAutomations"));
  assert.ok(resync.indexOf("normalizeTimerOverlay")<resync.indexOf('type:"display.clear"'));
  const health=server.slice(server.indexOf('app.get("/health"'),server.indexOf('app.get("/api/v1/status"'));
  assert.match(health,/normalizeTimerOverlay\(item\.timerOverlay/);
});

test("Morning Announcements probes use the display allowlist and validate every redirect",()=>{
  const probe=server.slice(server.indexOf("function validateMorningAnnouncementsUrl"),server.indexOf("async function probeMorningAnnouncementsLive"));
  assert.match(probe,/validateDisplayGatewayTarget\(text,MORNING_ANNOUNCEMENTS_ALLOWED_HOSTS\)/);
  assert.match(probe,/redirect:"manual"/);
  assert.match(probe,/validateDisplayGatewayTarget\(new URL\(location,current\),MORNING_ANNOUNCEMENTS_ALLOWED_HOSTS\)/);
  assert.match(probe,/redirects===3/);
  const websocketUrls=server.slice(server.indexOf("function announcementsWebSocketUrls"),server.indexOf("async function probeMorningAnnouncementsWebRtc"));
  assert.doesNotMatch(websocketUrls,/5443/);
  assert.match(server,/Morning Announcements disabled:/);
});

test("audit persistence failures cannot convert an already-delivered command into a retryable failure",()=>{
  const auditBlock=server.slice(server.indexOf("function audit(event)"),server.indexOf("function diagnosticSanitize"));
  assert.match(auditBlock,/pendingAuditWrites\.push\(entry\)/);
  assert.match(auditBlock,/catch\(error\)/);
  assert.doesNotMatch(auditBlock,/throw error/);
  assert.match(auditBlock,/pendingAuditWrites\.length>2000/);
});
