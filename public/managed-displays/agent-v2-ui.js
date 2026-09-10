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
        panel.innerHTML='<strong>Device Agent v2</strong> <span data-v2-status>Checking…</span><div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.4rem" data-v2-controls></div><div style="margin-top:.55rem;display:flex;flex-wrap:wrap;gap:.4rem" data-lifecycle-controls></div>';
        controls.parentNode.insertBefore(panel,controls);
      }
      const box=panel.querySelector("[data-v2-controls]");
      if(!box.dataset.ready){
        box.dataset.ready="1";
        for(const [label,op] of [["Configure v2","configure"],["Agent Status","status"],["Capabilities","capabilities"],["Reload via Agent","reload"],["Wake via Agent","wake"],["Home via Agent","home"],["Back via Agent","back"],["Recents via Agent","recents"],["Repair ADB Settings","recover-adb-settings"],["Enable Device Admin","enable-device-admin"]]){
          const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.v2Action=op;box.appendChild(b);
        }
      }
      const lifecycleBox=panel.querySelector("[data-lifecycle-controls]");
      if(!lifecycleBox.dataset.ready){
        lifecycleBox.dataset.ready="1";
        for(const [label,op] of [["Enable enrollment","enable"],["Disable enrollment","disable"],["Remove from Hub","remove"]]){
          const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.lifecycleAction=op;if(op==="remove")b.className="danger";lifecycleBox.appendChild(b);
        }
      }
      box.querySelectorAll("button").forEach(b=>{b.disabled=false;b.title=b.dataset.v2Action==="enable-device-admin"?"One-time ADB bootstrap: opens Android's Device Administrator approval screen on the TV.":"Uses Device Agent v2; ADB is not required after initial v2 configuration."});
      lifecycleBox.querySelectorAll("button").forEach(b=>{b.disabled=false;b.title="Changes only Classroom Hub enrollment state; it does not factory-reset the TV or uninstall the agent."});
      probe(card).catch(()=>{});
    }
  }
  async function probe(card){
    if(card.dataset.v2ProbeBusy==="1")return;card.dataset.v2ProbeBusy="1";
    const id=card.dataset.id,status=card.querySelector("[data-v2-status]");
    try{const j=await call(id,"/health");status.textContent=`Online · ${j.status?.agentVersion||"version unknown"}`;status.style.color=""}
    catch(e){status.textContent=e.status===409?"Not configured":`Unavailable · ${e.message}`;status.style.color=""}
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
        const j=await call(id,"/device-admin/activate",{method:"POST",body:"{}"});terminal("Device Admin activation",j);window.alert("Android's Device Administrator approval screen was opened on the TV. Approve Classroom Hub there, then run Capabilities again.");
      }else{
        const j=await call(id,"/action",{method:"POST",body:JSON.stringify({action:op})});terminal(`Device Agent v2 action: ${op}`,j.result);
      }
      await probe(card);
    }catch(err){window.alert(`Device Agent v2: ${err.message}`)}finally{b.disabled=false}
  },true);
  new MutationObserver(()=>decorate()).observe(root,{childList:true,subtree:true});
  decorate();setInterval(()=>root.querySelectorAll(".card[data-id]").forEach(card=>probe(card).catch(()=>{})),10000);
})();
