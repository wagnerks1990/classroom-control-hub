"use strict";

(function(){
  const esc=value=>String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));
  const LOCAL_HOSTS=new Set(["host.docker.internal","localhost","127.0.0.1","0.0.0.0"]);
  function browserServiceUrl(value,defaultPort){
    try{
      const url=new URL(String(value||`http://${location.hostname}:${defaultPort}`));
      if(LOCAL_HOSTS.has(url.hostname))url.hostname=location.hostname;
      return url.toString().replace(/\/$/,"");
    }catch{return `http://${location.hostname}:${defaultPort}`}
  }
  async function maintenanceConfig(id){
    try{
      if(typeof window.maintApi==="function")return (await window.maintApi(`/modules/${encodeURIComponent(id)}/config`)).config||{};
      const response=await fetch(`/api/v1/maintenance/modules/${encodeURIComponent(id)}/config`,{credentials:"same-origin",cache:"no-store"});
      if(!response.ok)return {};
      return (await response.json()).config||{};
    }catch{return {}}
  }
  function field({key,label,type="text",value="",placeholder="",help="",secret=false,textarea=false,scope="setup"}){
    const attr=scope==="controller"?`data-module-field="${esc(key)}"`:`data-k="${esc(key)}"`;
    const control=textarea
      ?`<textarea ${attr} rows="4" autocomplete="off" placeholder="${esc(placeholder)}" style="width:100%;margin-top:4px">${secret?"":esc(value)}</textarea>`
      :`<input ${attr} type="${secret?"password":esc(type)}" value="${secret?"":esc(value)}" autocomplete="${secret?"new-password":"off"}" placeholder="${esc(secret&&value==="••••••••"?"Stored securely — leave blank to keep":placeholder)}" style="width:100%;margin-top:4px">`;
    return `<label style="display:block"><b>${esc(label)}</b>${control}${help?`<div class="muted">${esc(help)}</div>`:""}</label>`;
  }
  function musicFields(cfg,scope){
    const url=cfg.url||"http://host.docker.internal:8095";
    return `<div class="integration-guided-fields" style="grid-column:1/-1">
      <div class="muted" style="margin-bottom:8px"><b>Required:</b> Music Assistant API access is disabled until a valid long-lived access token is saved. Create one in Music Assistant under Settings → Profile → Long-lived access tokens.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">
        ${field({key:"url",label:"Music Assistant URL",value:url,placeholder:"http://host.docker.internal:8095",help:"Container-to-host API address. The Open Music Assistant button converts this to a browser-reachable address.",scope})}
        ${field({key:"token",label:"Long-lived access token",value:cfg.token||"",placeholder:"Required access token",help:"Stored encrypted in the Classroom Control Hub database. Saving is rejected if authentication fails.",secret:true,scope})}
      </div>
      <div class="actions toolbar" style="margin-top:10px"><button type="button" data-open-music-assistant>Open Music Assistant</button><span class="muted">Create/copy the token there, return here, paste it, then Save & Verify.</span></div>
    </div>`;
  }
  function veyonFields(cfg,scope){
    return `<div class="integration-guided-fields" style="grid-column:1/-1">
      <div class="muted" style="margin-bottom:8px">The native Veyon services remain host-managed, but Classroom Control Hub owns their application configuration. This appliance is standardized on Veyon key-file authentication with the matching <b>master</b> key pair. Domain credentials and Linux SSH credentials below are optional endpoint-deployment credentials, not normal Veyon control authentication.</div>
      <h4 style="margin:10px 0 4px">Veyon WebAPI & Authentication</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
        ${field({key:"url",label:"WebAPI URL",value:cfg.url||"http://host.docker.internal:11080",placeholder:"http://host.docker.internal:11080",scope})}
        ${field({key:"keyName",label:"Authentication key name",value:cfg.keyName||"master",placeholder:"master",help:"Must match the public authentication key deployed to Veyon clients. The appliance default is master.",scope})}
        ${field({key:"privateKey",label:"Veyon private key (PEM)",value:cfg.privateKey||"",placeholder:"Imported automatically from native master key when available",help:"Authoritative copy is encrypted in SQLite. Paste only to explicitly replace/import the key.",secret:true,textarea:true,scope})}
        ${field({key:"publicKey",label:"Veyon public key (PEM)",value:cfg.publicKey||"",placeholder:"Public master key used for endpoint deployment",help:"Stored as non-secret integration metadata and safe to distribute to managed Veyon endpoints.",textarea:true,scope})}
      </div>
      <h4 style="margin:14px 0 4px">Computer Discovery & Connection Pool</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        ${field({key:"scanSubnet",label:"Scan subnet prefix",value:cfg.scanSubnet||"",placeholder:"172.16.127",help:"Optional. Existing database computers do not require a fresh scan.",scope})}
        ${field({key:"scanStart",label:"Scan start",type:"number",value:cfg.scanStart??1,scope})}
        ${field({key:"scanEnd",label:"Scan end",type:"number",value:cfg.scanEnd??254,scope})}
        ${field({key:"poolMax",label:"Connection pool maximum",type:"number",value:cfg.poolMax??24,scope})}
        ${field({key:"authRetries",label:"Authentication retries",type:"number",value:cfg.authRetries??2,scope})}
        ${field({key:"thumbnailConcurrency",label:"Thumbnail concurrency",type:"number",value:cfg.thumbnailConcurrency??8,scope})}
      </div>
      <details style="margin-top:12px"><summary>Optional endpoint deployment credentials</summary>
        <div class="muted" style="margin:8px 0">These credentials are only for installing/configuring Veyon on endpoints. Secrets are encrypted in SQLite.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
          ${field({key:"windowsDomain",label:"Windows domain / workgroup",value:cfg.windowsDomain||"",placeholder:"DOMAIN",scope})}
          ${field({key:"windowsUsername",label:"Windows deployment username",value:cfg.windowsUsername||"",placeholder:"svc-veyon",scope})}
          ${field({key:"windowsCredentialPassword",label:"Windows deployment password",value:cfg.windowsCredentialPassword||"",placeholder:"Stored securely — leave blank to keep",secret:true,scope})}
          ${field({key:"linuxSshUsername",label:"Linux SSH username",value:cfg.linuxSshUsername||"",placeholder:"administrator",scope})}
          ${field({key:"linuxSshCredentialPrivateKey",label:"Linux SSH private key",value:cfg.linuxSshCredentialPrivateKey||"",placeholder:"Stored securely — leave blank to keep",secret:true,textarea:true,scope})}
          ${field({key:"linuxSshCredentialPassphrase",label:"SSH key passphrase",value:cfg.linuxSshCredentialPassphrase||"",placeholder:"Optional",secret:true,scope})}
        </div>
      </details>
      <div class="muted" style="margin-top:10px">Computer inventory, roles, hostnames/IPs and Veyon application settings are database-authoritative. Legacy veyon-computers.json is migration input only and is retired after verified import.</div>
    </div>`;
  }
  function replaceActionBehavior(card,id,scope){
    if(!card)return;
    const buttons=[...card.querySelectorAll(".actions button,.toolbar button")];
    for(const button of buttons){
      const text=button.textContent.trim();
      if(id==="veyonwebapi"&&/remove/i.test(text)){button.remove();continue}
      if(/save.*recreate|install/i.test(text)){
        button.textContent=id==="musicassistant"?"Save & Verify":"Save Configuration";
        button.onclick=()=>{
          if(scope==="controller"&&typeof window.deployManagedModule==="function")return window.deployManagedModule(id,false);
          if(scope==="setup"&&typeof window.moduleAction==="function")return window.moduleAction(id,false);
        };
      }
    }
  }
  async function enhanceSetupCard(id){
    const card=document.getElementById(`mod-${id}`);if(!card||card.dataset.guidedSetup==="1")return;
    const details=card.querySelector("details");if(!details)return;
    const cfg=await maintenanceConfig(id);
    details.querySelectorAll("label").forEach(x=>x.remove());
    details.insertAdjacentHTML("beforeend",id==="musicassistant"?musicFields(cfg,"setup"):veyonFields(cfg,"setup"));
    card.dataset.guidedSetup="1";
    replaceActionBehavior(card,id,"setup");
    wire(card,cfg);
  }
  async function enhanceControllerEditor(id){
    const editor=document.getElementById(`module-editor-${id}`);if(!editor||editor.dataset.guidedSetup==="1")return;
    const cfg=await maintenanceConfig(id);
    editor.innerHTML=id==="musicassistant"?musicFields(cfg,"controller"):veyonFields(cfg,"controller");
    editor.dataset.guidedSetup="1";
    const card=editor.closest(".card");
    replaceActionBehavior(card,id,"controller");
    wire(card||editor,cfg);
  }
  function wire(root,cfg){
    root?.querySelectorAll("[data-open-music-assistant]").forEach(button=>button.addEventListener("click",()=>{
      const input=root.querySelector('[data-k="url"],[data-module-field="url"]');
      window.open(browserServiceUrl(input?.value||cfg.url,8095),"_blank","noopener");
    }));
  }
  function enhance(){
    enhanceSetupCard("musicassistant");enhanceSetupCard("veyonwebapi");
    enhanceControllerEditor("musicassistant");enhanceControllerEditor("veyonwebapi");
  }
  const observer=new MutationObserver(()=>enhance());
  if(document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true});
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",enhance,{once:true});else enhance();
  setTimeout(enhance,500);setTimeout(enhance,1500);
})();
