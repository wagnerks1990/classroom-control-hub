"use strict";

(function(){
  if(!document.documentElement.lang)document.documentElement.lang="en";

  const ROOMGOBLIN={
    productName:"RoomGoblin",
    descriptor:"Classroom & Lab Management Hub",
    tagline:"Run the room. Manage the lab.",
    school:"Your School",
    room:"Classroom",
    logoUrl:"/brand/roomgoblin_primary_400w.png",
    faviconUrl:"/brand/roomgoblin_app_32x32.png",
    theme:{
      mode:"dark",
      primary:"#0F766E",
      accent:"#22C55E",
      background:"#0B1320",
      surface:"#1E293B",
      text:"#F8FAFC"
    }
  };
  const LEGACY_PRODUCT_NAMES=new Set(["Classroom Control Hub","Classroom Hub"]);
  const renderer=/\/(display|document-viewer|antmedia-player)(\/|$)/.test(location.pathname);
  document.documentElement.dataset.brandSurface=renderer?"renderer":"operator";

  function normalize(branding={}){
    const incoming={...branding};
    if(!incoming.productName||LEGACY_PRODUCT_NAMES.has(incoming.productName))incoming.productName=ROOMGOBLIN.productName;
    if(!incoming.logoUrl)incoming.logoUrl=ROOMGOBLIN.logoUrl;
    if(!incoming.faviconUrl)incoming.faviconUrl=ROOMGOBLIN.faviconUrl;
    if(!incoming.descriptor)incoming.descriptor=ROOMGOBLIN.descriptor;
    if(!incoming.tagline)incoming.tagline=ROOMGOBLIN.tagline;
    const theme={...ROOMGOBLIN.theme,...(incoming.theme||{})};
    // Migrate the previous built-in palette while preserving deliberate site customization.
    if(theme.primary==="#2aa866")theme.primary=ROOMGOBLIN.theme.primary;
    if(theme.accent==="#1b7a49")theme.accent=ROOMGOBLIN.theme.accent;
    if(theme.background==="#040705")theme.background=ROOMGOBLIN.theme.background;
    if(theme.surface==="#121923")theme.surface=ROOMGOBLIN.theme.surface;
    if(theme.text==="#eef4f8")theme.text=ROOMGOBLIN.theme.text;
    return {...ROOMGOBLIN,...incoming,theme};
  }

  function ensureBrandStyles(){
    if(!document.querySelector('link[data-roomgoblin-brand]')){
      const css=document.createElement("link");
      css.rel="stylesheet";
      css.href="/shared/roomgoblin.css";
      css.dataset.roomgoblinBrand="1";
      document.head.append(css);
    }
  }

  function apply(branding={}){
    ensureBrandStyles();
    const profile=normalize(branding);
    const root=document.documentElement,theme=profile.theme;
    root.dataset.brandMode=theme.mode;
    root.dataset.product="roomgoblin";
    root.style.colorScheme=theme.mode==="system"?"light dark":theme.mode;
    for(const [key,value] of Object.entries(theme))if(key!=="mode")root.style.setProperty(`--brand-${key}`,value);
    root.style.setProperty("--green",theme.primary);
    root.style.setProperty("--green2",theme.accent);
    root.style.setProperty("--text",theme.text);
    root.style.setProperty("--accent",theme.accent);
    document.querySelectorAll("[data-brand-product]").forEach(x=>x.textContent=profile.productName);
    document.querySelectorAll("[data-brand-school]").forEach(x=>x.textContent=profile.school);
    document.querySelectorAll("[data-brand-room]").forEach(x=>x.textContent=profile.room);
    document.querySelectorAll("[data-brand-descriptor]").forEach(x=>x.textContent=profile.descriptor);
    document.querySelectorAll("[data-brand-tagline]").forEach(x=>x.textContent=profile.tagline);

    if(document.title.includes("Classroom Control Hub"))document.title=document.title.replace("Classroom Control Hub",profile.productName);
    else if(document.title.includes("Classroom Hub"))document.title=document.title.replace("Classroom Hub",profile.productName);

    let icon=document.querySelector("link[rel~='icon']");
    if(!icon){icon=document.createElement("link");icon.rel="icon";document.head.append(icon)}
    if(profile.faviconUrl)icon.href=profile.faviconUrl;

    // Upgrade first-run defaults without touching compatibility-sensitive storage keys.
    const productInput=document.getElementById("productName");
    if(productInput&&(!productInput.value||LEGACY_PRODUCT_NAMES.has(productInput.value)))productInput.value=profile.productName;
    const legacySetupLabel=[...document.querySelectorAll(".step")].find(x=>/Classroom (Control )?Hub/i.test(x.textContent||""));
    if(legacySetupLabel)legacySetupLabel.textContent=(legacySetupLabel.textContent||"").replace(/Classroom Control Hub|Classroom Hub/g,profile.productName);
    for(const button of document.querySelectorAll("button")){
      if(/Open Classroom Control Hub|Open Classroom Hub/i.test(button.textContent||""))button.textContent=`Open ${profile.productName}`;
    }
    const setupTheme={themePrimary:ROOMGOBLIN.theme.primary,themeAccent:ROOMGOBLIN.theme.accent,themeBackground:ROOMGOBLIN.theme.background,themeSurface:ROOMGOBLIN.theme.surface,themeText:ROOMGOBLIN.theme.text};
    for(const [id,value] of Object.entries(setupTheme)){
      const field=document.getElementById(id);
      const legacy={themePrimary:"#2aa866",themeAccent:"#1b7a49",themeBackground:"#040705",themeSurface:"#121923",themeText:"#eef4f8"}[id];
      if(field&&(!field.value||field.value.toLowerCase()===legacy))field.value=value;
    }

    window.CONTROL_HUB_BRANDING=profile; // legacy public API retained for integrations.
    window.ROOMGOBLIN_BRANDING=profile;
    window.dispatchEvent(new CustomEvent("controlhub:branding",{detail:profile}));
    window.dispatchEvent(new CustomEvent("roomgoblin:branding",{detail:profile}));
    return profile;
  }

  function managedDisplaysOverviewLink(){
    if(!location.pathname.startsWith("/controller"))return;
    const overview=document.getElementById("overview"),toolbar=overview?.querySelector(":scope > .top .toolbar");
    if(!toolbar||toolbar.querySelector('[data-managed-displays-link]'))return;
    const link=document.createElement("a");link.className="buttonLink";link.href="/managed-displays/";link.textContent="Managed Displays";link.dataset.managedDisplaysLink="1";
    const refresh=[...toolbar.querySelectorAll("button")].find(button=>String(button.getAttribute("onclick")||"").includes("refreshOverview"));
    if(refresh)refresh.after(link);else toolbar.prepend(link);
  }

  window.RoomGoblinBranding={apply,normalize,load:async()=>{try{const response=await fetch("/api/v1/branding",{credentials:"same-origin",cache:"no-store"});if(!response.ok)throw Error(`HTTP ${response.status}`);const value=await response.json();return apply(value.branding||{})}catch{return apply(ROOMGOBLIN)}}};
  // Compatibility alias for existing modules and third-party integrations.
  window.ControlHubBranding=window.RoomGoblinBranding;
  window.RoomGoblinBranding.load();

  if(!renderer&&location.pathname.startsWith("/controller"))managedDisplaysOverviewLink();

  if(!renderer&&!document.querySelector('script[data-controlhub-integration-setup]')){
    const script=document.createElement("script");script.src="/shared/integration-setup.js";script.defer=true;script.dataset.controlhubIntegrationSetup="1";document.head.append(script);
  }
  if(!renderer&&!document.querySelector('script[data-controlhub-automation-fix]')){
    const script=document.createElement("script");script.src="/shared/automation-hotfix.js";script.defer=true;script.dataset.controlhubAutomationFix="1";document.head.append(script);
  }
})();
