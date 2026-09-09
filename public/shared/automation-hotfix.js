"use strict";

(function installAutomationClassTargetFix(){
  function install(){
    if(typeof window.api!=="function"||typeof window.scheduleDescription!=="function"||typeof window.editorEvent!=="function"||typeof window.editAutomation!=="function"){
      setTimeout(install,50);
      return;
    }
    if(window.__CLASSROOM_HUB_AUTOMATION_CLASS_TARGET_FIX__)return;
    window.__CLASSROOM_HUB_AUTOMATION_CLASS_TARGET_FIX__=true;

    const originalApi=window.api;
    window.api=async function patchedApi(url,opt={}){
      const payload=await originalApi(url,opt);
      const path=String(url||"").split("?")[0];
      const method=String(opt?.method||"GET").toUpperCase();
      if(path==="/api/v1/automations"&&method==="GET"&&Array.isArray(payload?.events)){
        for(const event of payload.events){
          const occurrences=Array.isArray(event?.resolvedOccurrences)?event.resolvedOccurrences.filter(Boolean):[];
          const linked=Array.isArray(event?.classIds)?event.classIds.length>0:!!event?.classId;
          if(!linked||!occurrences.length)continue;
          const primary=[...occurrences].sort((a,b)=>String(a?.time||"").localeCompare(String(b?.time||"")))[0];
          if(primary?.time){
            event.legacyTime=event.time;
            event.time=primary.time;
          }
        }
      }
      return payload;
    };

    const originalScheduleDescription=window.scheduleDescription;
    window.scheduleDescription=function patchedScheduleDescription(event){
      const occurrences=Array.isArray(event?.resolvedOccurrences)?event.resolvedOccurrences.filter(Boolean):[];
      const linked=Array.isArray(event?.classIds)?event.classIds.length>0:!!event?.classId;
      if(linked&&occurrences.length){
        return [...occurrences]
          .sort((a,b)=>String(a?.time||"").localeCompare(String(b?.time||"")))
          .map(occ=>`${occ.time||event.time} • ${originalScheduleDescription(occ)}`)
          .join(" | ");
      }
      return originalScheduleDescription(event);
    };

    const originalEditorEvent=window.editorEvent;
    window.editorEvent=function patchedEditorEvent(){
      const event=originalEditorEvent();
      const checkbox=document.getElementById("autoUseClassTargets");
      if(checkbox)event.useClassTargets=checkbox.checked;
      return event;
    };

    const originalEditAutomation=window.editAutomation;
    window.editAutomation=function patchedEditAutomation(id){
      const result=originalEditAutomation(id);
      Promise.resolve().then(async()=>{
        try{
          const response=await fetch("/api/v1/automations",{cache:"no-store",credentials:"same-origin"});
          if(!response.ok)return;
          const payload=await response.json();
          const event=(payload.events||[]).find(item=>item.id===id);
          const checkbox=document.getElementById("autoUseClassTargets");
          if(event&&checkbox)checkbox.checked=event.useClassTargets!==false;
        }catch{}
      });
      return result;
    };
  }
  install();
})();
