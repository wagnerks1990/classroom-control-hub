"use strict";
(()=>{
  const root=document.getElementById("devices"),terminal=document.getElementById("terminal");
  if(!root||!terminal)return;
  const KEEP="org.roomgoblin.display";
  const KIOSK_REMOVABLE=[
    "com.google.android.youtube.tv",
    "com.google.android.youtube.tvunplugged",
    "com.google.android.youtube.tvmusic",
    "com.netflix.ninja",
    "com.netflix.tokenmanager",
    "com.google.android.play.games",
    "com.google.android.apps.tv.dreamx",
    "com.android.dreams.basic",
    "com.google.android.feedback",
    "com.android.tv.feedbackconsent",
    "com.google.android.syncadapters.calendar",
    "com.android.providers.calendar",
    "com.android.providers.contacts",
    "com.android.wallpaperbackup",
    "com.android.htmlviewer"
  ];
  async function api(id,command,timeoutMs=60000){
    const r=await fetch(`/api/v1/maintenance/android/devices/${encodeURIComponent(id)}/shell`,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"content-type":"application/json"},body:JSON.stringify({command,timeoutMs})});
    const t=await r.text();let j={};try{j=JSON.parse(t)}catch{throw Error(t||`HTTP ${r.status}`)}if(!r.ok||j.ok===false)throw Error(j.error||`HTTP ${r.status}`);return j;
  }
  function show(title,j){terminal.textContent=`${title}\n${j.stdout||j.stderr||"(no output)"}`;}
  async function audit(id){
    const cmd=`echo '===== ALL PACKAGES ====='; pm list packages | sed 's/^package://' | sort; echo; echo '===== THIRD-PARTY ====='; pm list packages -3 | sed 's/^package://' | sort; echo; echo '===== SYSTEM ====='; pm list packages -s | sed 's/^package://' | sort; echo; echo '===== DISABLED ====='; pm list packages -d | sed 's/^package://' | sort`;
    show("Managed Kiosk audit",await api(id,cmd,30000));
  }
  async function clean(id){
    if(!confirm("Kiosk Minimal Mode will uninstall all non-Classroom-Hub third-party apps for user 0 and remove a curated set of nonessential TV/media packages for user 0. System framework, networking, ADB, WebView, Settings, System UI, package management, launcher fallback, Bluetooth/remote support, Google framework services, and device-management components are preserved. Third-party apps may require reinstallation to restore. Continue?"))return;
    const curated=KIOSK_REMOVABLE.join(" ");
    const cmd=`echo 'Removing third-party apps for user 0...'; for p in $(pm list packages -3 | sed 's/^package://'); do if [ "$p" != "${KEEP}" ]; then out=$(pm uninstall --user 0 "$p" 2>&1); rc=$?; if [ $rc -eq 0 ]; then echo "REMOVED=$p"; else echo "FAILED=$p :: $out"; fi; fi; done; echo; echo 'Removing curated nonessential kiosk packages for user 0...'; for p in ${curated}; do if pm path "$p" >/dev/null 2>&1; then out=$(pm uninstall --user 0 "$p" 2>&1); rc=$?; if [ $rc -eq 0 ]; then echo "REMOVED=$p"; else echo "FAILED=$p :: $out"; fi; else echo "SKIP_NOT_INSTALLED=$p"; fi; done; echo DONE`;
    show("Kiosk Minimal Mode applied",await api(id,cmd,120000));
  }
  root.addEventListener("click",async e=>{
    const b=e.target.closest("button");if(!b)return;const card=b.closest(".card[data-id]");if(!card)return;const id=card.dataset.id;
    if(b.dataset.op!=="audit-apps"&&b.dataset.op!=="minimal")return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();b.disabled=true;
    try{if(b.dataset.op==="audit-apps")await audit(id);else await clean(id);}catch(err){alert(`Managed kiosk cleanup: ${err.message}`)}finally{b.disabled=false}
  },true);
})();
