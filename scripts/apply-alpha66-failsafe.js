"use strict";

const fs=require("fs");

const serverPath="src/server.js";
let s=fs.readFileSync(serverPath,"utf8");

const startMarker='async function replayDeferredAnnouncementAutomations(){';
const endMarker='let morningAnnouncementsTickBusy=false;';
const start=s.indexOf(startMarker);
const end=s.indexOf(endMarker,start);
if(start<0||end<0)throw new Error("Could not locate Morning Announcements restore block");

const replacement=`function automationDeferredDisplayTargets(event){
  const out=new Set();
  const collect=(action,targets)=>{
    const a=String(action||\"\").toLowerCase();
    if(!a.startsWith(\"display.\"))return;
    for(const id of automationDisplayTargets(targets||[]))out.add(id);
  };
  collect(event.action,event.targets);
  for(const step of Array.isArray(event.actions)?event.actions:[]){
    const action=step?.action||event.action;
    const stepDomain=automationTargetDomain(action),eventDomain=automationTargetDomain(event.action);
    let targets;
    if(step?.useEventTargets!==false&&stepDomain===eventDomain)targets=event.targets;
    else if(Array.isArray(step?.targets)&&step.targets.length)targets=step.targets;
    else if(stepDomain===\"display\")targets=[\"all\"];
    else targets=[];
    collect(action,targets);
  }
  const timer=event.timerOverlay&&typeof event.timerOverlay===\"object\"?event.timerOverlay:null;
  if(timer?.enabled){
    const targets=timer.useEventTargets!==false?event.targets:(Array.isArray(timer.targets)&&timer.targets.length?timer.targets:event.targets);
    for(const id of automationDisplayTargets(targets||[]))out.add(id);
  }
  return out;
}
function automationOccurrenceScheduledMinutes(event){
  const [h,m]=String(event?.time||\"00:00\").split(\":\").map(Number);
  return (Number.isFinite(h)?h:0)*60+(Number.isFinite(m)?m:0);
}
function automationOccurrenceIsCurrentlyApplicable(event,now=new Date()){
  if(!event||!automationMatchesDate(event,now).match)return false;
  const scheduled=automationOccurrenceScheduledMinutes(event),current=localMinutesNow(now);
  if(scheduled>current)return false;
  if(event._class){
    const start=Number(event._classStartAt),end=Number(event._classEndAt),stamp=now.getTime();
    if(Number.isFinite(start)&&stamp<start)return false;
    if(Number.isFinite(end)&&stamp>=end)return false;
  }
  return automationDeferredDisplayTargets(event).size>0;
}
function currentAutomationDisplayWinners(now=new Date()){
  const candidates=[];
  for(const storedEvent of classroomAutomations.events){
    if(!storedEvent?.enabled)continue;
    for(const event of resolveAutomationOccurrences(storedEvent,now)){
      if(!automationOccurrenceIsCurrentlyApplicable(event,now))continue;
      const targets=[...automationDeferredDisplayTargets(event)];
      if(!targets.length)continue;
      candidates.push({storedEvent,event,targets,scheduledMinutes:automationOccurrenceScheduledMinutes(event)});
    }
  }
  const winnersByTarget=new Map();
  for(const candidate of candidates){
    for(const id of candidate.targets){
      const prior=winnersByTarget.get(id);
      if(!prior||candidate.scheduledMinutes>prior.scheduledMinutes||
        (candidate.scheduledMinutes===prior.scheduledMinutes&&String(candidate.storedEvent.updatedAt||\"\")>String(prior.storedEvent.updatedAt||\"\"))){
        winnersByTarget.set(id,candidate);
      }
    }
  }
  const unique=new Map();
  for(const candidate of winnersByTarget.values()){
    const key=\`${'${'}candidate.storedEvent.id}:${'${'}candidate.event.classId||\"manual\"}:${'${'}candidate.event.time}\`;
    if(!unique.has(key))unique.set(key,candidate);
  }
  return [...unique.values()].sort((a,b)=>a.scheduledMinutes-b.scheduledMinutes||String(a.storedEvent.id).localeCompare(String(b.storedEvent.id)));
}
function consumeDeferredAnnouncementAutomations(){
  const queued=[...deferredAnnouncementAutomations.values()];
  deferredAnnouncementAutomations.clear();
  for(const item of queued){
    const storedEvent=classroomAutomations.events.find(x=>x.id===item.storedEventId);if(!storedEvent)continue;
    storedEvent.lastExecByClass=storedEvent.lastExecByClass||{};
    storedEvent.lastExecByClass[item.occurrenceKey]=item.scheduledMinuteKey;
    storedEvent.lastExec=item.scheduledMinuteKey;
    storedEvent.lastRun={at:new Date().toISOString(),scheduledFor:\`${'${'}item.dateKey} ${'${'}item.event.time}\`,resolvedClassId:item.event.classId||null,ok:true,deferred:true,resynced:true,message:\"Consumed by post-announcement scheduler resync\"};
    storedEvent.updatedAt=new Date().toISOString();
  }
  if(queued.length)persistAutomations();
  return queued.length;
}
async function resyncCurrentDisplayAutomationsAfterAnnouncements(reason=\"stream-ended\"){
  const now=new Date(),winners=currentAutomationDisplayWinners(now),results=[];
  for(const candidate of winners){
    const occurrenceKey=candidate.event.classId||\"manual\";
    const scheduledMinuteKey=\`${'${'}localDateKey(now)} ${'${'}candidate.event.time}\`;
    try{
      const result=await runClassroomAutomation(candidate.event,{manual:false,bypassAnnouncementPriority:true});
      candidate.storedEvent.lastExecByClass=candidate.storedEvent.lastExecByClass||{};
      candidate.storedEvent.lastExecByClass[occurrenceKey]=scheduledMinuteKey;
      candidate.storedEvent.lastExec=scheduledMinuteKey;
      candidate.storedEvent.lastRun={at:new Date().toISOString(),scheduledFor:scheduledMinuteKey,resolvedClassId:candidate.event.classId||null,ok:result.ok!==false,resync:true,message:\"Re-applied after Morning Announcements ended\"};
      candidate.storedEvent.updatedAt=new Date().toISOString();
      results.push({automationId:candidate.storedEvent.id,name:candidate.storedEvent.name,classId:candidate.event.classId||null,time:candidate.event.time,targets:candidate.targets,ok:result.ok!==false});
    }catch(err){
      results.push({automationId:candidate.storedEvent.id,name:candidate.storedEvent.name,classId:candidate.event.classId||null,time:candidate.event.time,targets:candidate.targets,ok:false,error:err.message});
      diagnosticError(err,{component:\"automation\",operation:\"announcement-post-resync\",data:{automationId:candidate.storedEvent.id,reason}});
    }
  }
  if(winners.length)persistAutomations();
  audit({kind:\"automation.morning-announcements.resync\",reason,at:now.toISOString(),winnerCount:winners.length,results});
  return {winnerCount:winners.length,results};
}
async function releaseMorningAnnouncements(reason=\"stream-ended\"){
  if(!morningAnnouncementsRuntime.active)return;
  const targets=morningAnnouncementsRuntime.targets?.length?[...morningAnnouncementsRuntime.targets]:announcementTargets();
  if(targets.length)await executeCommand({type:\"display.clear\",target:targets,payload:{reason:\"morning-announcements-release\"}},\"automation\");
  setMorningAnnouncementPriorityTargets(targets,false);
  morningAnnouncementsRuntime.active=false;morningAnnouncementsRuntime.mode=null;morningAnnouncementsRuntime.targets=[];morningAnnouncementsRuntime.lastEndedAt=new Date().toISOString();morningAnnouncementsRuntime.lastAssertAt=0;
  const deferredConsumed=consumeDeferredAnnouncementAutomations();
  const resync=await resyncCurrentDisplayAutomationsAfterAnnouncements(reason);
  backgroundMusicTick().catch(()=>{});
  audit({kind:\"automation.morning-announcements.stop\",reason,targets,deferredConsumed,resyncWinnerCount:resync.winnerCount,resyncResults:resync.results});
}
`;

