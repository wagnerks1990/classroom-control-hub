"use strict";

(function(){
  if(!document.documentElement.lang)document.documentElement.lang="en";
  const fallback={productName:"Classroom Control Hub",school:"Your School",room:"Classroom",logoUrl:"",faviconUrl:"",theme:{mode:"dark",primary:"#2aa866",accent:"#1b7a49",background:"#040705",surface:"#121923",text:"#eef4f8"}};
  const renderer=/\/(display|document-viewer|antmedia-player)(\/|$)/.test(location.pathname);
  document.documentElement.dataset.brandSurface=renderer?"renderer":"operator";

  function apply(branding={}){
    const profile={...fallback,...branding,theme:{...fallback.theme,...(branding.theme||{})}};
    const root=document.documentElement,theme=profile.theme;
    root.dataset.brandMode=theme.mode;
    root.style.colorScheme=theme.mode==="system"?"light dark":theme.mode;
    for(const [key,value] of Object.entries(theme))if(key!=="mode")root.style.setProperty(`--brand-${key}`,value);
    root.style.setProperty("--green",theme.primary);
    root.style.setProperty("--green2",theme.accent);
    root.style.setProperty("--text",theme.text);
    root.style.setProperty("--accent",theme.primary);
    document.querySelectorAll("[data-brand-product]").forEach(x=>x.textContent=profile.productName);
    document.querySelectorAll("[data-brand-school]").forEach(x=>x.textContent=profile.school);
    document.querySelectorAll("[data-brand-room]").forEach(x=>x.textContent=profile.room);
    if(document.title.includes("Classroom Control Hub"))document.title=document.title.replace("Classroom Control Hub",profile.productName);
    if(profile.faviconUrl){let icon=document.querySelector("link[rel~='icon']");if(!icon){icon=document.createElement("link");icon.rel="icon";document.head.append(icon)}icon.href=profile.faviconUrl}
    window.CONTROL_HUB_BRANDING=profile;
    window.dispatchEvent(new CustomEvent("controlhub:branding",{detail:profile}));
    return profile;
  }

  function escapeHtml(value){return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}
  function directDisplayPanel(){
    if(!location.pathname.startsWith("/controller"))return;
    const heading=[...document.querySelectorAll("h2.sectionTitle")].find(x=>x.textContent.trim()==="Classroom Display Enrollment");
    const panel=heading?.closest(".panel");
    const list=document.getElementById("cfgDisplayCredentials");
    if(!panel||!list)return;
    heading.textContent="Classroom Display URLs";
    const description=heading.parentElement?.querySelector(".muted");
    if(description)description.textContent="No enrollment token is required. Configure each TV or browser with its stable display URL on the trusted classroom network.";
    const policyToolbar=panel.querySelector(":scope > .toolbar");
    if(policyToolbar)policyToolbar.style.display="none";
    const coverage=document.getElementById("cfgDisplayCredentialCoverage");if(coverage)coverage.style.display="none";
    const result=document.getElementById("cfgEnrollmentResult");if(result)result.style.display="none";
    const refresh=heading.closest(".top")?.querySelector("button");if(refresh){refresh.textContent="Refresh";refresh.onclick=()=>window.loadDisplayCredentialSecurity?.()}
  }
  async function loadDirectDisplayUrls(){
    directDisplayPanel();
    const list=document.getElementById("cfgDisplayCredentials");if(!list)return;
    try{
      const response=await fetch("/api/v1/devices",{credentials:"same-origin",cache:"no-store"});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const value=await response.json(),devices=value.devices||{};
      const rows=Object.entries(devices).filter(([,device])=>device?.enabled!==false).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true}));
      list.innerHTML=rows.length?rows.map(([id,device])=>{
        const path=`/display/${encodeURIComponent(id)}`,absolute=new URL(path,location.origin).toString();
        return `<div class="card" style="box-shadow:none;margin:8px 0"><div class="top" style="position:static;box-shadow:none;margin:0"><div><b>${escapeHtml(device?.name||id)}</b> <code>${escapeHtml(id)}</code> <span class="pill ok">Direct URL</span><div class="muted">Open this URL directly on the assigned TV/browser. The display ID is the identity; no enrollment or shared display token is required.</div></div><div class="toolbar"><a class="buttonLink" href="${escapeHtml(path)}" target="_blank" rel="noopener">Open Display</a></div></div><div class="toolbar" style="margin-top:8px"><input value="${escapeHtml(absolute)}" readonly style="flex:1;min-width:280px" aria-label="Display URL for ${escapeHtml(id)}"><button data-copy-display-url="${escapeHtml(absolute)}">Copy URL</button></div></div>`;
      }).join(""):"<div class=\"muted\">No enabled displays are configured.</div>";
      list.querySelectorAll("[data-copy-display-url]").forEach(button=>button.addEventListener("click",async()=>{const url=button.dataset.copyDisplayUrl||"";try{await navigator.clipboard.writeText(url);button.textContent="Copied";setTimeout(()=>button.textContent="Copy URL",1400)}catch{window.prompt("Copy display URL:",url)}}));
    }catch(error){list.innerHTML=`<div class="bad">Unable to load configured display URLs: ${escapeHtml(error.message)}</div>`}
  }

  window.ControlHubBranding={apply,load:async()=>{try{const response=await fetch("/api/v1/branding",{credentials:"same-origin",cache:"no-store"});if(!response.ok)throw Error(`HTTP ${response.status}`);const value=await response.json();return apply(value.branding||{})}catch{return apply(fallback)}}};
  window.ControlHubBranding.load();

  // The controller's historical display-enrollment panel is retained in the
  // static HTML for upgrade compatibility, but its behavior is replaced with
  // the direct /display/<id> workflow. Windows lab-agent enrollment is separate
  // and remains credentialed.
  if(!renderer&&location.pathname.startsWith("/controller")){
    window.loadDisplayCredentialSecurity=loadDirectDisplayUrls;
    directDisplayPanel();
  }

  // Integration setup is shared by the first-run wizard and the controller.
  // Keep it separate from branding internals while loading it from this common
  // entry point so both surfaces stay in sync.
  if(!renderer&&!document.querySelector('script[data-controlhub-integration-setup]')){
    const script=document.createElement("script");
    script.src="/shared/integration-setup.js";
    script.defer=true;
    script.dataset.controlhubIntegrationSetup="1";
    document.head.append(script);
  }

  // Preserve the class-default-target choice for linked automations. The base
  // alpha.71 editor incorrectly clears the checkbox when the primary action is
  // lighting even though later display actions can still use class targets.
  if(!renderer&&!document.querySelector('script[data-controlhub-automation-fix]')){
    const script=document.createElement("script");
    script.src="/shared/automation-hotfix.js";
    script.defer=true;
    script.dataset.controlhubAutomationFix="1";
    document.head.append(script);
  }
})();
