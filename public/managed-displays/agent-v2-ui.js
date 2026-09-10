"use strict";
(()=>{
  const root=document.getElementById("devices");
  if(!root)return;
  async function call(id,path,opt={}){
    const r=await fetch(`/api/v1/maintenance/android/devices/${encodeURIComponent(id)}/agent/v2${path}`,{credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json",...(opt.headers||{})},...opt});
    const text=await r.text();let j={};try{j=JSON.parse(text)}catch{throw Error(text||`HTTP ${r.status}`)}
    if(!r.ok||j.ok===false){const e=Error(j.error||`HTTP ${r.status}`);e.status=r.status;throw e}return j;
  }
  async function maintenanceCall(id,path,opt={}){
    const r=await fetch(`/api/v1/maintenance/android/devices/${encodeURIComponent(id)}${path}`,{credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json",...(opt.headers||{})},...opt});
    const text=await r.text();let j={};try{j=JSON.parse(text)}catch{throw Error(text||`HTTP ${r.status}`)}
    if(!r.ok||j.ok===false){const e=Error(j.error||`HTTP ${r.status}`);e.status=r.status;throw e}return j;
  }
  function terminal(title,value){const el=document.getElementById("terminal");if(el)el.textContent=`${title}\n${typeof value==='string'?value:JSON.stringify(value,null,2)}`}
  function decorate(){
    for(const card of root.querySelectorAll(".card[data-id]")){
      const controls=card.querySelector(".controls");if(!controls)continue;
      let panel=card.querySelector(".agent-v2-panel");
      if(!panel){
        panel=document.createElement("div");panel.className="agent-v2-panel";panel.style.cssText="margin-top:.8rem;padding:.7rem;border:1px solid rgba(255,255,255,.12);border-radius:.6rem";
        panel.innerHTML='<strong>Device Agent v2</strong> <span data-v2-status>Checking…</span><div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.4rem" data-v2-controls></div><div style="margin-top:.55rem;display:flex;flex-wrap:wrap;gap:.4rem" data-audio-controls></div><div style="margin-top:.55rem;display:flex;flex-wrap:wrap;gap:.4rem" data-lifecycle-controls></div>';
        controls.parentNode.insertBefore(panel,controls);
      }
      const box=panel.querySelector("[data-v2-controls]");
      if(!box.dataset.ready){
        box.dataset.ready="1";
        for(const [label,op] of [["Configure v2","configure"],["Agent Status","status"],["Capabilities","capabilities"],["Reload via Agent","reload"],["Wake via Agent","wake"],["Home via Agent","home"],["Back via Agent","back"],["Recents via Agent","recents"],["Repair ADB Settings","recover-adb-settings"],["Enable Accessibility","enable-accessibility"],["Enable Device Admin","enable-device-admin"]]){
          const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.v2Action=op;box.appendChild(b);
        }
      }
      const audioBox=panel.querySelector("[data-audio-controls]");
      if(!audioBox.dataset.ready){
        audioBox.dataset.ready="1";
        const label=document.createElement("span");label.textContent="Native Sendspin:";label.style.alignSelf="center";audioBox.appendChild(label);
        for(const [text,op] of [["Configure","sendspin-configure"],["Status","sendspin-status"],["Reconnect","sendspin-reconnect"]]){
          const b=document.createElement("button");b.type="button";b.textContent=text;b.dataset.v2Action=op;audioBox.appendChild(b);
        }
      }
      const lifecycleBox=panel.querySelector("[data-lifecycle-controls]");
      if(!lifecycleBox.dataset.ready){
        lifecycleBox.dataset.ready="1";
        for(const [label,op] of [["Enable enrollment","enable"],["Disable enrollment","disable"],["Remove from Hub","remove"]]){
          const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.lifecycleAction=op;if(op==="remove")b.className="danger";lifecycleBox.appendChild(b);
        }
      }
      panel.querySelectorAll("button[data-v2-action]").forEach(b=>{b.disabled=false;if(b.dataset.v2Action==="enable-device-admin")b.title="Opens Android's Device Administrator approval flow on the TV.";else if(b.dataset.v2Action==="enable-accessibility")b.title="Opens Android Accessibility settings so Home/Back/Recents can be granted.";else if(b.dataset.v2Action?.startsWith("sendspin-"))b.title="Native Music Assistant Sendspin playback runs inside the Android agent, independently of the WebView.";else b.title="Uses Device Agent v2; ADB is not required after initial v2 configuration."});
      lifecycleBox.querySelectorAll("button").forEach(b=>{b.disabled=false;b.title="Changes only Classroom Hub enrollment state; it does not factory-reset the TV or uninstall the agent."});
      probe(card).catch(()=>{});
    }
  }
  async function probe(card){
    if(card.dataset.v2ProbeBusy==="1")return;card.dataset.v2ProbeBusy="1";
    const id=card.dataset.id,status=card.querySelector("[data-v2-status]");
    try{
      const j=await call(id,"/health");const a=j.status?.sendspin;
      status.textContent=`Online · ${j.status?.agentVersion||"version unknown"}${a?.enabled?` · Sendspin ${a.connected?(a.playing?'playing':'connected'):'offline'}`:''}`;status.style.color="";
      const navAvailable=j.status?.capabilities?.globalNavigation?.available===true;
      for(const op of ["home","back","recents"]){const b=card.querySelector(`button[data-v2-action="${op}"]`);if(b){b.title=navAvailable?"Uses the enabled Classroom Hub Accessibility service.":"Requires Enable Accessibility on the TV before this action can work.";}}
    }catch(e){status.textContent=e.status===409?"Not configured":`Unavailable · ${e.message}`;status.style.color=""}
    finally{delete card.dataset.v2ProbeBusy}
  }
  root.addEventListener("click",async e=>{
    const lifecycleButton=e.target.closest("button[data-lifecycle-action]");
    if(lifecycleButton){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      const card=lifecycleButton.closest(".card[data-id]"),id=card?.dataset.id;if(!id)return;
      const op=lifecycleButton.dataset.lifecycleAction;
      if(op==="remove"&&!window.confirm("Remove this managed display from Classroom Hub? This removes the Hub enrollment only. It will not uninstall the Android app, factory-reset the TV, or delete other Classroom Hub data."))return;
      if(op==="disable"&&!window.confirm("Disable this enrollment? Classroom Hub policy automation will ignore it until re-enabled."))return;
      lifecycleButton.disabled=true;
      try{const j=await maintenanceCall(id,"/lifecycle",{method:"POST",body:JSON.stringify({action:op})});terminal(`Managed display lifecycle: ${op}`,j);if(op==="remove")card.remove();else window.location.reload()}
      catch(err){window.alert(`Managed display lifecycle: ${err.message}`)}finally{lifecycleButton.disabled=false}
      return;
    }
    const b=e.target.closest("button[data-v2-action]");if(!b)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    const card=b.closest(".card[data-id]"),id=card?.dataset.id;if(!id)return;
    b.disabled=true;
    try{
      const op=b.dataset.v2Action;
      if(op==="configure"){
        await call(id,"/configure",{method:"POST",body:JSON.stringify({})});
        window.alert("Device Agent v2 configured. Its authenticated network control channel can now operate independently of external ADB.");
      }else if(op==="status"){
        const j=await call(id,"/status");terminal("Device Agent v2 status",j.status);
      }else if(op==="capabilities"){
        const j=await call(id,"/capabilities");terminal("Device Agent v2 capabilities",j.capabilities);
      }else if(op==="enable-device-admin"){
        const j=await call(id,"/device-admin/activate",{method:"POST",body:"{}"});terminal("Device Admin activation",j);window.alert("Classroom Hub opened its Device Administrator activation helper on the TV. Approve the Android system prompt if shown, then run Capabilities again.");
      }else if(op==="enable-accessibility"){
        const j=await call(id,"/action",{method:"POST",body:JSON.stringify({action:"open-accessibility-settings"})});terminal("Accessibility activation",j.result);window.alert("Accessibility settings were requested on the TV. Enable Classroom Hub control fallback, then run Capabilities again.");
      }else if(op==="sendspin-configure"){
        const current=(await call(id,"/status")).status?.sendspin||{};
        const defaultUrl=current.url||"ws://MUSIC_ASSISTANT_HOST:8927/sendspin";
        const url=window.prompt("Music Assistant Sendspin URL (normally ws://<Music Assistant host>:8927/sendspin)",defaultUrl);if(url===null)return;
        const defaultName=current.name||card.querySelector("h3")?.textContent||"Classroom Hub Display";
        const name=window.prompt("Music Assistant player name",defaultName);if(name===null)return;
        const j=await call(id,"/action",{method:"POST",body:JSON.stringify({action:"sendspin-configure",enabled:true,url:url.trim(),name:name.trim()})});terminal("Native Sendspin configured",j.result);
      }else if(op==="sendspin-status"){
        const j=await call(id,"/action",{method:"POST",body:JSON.stringify({action:"sendspin-status"})});terminal("Native Sendspin status",j.result);
      }else if(op==="sendspin-reconnect"){
        const j=await call(id,"/action",{method:"POST",body:JSON.stringify({action:"sendspin-reconnect"})});terminal("Native Sendspin reconnect",j.result);
      }else{
        const j=await call(id,"/action",{method:"POST",body:JSON.stringify({action:op})});terminal(`Device Agent v2 action: ${op}`,j.result);
      }
      await probe(card);
    }catch(err){window.alert(`Device Agent v2: ${err.message}`)}finally{b.disabled=false}
  },true);
  new MutationObserver(()=>decorate()).observe(root,{childList:true,subtree:true});
  decorate();setInterval(()=>root.querySelectorAll(".card[data-id]").forEach(card=>probe(card).catch(()=>{})),10000);
})();
