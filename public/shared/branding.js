"use strict";

(function(){
  const fallback={productName:"Classroom Control Hub",organizationName:"Your Organization",siteName:"Primary Site",spaceName:"Main Space",logoUrl:"",faviconUrl:"",theme:{mode:"dark",primary:"#2aa866",accent:"#1b7a49",background:"#040705",surface:"#121923",text:"#eef4f8"},terminology:{space:"Space",endpoint:"Endpoint",operator:"Operator",schedule:"Schedule"}};
  const renderer=/\/(display|document-viewer|antmedia-player)(\/|$)/.test(location.pathname);
  document.documentElement.dataset.brandSurface=renderer?"renderer":"operator";

  function apply(branding={}){
    const profile={...fallback,...branding,theme:{...fallback.theme,...(branding.theme||{})},terminology:{...fallback.terminology,...(branding.terminology||{})}};
    const root=document.documentElement,theme=profile.theme;
    root.dataset.brandMode=theme.mode;
    root.style.colorScheme=theme.mode==="system"?"light dark":theme.mode;
    for(const [key,value] of Object.entries(theme))if(key!=="mode")root.style.setProperty(`--brand-${key}`,value);
    root.style.setProperty("--green",theme.primary);
    root.style.setProperty("--green2",theme.accent);
    root.style.setProperty("--text",theme.text);
    root.style.setProperty("--accent",theme.primary);
    document.querySelectorAll("[data-brand-product]").forEach(x=>x.textContent=profile.productName);
    document.querySelectorAll("[data-brand-organization]").forEach(x=>x.textContent=profile.organizationName);
    document.querySelectorAll("[data-brand-site]").forEach(x=>x.textContent=profile.siteName);
    document.querySelectorAll("[data-brand-space]").forEach(x=>x.textContent=profile.spaceName);
    if(document.title.includes("Classroom Control Hub"))document.title=document.title.replace("Classroom Control Hub",profile.productName);
    if(profile.faviconUrl){let icon=document.querySelector("link[rel~='icon']");if(!icon){icon=document.createElement("link");icon.rel="icon";document.head.append(icon)}icon.href=profile.faviconUrl}
    window.CONTROL_HUB_BRANDING=profile;
    window.dispatchEvent(new CustomEvent("controlhub:branding",{detail:profile}));
    return profile;
  }

  window.ControlHubBranding={apply,load:async()=>{try{const response=await fetch("/api/v1/branding",{credentials:"same-origin",cache:"no-store"});if(!response.ok)throw Error(`HTTP ${response.status}`);const value=await response.json();return apply(value.branding||{})}catch{return apply(fallback)}}};
  window.ControlHubBranding.load();
})();