s=s.slice(0,start)+replacement+s.slice(end);
fs.writeFileSync(serverPath,s);

const textFiles=[
  "VERSION","package.json","public/display/index.html","public/controller/index.html","public/controller/display.html",
  "maintenance-agent/package.json","maintenance-agent/server.js","host-agent/server.py"
];
for(const file of textFiles){
  if(!fs.existsSync(file))continue;
  let t=fs.readFileSync(file,"utf8");
  t=t.replaceAll("1.0.0-alpha.65","1.0.0-alpha.66");
  t=t.replaceAll("v1.0.0-alpha.65","v1.0.0-alpha.66");
  fs.writeFileSync(file,t);
}
fs.writeFileSync("VERSION","1.0.0-alpha.66\n");

const changelog="CHANGELOG.md";
let c=fs.existsSync(changelog)?fs.readFileSync(changelog,"utf8"):"# Changelog\n";
const entry=`## 1.0.0-alpha.66 - 2026-09-03\n\n### Fixed\n- Morning Announcements now perform a failsafe scheduler resync when the stream ends instead of restoring a snapshot or guessing one historical event.\n- The newest currently applicable display automation is selected independently per display target.\n- Class-linked automations are only eligible while their linked class occurrence is currently active.\n- Deferred automations are consumed by the resync so they cannot double-fire after release.\n- Winning automations are re-run oldest-to-newest so newer overlapping automation remains authoritative.\n- Background Music resumes only after display automation reconciliation completes.\n\n`;
if(!c.includes("## 1.0.0-alpha.66 - 2026-09-03"))c=entry+c;
fs.writeFileSync(changelog,c);

console.log("alpha.66 failsafe scheduler resync patch applied");
