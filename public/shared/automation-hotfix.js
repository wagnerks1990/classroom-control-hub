"use strict";

(function installAutomationClassTargetFix(){
  function install(){
    if(typeof window.editorEvent!=="function"||typeof window.editAutomation!=="function"){
      setTimeout(install,50);
      return;
    }
    if(window.__CLASSROOM_HUB_AUTOMATION_CLASS_TARGET_FIX__)return;
    window.__CLASSROOM_HUB_AUTOMATION_CLASS_TARGET_FIX__=true;

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
