#!/usr/bin/env python3
from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

replace_once(
    "src/server.js",
    'offlineConfirmations:finite(input.offlineConfirmations??existing.offlineConfirmations,2,1,8),',
    'offlineConfirmations:finite(input.offlineConfirmations??existing.offlineConfirmations,6,1,12),'
)
replace_once(
    "src/server.js",
    'const morningAnnouncementsRuntime={live:false,active:false,mode:null,targets:[],lastCheck:null,lastWatcherTick:null,lastLiveAt:null,lastEndedAt:null,lastError:null,probe:null,probeStatus:null,probeDurationMs:null,offlineCount:0,lastAssertAt:0};',
    'const morningAnnouncementsRuntime={live:false,active:false,mode:null,targets:[],lastCheck:null,lastWatcherTick:null,lastLiveAt:null,lastEndedAt:null,lastError:null,probe:null,probeStatus:null,probeDurationMs:null,offlineCount:0,lastAssertAt:0,lastProbeTransitionAt:null,lastProbeLive:null,probeLiveCount:0,probeOfflineCount:0,probeUnknownCount:0,streamSessionStartedAt:null,streamSessionEndedAt:null};'
)
replace_once(
    "src/server.js",
    'morningAnnouncementsRuntime.active=true;morningAnnouncementsRuntime.mode=mode;morningAnnouncementsRuntime.targets=[...targets];morningAnnouncementsRuntime.lastAssertAt=Date.now();morningAnnouncementsRuntime.lastLiveAt=new Date().toISOString();',
    'morningAnnouncementsRuntime.active=true;morningAnnouncementsRuntime.mode=mode;morningAnnouncementsRuntime.targets=[...targets];morningAnnouncementsRuntime.lastAssertAt=Date.now();morningAnnouncementsRuntime.lastLiveAt=new Date().toISOString();morningAnnouncementsRuntime.streamSessionStartedAt=morningAnnouncementsRuntime.lastLiveAt;morningAnnouncementsRuntime.streamSessionEndedAt=null;'
)
replace_once(
    "src/server.js",
    'morningAnnouncementsRuntime.active=false;morningAnnouncementsRuntime.mode=null;morningAnnouncementsRuntime.targets=[];morningAnnouncementsRuntime.lastEndedAt=new Date().toISOString();morningAnnouncementsRuntime.lastAssertAt=0;',
    'morningAnnouncementsRuntime.active=false;morningAnnouncementsRuntime.mode=null;morningAnnouncementsRuntime.targets=[];morningAnnouncementsRuntime.lastEndedAt=new Date().toISOString();morningAnnouncementsRuntime.streamSessionEndedAt=morningAnnouncementsRuntime.lastEndedAt;morningAnnouncementsRuntime.lastAssertAt=0;'
)
old_tick = '''    if(probe.live===true){
      morningAnnouncementsRuntime.live=true;morningAnnouncementsRuntime.offlineCount=0;
      if(!morningAnnouncementsRuntime.active||Date.now()-morningAnnouncementsRuntime.lastAssertAt>30000)await assertMorningAnnouncements({mode:"automatic"});
    }else if(probe.live===false){
      morningAnnouncementsRuntime.live=false;morningAnnouncementsRuntime.offlineCount++;
      if(morningAnnouncementsRuntime.active&&morningAnnouncementsRuntime.offlineCount>=morningAnnouncements.offlineConfirmations)await releaseMorningAnnouncements("stream-ended");
    }else{
      morningAnnouncementsRuntime.lastError=probe.error||"HLS probe unavailable";
    }'''
new_tick = '''    const previousLive=morningAnnouncementsRuntime.lastProbeLive;
    if(probe.live===true){
      morningAnnouncementsRuntime.live=true;morningAnnouncementsRuntime.lastProbeLive=true;morningAnnouncementsRuntime.probeLiveCount++;morningAnnouncementsRuntime.offlineCount=0;
      if(previousLive!==true){morningAnnouncementsRuntime.lastProbeTransitionAt=new Date().toISOString();console.info(`[Morning Announcements] probe transition ${String(previousLive)} -> live (${probe.probe||"unknown"}, ${probe.status||"n/a"}, ${probe.durationMs??"n/a"}ms)`);audit({kind:"automation.morning-announcements.probe-transition",from:previousLive,to:true,probe:probe.probe,status:probe.status,durationMs:probe.durationMs})}
      if(!morningAnnouncementsRuntime.active)await assertMorningAnnouncements({mode:"automatic"});
    }else if(probe.live===false){
      morningAnnouncementsRuntime.live=false;morningAnnouncementsRuntime.lastProbeLive=false;morningAnnouncementsRuntime.probeOfflineCount++;morningAnnouncementsRuntime.offlineCount++;
      if(previousLive!==false){morningAnnouncementsRuntime.lastProbeTransitionAt=new Date().toISOString();console.warn(`[Morning Announcements] probe transition ${String(previousLive)} -> offline (${probe.probe||"unknown"}, ${probe.status||"n/a"}, ${probe.durationMs??"n/a"}ms)`);audit({kind:"automation.morning-announcements.probe-transition",from:previousLive,to:false,probe:probe.probe,status:probe.status,durationMs:probe.durationMs,offlineCount:morningAnnouncementsRuntime.offlineCount})}
      if(morningAnnouncementsRuntime.active&&morningAnnouncementsRuntime.offlineCount>=morningAnnouncements.offlineConfirmations)await releaseMorningAnnouncements("stream-ended");
    }else{
      morningAnnouncementsRuntime.probeUnknownCount++;
      morningAnnouncementsRuntime.lastError=probe.error||"HLS probe unavailable";
    }'''
replace_once("src/server.js", old_tick, new_tick)
replace_once(
    "public/controller/app.js",
    "offlineConfirmations:2,checkIntervalSeconds:15",
    "offlineConfirmations:6,checkIntervalSeconds:15"
)
replace_once(
    "public/controller/index.html",
    "Two consecutive offline checks are required before an active announcement is ended, preventing a brief stream hiccup from blanking the TVs.",
    "Six consecutive 15-second offline checks (about 90 seconds) are required before an active announcement is ended. Live probes never restart an already-playing feed; transient failures remain visible in diagnostics without blanking the TVs."
)
print("Morning Announcements stability patch applied")
