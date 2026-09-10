"use strict";
(()=>{
  const root=document.getElementById("devices");
  if(!root)return;
  async function call(id,path,opt={}){
    const r=await fetch(`/api/v1/maintenance/android/devices/${encodeURIComponent(id)}/agent/v2${path}`,{credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json",...(opt.headers||{})},...opt});
    const text=await r.text();let j={};try{j=JSON.parse(text)}catch{throw Error(text||`HTTP ${r.status}`)}
    if(!r.ok||j.ok===false){const e=Error(j.error||`HTTP ${r.status}`);e.status=r.status;throw e}return j;
  }
  function decorate(){
    for(const card of root.querySelectorAll(".card[data-id]")){
      const controls=card.querySelector(".controls");if(!controls)continue;
      let panel=card.querySelector(".agent-v2-panel");
      if(!panel){
        panel=document.createElement("div");panel.className="agent-v2-panel";panel.style.cssText="margin-top:.8rem;padding:.7rem;border:1px solid rgba(255,255,255,.12);border-radius:.6rem";
        panel.innerHTML='<strong>Device Agent v2</strong> <span data-v2-status>Checking…</span><div style="margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.4rem" data-v2-controls></div>';
        controls.parentNode.insertBefore(panel,controls);
      }
      const box=panel.querySelector("[data-v2-controls]");
      if(!box.dataset.ready){
        box.dataset.ready="1";
        for(const [label,op] of [["Configure v2","configure"],["Agent Status","status"],["Capabilities","capabilities"],["Reload via Agent","reload"],["Wake via Agent","wake"],["Home via Agent","home"],["Back via Agent","back"],["Recents via Agent","recents"],["Repair ADB Settings","recover-adb-settings"]]){
          const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.v2Action=op;box.appendChild(b);
        }
      }
      box.querySelectorAll("button").forEach(b=>{b.disabled=false;b.title="Uses Device Agent v2; ADB is not required after initial v2 configuration."});
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
        const j=await call(id,"/status");document.getElementById("terminal").textContent=`Device Agent v2 status\n${JSON.stringify(j.status,null,2)}`;
      }else if(op==="capabilities"){
        const j=await call(id,"/capabilities");document.getElementById("terminal").textContent=`Device Agent v2 capabilities\n${JSON.stringify(j.capabilities,null,2)}`;
      }else{
        const j=await call(id,"/action",{method:"POST",body:JSON.stringify({action:op})});document.getElementById("terminal").textContent=`Device Agent v2 action: ${op}\n${JSON.stringify(j.result,null,2)}`;
      }
      await probe(card);
    }catch(err){window.alert(`Device Agent v2: ${err.message}`)}finally{b.disabled=false}
  },true);
  new MutationObserver(()=>decorate()).observe(root,{childList:true,subtree:true});
  decorate();setInterval(()=>root.querySelectorAll(".card[data-id]").forEach(card=>probe(card).catch(()=>{})),10000);
})();
