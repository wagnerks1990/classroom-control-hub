const S={pluto:{},govee:null,displayDevices:{},schedules:{},automations:[],mediaFiles:[],classes:[],classStatus:null,scheduler:null,schedulerCalendar:{excludedDates:[]},scheduleProfile:{cycleDays:['A','B'],dayGroups:[{label:'Day A',cycleDays:['A']},{label:'Day B',cycleDays:['B']}]},districtNoSchoolDates:[]};
const PRES={folders:[],presentations:[],state:null,currentFolder:'root',selectedId:null,displays:[],previewSlide:1};
async function api(url,opt={}){const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...opt});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j={raw:t}}if(r.status===401&&(j.authRequired||window.AUTH_STATUS?.authEnabled)){window.AUTH_STATUS={...(window.AUTH_STATUS||{}),user:null};applyAuthUi(window.AUTH_STATUS);showLogin();throw Error('Authentication required')}if(!r.ok)throw Error(j.error||j.message||('HTTP '+r.status));return j}
function jpost(url,obj){return api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)})}
let toastTimer=null;function notify(message,type='info'){const el=document.getElementById('hubToast');if(!el)return;el.textContent=String(message||'');el.style.display='block';el.style.borderColor=type==='error'?'#9b3a3a':type==='success'?'#2d8a57':'#3a4a5a';clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.style.display='none',4500)}

const CLASSROOM_HUB_VERSION='1.0.0-alpha.79';
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&loginOverlay?.style.display==='flex'&&document.activeElement===loginPassword)performLogin()});
let brandCycleState=null;

function formatBrandDateTime(){
  const now=new Date();
  const date=now.toLocaleDateString('en-US',{
    weekday:'short',month:'short',day:'numeric',year:'numeric'
  });
  const time=now.toLocaleTimeString('en-US',{
    hour:'numeric',minute:'2-digit',second:'2-digit'
  });
  if(window.brandDateTime)brandDateTime.textContent=`${date} • ${time}`;
}
function paintBrandCycle(){
  if(!window.brandCycle)return;
  const x=brandCycleState;
  if(!x){
    brandCycle.textContent='School cycle unavailable';
    return;
  }
  if(x.isStudentSchoolDay){
    const cls='cycle';
    brandCycle.innerHTML=`<span class="${cls}">${esc(x.dayColor)} Day</span> • <span class="cycle">Cycle ${esc(x.cycleDay)}</span>`;
  }else{
    const projected=x.projectedDayColor&&x.projectedCycleDay
      ? ` • Next cycle position: ${x.projectedDayColor} / ${x.projectedCycleDay}`
      : '';
    brandCycle.innerHTML=`No Student Cycle Today${x.reason?` • ${esc(x.reason)}`:''}${esc(projected)}`;
  }
}
function applySiteBranding(site={},fromShared=false){
  const product=String(site.productName||'RoomGoblin');
  const school=String(site.school||'').trim();
  const room=String(site.room||'').trim();
  const logo=String(site.logoUrl||'').trim();
  document.title=`${room?room+' • ':''}${product}`;
  if(window.brandProductName)brandProductName.textContent=product;
  if(window.brandSite)brandSite.textContent=[room,school].filter(Boolean).join(' • ')||product;
  if(window.footerSiteName)footerSiteName.textContent=school||room||product;
  if(window.footerProductName)footerProductName.textContent=product;
  if(window.brandLogoWrap&&window.brandLogo){
    brandLogoWrap.style.display=logo?'':'none';
    if(logo){brandLogo.src=logo;brandLogo.alt=`${school||product} logo`;brandLogoWrap.title=school||product;}
  }
  if(!fromShared&&window.ControlHubBranding)window.ControlHubBranding.apply(site);
}
window.addEventListener('controlhub:branding',event=>applySiteBranding(event.detail||{},true));
async function loadSiteBranding(){try{const j=await api('/api/v1/admin/config');applySiteBranding(j.site||{})}catch{}}
async function refreshBrandStatus(){
  formatBrandDateTime();
  if(window.brandVersion)brandVersion.textContent=`v${CLASSROOM_HUB_VERSION}`;
  try{
    brandCycleState=await api('/api/v1/school-cycle');
    paintBrandCycle();
  }catch(e){
    if(window.brandCycle)brandCycle.textContent=`School cycle error: ${e.message}`;
  }
}
function startBrandClock(){
  formatBrandDateTime();
  setInterval(formatBrandDateTime,1000);
  refreshBrandStatus();
  setInterval(refreshBrandStatus,60000);
}

function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function encodeInlineValue(v){
  const bytes=new TextEncoder().encode(String(v??''));
  let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
  return btoa(binary);
}
function decodeInlineValue(v){
  const binary=atob(String(v||'')),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function inlineJsArg(v){return `decodeInlineValue('${encodeInlineValue(v)}')`}
function configuredDisplayTargets(includeAll=true){
  const rows=Object.entries(S.displayDevices||{}).filter(([,d])=>d?.enabled!==false).map(([id,d])=>[id,String(d?.name||id)]);
  return includeAll?[['all','All Displays'],...rows]:rows;
}
function populateDisplaySelect(select,current){
  if(!select)return;const rows=configuredDisplayTargets(false),wanted=current||select.value;
  select.replaceChildren(...rows.map(([id,name])=>{const o=document.createElement('option');o.value=id;o.textContent=name;return o}));
  if(rows.some(([id])=>id===wanted))select.value=wanted;
}
function activateLazyPageFrame(id){const frame=document.querySelector(`#${CSS.escape(id)} iframe[data-lazy-src]`);if(frame&&!frame.src)frame.src=frame.dataset.lazySrc}
function showLabConsole(kind){
  const windows=kind==='windows',vf=document.getElementById('labVeyonFrame'),wf=document.getElementById('labWindowsFrame');
  if(!vf||!wf)return;vf.hidden=windows;wf.hidden=!windows;
  labVeyonTab.classList.toggle('primary',!windows);labWindowsTab.classList.toggle('primary',windows);
  labVeyonTab.setAttribute('aria-selected',String(!windows));labWindowsTab.setAttribute('aria-selected',String(windows));
  const active=windows?wf:vf;if(!active.src)active.src=active.dataset.lazySrc;
  labConsoleHelp.textContent=windows?'The Windows agent provides enrolled-computer inventory, screenshots, browser-history review, and supported power/session commands.':'Veyon monitoring uses the configured Veyon WebAPI integration.';
}
function showPage(id){const page=document.getElementById(id);if(!page||page.dataset.authorized==='false')return notify('Your account does not have access to that classroom feature.','error');document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===id));document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===id));activateLazyPageFrame(id);if(id==='av'||id==='tvs')refreshPluto();if(id==='presentations')loadPresentations();if(id==='media')loadMedia();if(id==='lights')loadGovee();if(id==='lab')loadLabAgentCredentials();if(id==='classes')loadClassSchedules();if(id==='schedules'){loadSchedules();ensureAutomationMediaLibrary().then(refreshAutomationMediaPickers);}if(id==='diagnostics')loadDiagnostics();if(id==='settings')loadAdminConfiguration();if(id==='system')loadSystemManagement();if(id==='music')loadMusicAssistant()}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>showPage(b.dataset.page));

function overviewContentSummary(state={}){
  const tags=[];
  if(state.presentationBlack)tags.push('Black Screen');
  if(state.media?.type){
    const labels={image:'Image',video:'Video',web:'Website',pdf:'PDF / Document'};
    tags.push(labels[state.media.type]||state.media.type);
  }
  if(state.title)tags.push('Title');
  if(state.text)tags.push('Text');
  if(state.subtitle)tags.push('Subtitle');
  if(state.timer?.visible)tags.push(state.timer.running?'Timer Running':'Timer');
  if(!tags.length)tags.push('Clear / Idle');
  return tags;
}
function overviewLastSeen(status={}){
  if(!status.lastSeen)return 'Never';
  const d=new Date(status.lastSeen);
  if(Number.isNaN(d.getTime()))return String(status.lastSeen);
  const sec=Math.max(0,Math.floor((Date.now()-d.getTime())/1000));
  if(sec<10)return 'just now';
  if(sec<60)return `${sec}s ago`;
  if(sec<3600)return `${Math.floor(sec/60)}m ago`;
  return d.toLocaleString();
}
function overviewDisplayName(id,config={}){
  return config.name||config.label||config.displayName||id.toUpperCase();
}
function overviewResolutionParts(value){
  const m=String(value||'').match(/^(\d+)x(\d+)$/i);
  if(!m)return {width:1920,height:1080,label:'Unknown resolution'};
  return {width:Number(m[1]),height:Number(m[2]),label:`${m[1]}x${m[2]}`};
}
function scaleOverviewDisplayPreviews(){
  document.querySelectorAll('.displayPreview iframe[data-overview-preview]').forEach(frame=>{
    const viewport=frame.closest('.displayPreview');
    if(!viewport)return;
    const logicalWidth=Math.max(320,Number(frame.dataset.logicalWidth)||1920);
    const logicalHeight=Math.max(200,Number(frame.dataset.logicalHeight)||1080);
    const w=viewport.clientWidth,h=viewport.clientHeight;
    if(!w||!h)return;
    const scale=Math.min(w/logicalWidth,h/logicalHeight);
    const scaledW=logicalWidth*scale,scaledH=logicalHeight*scale;
    frame.style.width=`${logicalWidth}px`;
    frame.style.height=`${logicalHeight}px`;
    frame.style.transform=`translate(${Math.max(0,(w-scaledW)/2)}px,${Math.max(0,(h-scaledH)/2)}px) scale(${scale})`;
  });
}
function overviewAvStatusLine(id,config){const o=Number(config.avOutput||0),p=S.overviewPluto||{},input=Number(p.videoStatus?.allsource?.[o-1]||0),labels=p.labels||{},source=labels.inputs?.[input-1]||`Content Source ${input||'—'}`;return o?`<div class="overviewAvLine"><b>HDBT ${o}</b> • Source: <b>${esc(source)}</b></div>`:''}
async function overviewTestImage(id,output){if(!output)return;await sendTvTestImage(id,output);notify(`Test image sent to ${overviewDisplayName(id,(S.avConfig?.devices||{})[id]||{})}.`,'success')}
async function overviewTvPower(output,index){if(!output)return;await plutoAction({action:'cecOutput',output:Number(output),connection:'hdbt',index},false)}
function renderOverviewDisplays(devicesResponse,statusResponse){
  const configs=devicesResponse?.devices||{};
  const statuses=devicesResponse?.status||statusResponse?.runtime?.displays||{};
  const states=statusResponse?.state?.displays||{};
  const ids=Object.keys(configs).filter(id=>configs[id]?.enabled!==false).sort((a,b)=>a.localeCompare(b,{numeric:true}));
  const onlineCount=ids.filter(id=>statuses[id]?.online).length;

  overviewDisplaySummary.textContent=`${onlineCount} / ${ids.length} Online`;
  overviewDisplaySummary.className='kpi '+(onlineCount===ids.length&&ids.length?'ok':onlineCount?'':'bad');
  overviewDisplayDetail.textContent=ids.length
    ? `${ids.length-onlineCount} offline • ${ids.length} configured display${ids.length===1?'':'s'}`
    : 'No displays configured.';

  overviewDisplays.innerHTML=ids.length?ids.map(id=>{
    const config=configs[id]||{},status=statuses[id]||{},state=states[id]||{};
    const online=!!status.online;
    const resolution=status.meta?.resolution||status.resolution||'';
    const logical=overviewResolutionParts(resolution);
    const content=overviewContentSummary(state);
    return `<div class="displayOverviewCard">
      <div class="displayPreview">
        ${online
          ? `<iframe data-overview-preview="${esc(id)}" data-logical-width="${logical.width}" data-logical-height="${logical.height}" src="/display/${encodeURIComponent(id)}?preview=1&overview=${Date.now()}" title="${esc(id)} preview"></iframe>`
          : `<div class="displayPreviewOffline"><div style="text-align:center"><b>${esc(overviewDisplayName(id,config))}</b><br>Display offline</div></div>`}
      </div>
      <div class="displayOverviewBody">
        <div class="displayOverviewTitle">
          <div class="displayOverviewName">${esc(overviewDisplayName(id,config))}</div>
          <div class="${online?'displayStatusOnline':'displayStatusOffline'}">${online?'ONLINE':'OFFLINE'}</div>
        </div>
        <div class="displayMeta">
          ID: ${esc(id)} • ${esc(logical.label)}<br>
          Last seen: ${esc(overviewLastSeen(status))}
        </div>
        <div style="margin-top:7px">${content.map(x=>`<span class="contentBadge">${esc(x)}</span>`).join('')}</div>
        ${overviewAvStatusLine(id,config)}
        <div class="toolbar" style="margin-top:10px">
          <button onclick="overviewTestImage(${inlineJsArg(id)},${Number(config.avOutput)||0})">Test Image</button>
          <button onclick="overviewTvPower(${Number(config.avOutput)||0},0)">Power On</button>
          <button onclick="overviewTvPower(${Number(config.avOutput)||0},1)">Power Off</button>
          <button onclick="window.open('/display/${encodeURIComponent(id)}?preview=1','_blank','noopener')">Preview</button>
        </div>
      </div>
    </div>`;
  }).join(''):'<div class="muted">No displays configured.</div>';
  requestAnimationFrame(scaleOverviewDisplayPreviews);
}
function refreshOverviewDisplayPreviews(){
  document.querySelectorAll('[data-overview-preview]').forEach(frame=>{
    const id=frame.dataset.overviewPreview;
    frame.src=`/display/${encodeURIComponent(id)}?preview=1&overview=${Date.now()}`;
  });
  requestAnimationFrame(scaleOverviewDisplayPreviews);
}
async function reloadAllDisplays(){
  if(!confirm('Reload every online physical display? Current display content will reconnect automatically.'))return;
  try{
    const j=await api('/api/v1/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'display.reload',target:'all',payload:{reason:'operator-request',requestedAt:new Date().toISOString()}})});
    notify(`Reload command sent to ${(j.deliveries?.websocket||[]).length||'all online'} display(s).`,'success');
    setTimeout(()=>refreshOverview(),1800);
  }catch(e){notify(e.message,'error')}
}
const overviewPreviewResizeObserver=new ResizeObserver(()=>scaleOverviewDisplayPreviews());
const overviewDisplaysObserverTarget=document.getElementById('overviewDisplays');
if(overviewDisplaysObserverTarget)overviewPreviewResizeObserver.observe(overviewDisplaysObserverTarget);
async function refreshOverview(){
  try{
    const [st,intg,dev,classes,pluto]=await Promise.all([
      api('/api/v1/status'),
      api('/api/v1/integrations/check').catch(e=>({ok:false,error:e.message})),
      api('/api/v1/devices').catch(()=>({devices:{},status:{}})),
      api('/api/v1/class-schedules').catch(()=>({})),
      api('/api/v1/pluto/status').catch(()=>({}))
    ]);
    S.displayDevices=dev.devices||S.displayDevices||{};
    populateDisplaySelect(window.mediaTarget);

    hubState.textContent=st.ok?'ONLINE':'ERROR';
    hubState.className='kpi '+(st.ok?'ok':'bad');

    mqttState.textContent=intg.mqtt?.connected?'ONLINE':'OFFLINE';
    mqttState.className='kpi '+(intg.mqtt?.connected?'ok':'bad');

    plutoState.textContent=intg.hardware?.pluto?.reachable?'ONLINE':'OFFLINE';
    plutoState.className='kpi '+(intg.hardware?.pluto?.reachable?'ok':'bad');

    const cy=classes.schoolCycle||brandCycleState||{};
    if(cy.isStudentSchoolDay){
      overviewSchoolDay.textContent=`${cy.dayColor} Day • Cycle ${cy.cycleDay}`;
      overviewSchoolDay.className='kpi ok';
    }else{
      overviewSchoolDay.textContent='No Student Cycle Today';
      overviewSchoolDay.className='kpi';
    }

    if(classes.activeClass){
      const end=classes.activeClass.endTime||new Date(classes.activeClass.endAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
      overviewClassStatus.innerHTML=`<b>Current:</b> ${esc(classes.activeClass.name)} • ends ${esc(end)}`;
    }else if(classes.nextClass){
      const next=new Date(classes.nextClass.nextStartAt);
      overviewClassStatus.innerHTML=`<b>Next:</b> ${esc(classes.nextClass.name)} • ${esc(next.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}))}`;
    }else{
      overviewClassStatus.textContent=cy.reason?`No active class • ${cy.reason}`:'No active or upcoming class.';
    }

    S.overviewPluto=pluto; renderOverviewDisplays(dev,st);
  }catch(e){
    if(window.overviewDisplays)overviewDisplays.innerHTML=`<div class="bad">Overview error: ${esc(e.message)}</div>`;
  }
}
async function clearClassroom(){if(!confirm('Blank ALL enabled classroom displays?'))return;const j=await jpost('/api/v1/classroom/clear-all',{});alert(`Classroom cleared on ${(j.targets||[]).length} display(s).`)}



function fmtTimer(sec){
 sec=Math.max(0,Number(sec)||0);const m=Math.floor(sec/60),s=Math.floor(sec%60);
 return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function presFolder(id){return PRES.folders.find(f=>f.id===id)}
function presFile(id){return PRES.presentations.find(p=>p.id===id)}
function presChildren(id){return PRES.folders.filter(f=>f.parentId===id)}
function presFolderPath(id){
 const names=[];let cur=presFolder(id),guard=0;
 while(cur&&guard++<30){names.unshift(cur.name);cur=cur.parentId?presFolder(cur.parentId):null}
 return names.join(' / ')||'Presentations';
}
function presentationUrl(p,slide){
 if(!p||!p.slideCount)return '';
 const n=Math.max(1,Math.min(Number(slide)||1,p.slideCount));
 return `/presentations/${encodeURIComponent(p.id)}/slides/slide-${String(n).padStart(3,'0')}.jpg`;
}
async function loadPresentations(){
 try{
  const j=await api('/api/v1/presentations');
  PRES.folders=j.folders||[];PRES.presentations=j.presentations||[];PRES.state=j.state||null;PRES.displays=j.displays||[];
  if(!presFolder(PRES.currentFolder))PRES.currentFolder='root';
  if(PRES.selectedId&&!presFile(PRES.selectedId))PRES.selectedId=null;
  if(!PRES.selectedId&&PRES.state?.presentationId)PRES.selectedId=PRES.state.presentationId;
  if(PRES.state?.active&&PRES.state?.presentationId===PRES.selectedId)PRES.previewSlide=Number(PRES.state.slide||1);
  renderPresentationLibrary();renderPresentationTargets();renderPresenter();
 }catch(e){presentationRows.innerHTML=`<div class="bad">${esc(e.message)}</div>`}
}
function renderPresentationLibrary(){
 presFolderSelect.innerHTML=PRES.folders
   .slice().sort((a,b)=>presFolderPath(a.id).localeCompare(presFolderPath(b.id)))
   .map(f=>`<option value="${esc(f.id)}" ${f.id===PRES.currentFolder?'selected':''}>${esc(presFolderPath(f.id))}</option>`).join('');
 presBreadcrumb.textContent=presFolderPath(PRES.currentFolder);
 const folders=presChildren(PRES.currentFolder);
 presFolderRows.innerHTML=folders.map(f=>`<div class="card" style="margin:8px 0">
   <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
     <div><b>📁 ${esc(f.name)}</b><br><span class="muted">${PRES.presentations.filter(p=>p.folderId===f.id).length} file(s)</span></div>
     <div class="toolbar">
       <button onclick="setPresentationFolder(${inlineJsArg(f.id)})">Open</button>
       <button onclick="renamePresentationFolder(${inlineJsArg(f.id)})">Rename</button>
       <button onclick="movePresentationFolder(${inlineJsArg(f.id)})">Move</button>
       <button class="danger" onclick="deletePresentationFolder(${inlineJsArg(f.id)},${inlineJsArg(f.name)})">Delete</button>
     </div>
   </div>
 </div>`).join('')||'<div class="muted">No subfolders.</div>';

 const files=PRES.presentations.filter(p=>p.folderId===PRES.currentFolder).sort((a,b)=>a.name.localeCompare(b.name));
 presentationRows.innerHTML=files.map(p=>`<div class="card" style="margin:8px 0;${PRES.selectedId===p.id?'border-color:var(--green)':''}">
   <div style="display:flex;gap:12px;align-items:center">
     ${p.firstSlideUrl?`<img src="${esc(p.firstSlideUrl)}" alt="First slide of ${esc(p.name)}" style="width:130px;aspect-ratio:16/9;object-fit:contain;background:#000;border-radius:8px">`:''}
     <div style="flex:1;min-width:0"><b>${esc(p.name)}</b><br>
       <span class="muted">${esc(p.originalName||'')} • ${p.slideCount||0} slides • ${esc(p.conversionStatus||'')}</span>
       ${p.conversionError?`<div class="bad">${esc(p.conversionError)}</div>`:''}
     </div>
     <div class="toolbar">
       <button class="primary" onclick="selectPresentation(${inlineJsArg(p.id)})">Select</button>
       <button onclick="renamePresentation(${inlineJsArg(p.id)})">Rename</button>
       <button onclick="movePresentation(${inlineJsArg(p.id)})">Move</button>
       ${p.conversionStatus!=='ready'?`<button onclick="rebuildPresentation(${inlineJsArg(p.id)})">Rebuild</button>`:''}
       <button class="danger" onclick="deletePresentation(${inlineJsArg(p.id)},${inlineJsArg(p.name)})">Delete</button>
     </div>
   </div>
 </div>`).join('')||'<div class="muted">No presentations in this folder.</div>';
}
function setPresentationFolder(id){PRES.currentFolder=id;renderPresentationLibrary()}
async function newPresentationFolder(){
 const name=prompt('New folder name:');if(!name)return;
 await jpost('/api/v1/presentations/folders',{name,parentId:PRES.currentFolder});loadPresentations();
}
async function renamePresentationFolder(id){
 const f=presFolder(id),name=prompt('Folder name:',f?.name||'');if(!name)return;
 await api('/api/v1/presentations/folders/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});loadPresentations();
}
function folderChoicePrompt(currentId,excludeId=null){
 const options=PRES.folders.filter(f=>f.id!==excludeId).map(f=>`${f.id} = ${presFolderPath(f.id)}`).join('\n');
 const answer=prompt(`Enter destination folder ID:\n\n${options}`,currentId||'root');
 return answer&&presFolder(answer)?answer:null;
}
async function movePresentationFolder(id){
 const f=presFolder(id);if(!f)return;
 const parentId=folderChoicePrompt(f.parentId||'root',id);if(!parentId)return;
 await api('/api/v1/presentations/folders/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({parentId})});loadPresentations();
}
async function deletePresentationFolder(id,name){
 if(!confirm(`Delete folder "${name}" and everything inside it?`))return;
 await api('/api/v1/presentations/folders/'+encodeURIComponent(id)+'?recursive=1',{method:'DELETE'});PRES.currentFolder='root';loadPresentations();
}
function selectPresentation(id){
 const changed=PRES.selectedId!==id;
 PRES.selectedId=id;
 if(changed)PRES.previewSlide=1;
 renderPresentationLibrary();
 renderPresenter();
}
async function renamePresentation(id){
 const p=presFile(id),name=prompt('Presentation name:',p?.name||'');if(!name)return;
 await api('/api/v1/presentations/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});loadPresentations();
}
async function movePresentation(id){
 const p=presFile(id);if(!p)return;const folderId=folderChoicePrompt(p.folderId);if(!folderId)return;
 await api('/api/v1/presentations/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({folderId})});loadPresentations();
}
async function deletePresentation(id,name){
 if(!confirm(`Delete presentation "${name}" and all rendered slides?`))return;
 await api('/api/v1/presentations/'+encodeURIComponent(id),{method:'DELETE'});
 if(PRES.selectedId===id)PRES.selectedId=null;loadPresentations();
}
async function rebuildPresentation(id){
 presentationUploadState.textContent='Rendering slides…';
 try{await jpost('/api/v1/presentations/'+encodeURIComponent(id)+'/rebuild',{});presentationUploadState.textContent='Ready';loadPresentations()}
 catch(e){presentationUploadState.textContent=e.message}
}
function renderPresentationTargets(){
 presTargets.innerHTML=PRES.displays.map((d,i)=>`<label style="display:flex;gap:5px;align-items:center">
   <input type="checkbox" class="presTargetCheck" value="${esc(d.id)}" checked> ${esc(d.name||d.id)}
 </label>`).join('');
}
function selectedPresentationTargets(){
 return [...document.querySelectorAll('.presTargetCheck:checked')].map(x=>x.value);
}
async function startSelectedPresentation(){
 const p=presFile(PRES.selectedId);if(!p)return alert('Select a presentation first.');
 const targets=selectedPresentationTargets();if(!targets.length)return alert('Select at least one TV.');
 try{
  const j=await jpost('/api/v1/presentations/'+encodeURIComponent(p.id)+'/start',{
    targets,
    slide:Number(presStartSlide.value)||1,
    autoAdvanceSeconds:Number(presStartAuto.value)||0,
    loop:presStartLoop.checked,
    targetSeconds:Number(presTargetSeconds.value)||0
  });
  PRES.state=j.state;renderPresenter();
 }catch(e){alert(e.message)}
}
async function presentationControl(action,extra={}){
 try{
  const j=await jpost('/api/v1/presentations/control',{action,...extra});
  PRES.state=j.state;if(j.state?.presentationId)PRES.selectedId=j.state.presentationId;renderPresenter();
 }catch(e){alert(e.message)}
}
function presentationSetAuto(){
 presentationControl('set-auto',{seconds:Number(presAutoSeconds.value)||0,loop:presLoop.checked});
}
function renderPresenter(){
 const p=presFile(PRES.selectedId),st=PRES.state||{};
 const active=st.active&&st.presentationId===PRES.selectedId;
 presSelectedName.textContent=p?`${p.name} • ${p.slideCount||0} slides`:'Select a presentation.';
 presStateBadge.textContent=st.active?(st.paused?'PAUSED':(st.black?'BLACK':'LIVE')):'IDLE';
 const slide=active
   ? Number(st.slide||1)
   : Math.max(1,Math.min(Number(PRES.previewSlide||1),Number(p?.slideCount||1)));
 if(active)PRES.previewSlide=slide;
 presSlideMetric.textContent=p?`${slide} / ${p.slideCount||0}`:'—';
 presGoto.max=p?.slideCount||1;presGoto.value=slide;
 presTargetSeconds.value=Number(st.targetSeconds||0);
 presAutoSeconds.value=Number(st.autoAdvanceSeconds||0);
 presLoop.checked=!!st.loop;
 presPauseBtn.textContent=st.paused?'Resume':'Pause';
 presBlackBtn.textContent=st.black?'Return to Slides':'Black Screen';
 presTargetStatus.textContent=active?`Showing on: ${(st.targets||[]).join(', ')}`:'Not currently presenting.';
 if(p&&p.slideCount){
   presCurrentImage.src=presentationUrl(p,slide);presCurrentImage.style.display='block';presCurrentEmpty.style.display='none';
   if(slide<p.slideCount){presNextImage.src=presentationUrl(p,slide+1);presNextImage.style.display='block';presNextEmpty.style.display='none'}
   else{presNextImage.style.display='none';presNextEmpty.style.display='inline'}
   presNotes.value=active?(st.notes||p.notes?.[slide-1]||''):(p.notes?.[slide-1]||'');
   presThumbs.innerHTML=Array.from({length:p.slideCount},(_,i)=>`<button title="Slide ${i+1}" onclick="${active?`presentationControl('goto',{slide:${i+1}})`:`previewPresentationSlide(${i+1})`}" style="padding:3px;flex:0 0 120px">
      <img src="${presentationUrl(p,i+1)}" alt="Slide ${i+1}" style="width:100%;aspect-ratio:16/9;object-fit:contain">
      <div>${i+1}</div>
   </button>`).join('');
 }else{
   presCurrentImage.style.display='none';presCurrentEmpty.style.display='inline';presNextImage.style.display='none';presNextEmpty.style.display='inline';presNotes.value='';presThumbs.innerHTML='';
 }
 const timings=st.timings||{};
 presTimingHistory.innerHTML=Object.keys(timings).length?Object.entries(timings).sort((a,b)=>Number(a[0])-Number(b[0])).map(([n,v])=>`Slide ${n}: <b>${fmtTimer(v)}</b>`).join(' • '):'No timing data yet.';
 updatePresentationTimers();
}
function previewPresentationSlide(n){
 const p=presFile(PRES.selectedId);if(!p)return;
 n=Math.max(1,Math.min(Number(n)||1,p.slideCount||1));
 PRES.previewSlide=n;
 presCurrentImage.src=presentationUrl(p,n);presCurrentImage.style.display='block';presCurrentEmpty.style.display='none';
 presSlideMetric.textContent=`${n} / ${p.slideCount}`;presGoto.value=n;presNotes.value=p.notes?.[n-1]||'';
 if(n<p.slideCount){presNextImage.src=presentationUrl(p,n+1);presNextImage.style.display='block';presNextEmpty.style.display='none'}else{presNextImage.style.display='none';presNextEmpty.style.display='inline'}
}
function updatePresentationTimers(){
 const st=PRES.state||{};
 presSlideTimer.textContent=fmtTimer(st.slideElapsedSeconds||0);
 presTotalTimer.textContent=fmtTimer(st.presentationElapsedSeconds||0);
 const target=Number(st.targetSeconds||0),elapsed=Number(st.slideElapsedSeconds||0);
 if(target>0){
   presSlideTimer.textContent=elapsed<=target?`${fmtTimer(elapsed)} (${fmtTimer(target-elapsed)} left)`:`${fmtTimer(elapsed)} (+${fmtTimer(elapsed-target)})`;
 }
}
setInterval(async()=>{
 if(!document.getElementById('presentations')?.classList.contains('active'))return;
 try{
   const j=await api('/api/v1/presentations/state');
   PRES.state=j.state;if(j.state?.presentationId)PRES.selectedId=j.state.presentationId;
   renderPresenter();
 }catch{}
},1000);
presentationUploadForm.addEventListener('submit',async e=>{
 e.preventDefault();const f=presentationFile.files[0];if(!f)return;
 const fd=new FormData();fd.append('presentation',f);fd.append('folderId',PRES.currentFolder);
 presentationUploadState.textContent='Uploading and rendering slides…';
 try{
  const r=await fetch('/api/v1/presentations/upload',{method:'POST',body:fd});const j=await r.json();
  if(!r.ok)throw Error(j.error||'Upload failed');
  presentationUploadState.textContent=`Ready • ${j.presentation.slideCount} slides`;
  presentationFile.value='';PRES.selectedId=j.presentation.id;await loadPresentations();
 }catch(err){presentationUploadState.textContent=err.message}
});

function fmtBytes(n){n=Number(n||0);if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(1)+' GB'}
async function loadMedia(){
 try{
  const j=await api('/api/v1/media');
  S.mediaFiles=j.files||[];
  mediaRows.innerHTML=(j.files||[]).map(f=>{
   const conv=f.conversionStatus?`${esc(f.conversionStatus)}${f.conversionError?`<br><span class="bad">${esc(f.conversionError)}</span>`:''}`:'—';
   const showable=['image','video','pdf','presentation','document'].includes(f.type);
   return `<tr><td style="text-align:left"><b>${esc(f.originalName||f.storedName)}</b><br><span class="muted">${esc(f.storedName)}</span></td>
   <td><span class="pill">${esc(f.type)}</span></td><td>${fmtBytes(f.size)}</td><td>${conv}</td><td>${new Date(f.modifiedAt).toLocaleString()}</td>
   <td><div class="toolbar">
     ${showable?`<button class="primary" onclick="showMedia('${encodeURIComponent(f.storedName)}')">Show</button>`:''}
     ${(f.type==='presentation'||f.type==='document')&&f.conversionStatus!=='ready'?`<button onclick="convertMedia('${encodeURIComponent(f.storedName)}')">Convert</button>`:''}
     <a class="buttonLink" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">Open</a>
     <button class="danger" onclick="deleteMedia(${inlineJsArg(encodeURIComponent(f.storedName))},${inlineJsArg(f.originalName||f.storedName)})">Delete</button>
   </div></td></tr>`;
  }).join('')||'<tr><td colspan="6">No uploaded files.</td></tr>';
 }catch(e){mediaRows.innerHTML=`<tr><td colspan="6" class="bad">${esc(e.message)}</td></tr>`}
}
async function loadLabAgentCredentials(){try{const j=await api('/api/v1/admin/lab-agent-credentials');labLegacySharedToken.checked=j.policy?.legacySharedTokenAllowed!==false;const active=(j.credentials||[]).filter(x=>!x.revokedAt);labAgentCredentials.innerHTML=`<table><thead><tr><th>Computer</th><th>Label</th><th>Created</th><th>Last Used</th><th></th></tr></thead><tbody>${active.map(x=>`<tr><td><code>${esc(x.agentId)}</code></td><td>${esc(x.label||'Windows classroom agent')}</td><td>${esc(new Date(x.createdAt).toLocaleString())}</td><td>${x.lastUsedAt?esc(new Date(x.lastUsedAt).toLocaleString()):'Never'}</td><td><button class="danger" onclick="revokeLabAgentCredential(${inlineJsArg(x.id)})">Revoke</button></td></tr>`).join('')||'<tr><td colspan="5" class="muted">No individually enrolled Windows agents.</td></tr>'}</tbody></table>`}catch(e){labAgentCredentials.innerHTML=`<div class="muted">Agent enrollment requires an administrator: ${esc(e.message)}</div>`}}
async function createLabAgentEnrollment(){try{const id=labEnrollmentId.value.trim();if(!id)throw Error('Enter a stable computer ID.');const j=await api(`/api/v1/admin/lab-agents/${encodeURIComponent(id)}/enrollment`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ttlMinutes:Number(labEnrollmentTtl.value||15)})}),e=j.enrollment;labEnrollmentResult.style.display='block';labEnrollmentResult.innerHTML=`<b>Run once in elevated PowerShell on ${esc(e.agentId)}</b><textarea class="raw" readonly style="width:100%;min-height:120px;margin-top:8px">${esc(e.installCommand)}</textarea><div class="muted">Expires ${esc(new Date(e.expiresAt).toLocaleString())}. The raw enrollment token is shown only in this command.</div>`;await loadLabAgentCredentials()}catch(e){notify(e.message,'error')}}
async function revokeLabAgentCredential(id){if(!confirm('Revoke this computer credential and disconnect its agent?'))return;try{await api(`/api/v1/admin/lab-agent-credentials/${encodeURIComponent(id)}`,{method:'DELETE'});await loadLabAgentCredentials()}catch(e){notify(e.message,'error')}}
async function saveLabAgentPolicy(){try{await api('/api/v1/admin/lab-agent-credentials/policy',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({legacySharedTokenAllowed:labLegacySharedToken.checked,enrollmentTtlMinutes:Number(labEnrollmentTtl.value||15)})});notify('Lab agent security policy saved.','success');await loadLabAgentCredentials()}catch(e){notify(e.message,'error')}}
async function showMedia(enc){
 const seconds=Math.max(0,Number(mediaSeconds.value)||0);
 const body={target:mediaTarget.value,autoAdvanceMs:seconds*1000,loop:mediaLoop.checked};
 try{await jpost('/api/v1/media/'+enc+'/display',body)}catch(e){alert('Unable to display: '+e.message)}
}
async function convertMedia(enc){try{uploadState.textContent='Converting…';await jpost('/api/v1/media/'+enc+'/convert',{});uploadState.textContent='Conversion complete';loadMedia()}catch(e){uploadState.textContent=e.message}}
async function deleteMedia(enc,label){if(!confirm(`Delete "${label}" from RoomGoblin? This also removes its generated display PDF.`))return;try{await api('/api/v1/media/'+enc,{method:'DELETE'});loadMedia()}catch(e){alert(e.message)}}
mediaUploadForm.addEventListener('submit',async e=>{
 e.preventDefault();const f=mediaFile.files[0];if(!f)return;
 const fd=new FormData();fd.append('media',f);
 uploadState.textContent='Uploading / converting…';
 try{
  const r=await fetch('/api/v1/media',{method:'POST',body:fd});const j=await r.json();
  if(!r.ok)throw Error(j.error||'Upload failed');
  uploadState.textContent=j.file?.conversionStatus==='failed'?'Uploaded; conversion failed':'Ready';
  mediaFile.value='';loadMedia();
 }catch(err){uploadState.textContent=err.message}
});

async function plutoAction(p,refresh=true){
 try{
  const j=await jpost('/api/v1/pluto',p);
  const ack=j?.data?.result===1?'confirmed':(j.pendingVerify?'sent; verification pending':'acknowledged');
  avMsg.textContent=`${friendlyAvAction(p)} — ${ack}`;
  if(refresh)setTimeout(refreshPluto,180);
  return j;
 }catch(e){avMsg.textContent=e.message;throw e}
}
function friendlyAvAction(p){
 if(p.action==='route')return `${avOutputLabel(p.output)} → ${avInputLabel(p.input)}`;
 if(p.action==='cecOutput')return `${avOutputLabel(p.output)} power ${Number(p.index)===0?'on':'off'}`;
 if(p.action==='cecInput')return `${avInputLabel(p.input)} power ${Number(p.index)===1?'on':'off'}`;
 return String(p.action||'Matrix command');
}
function defaultAvLabels(){return {outputs:Array.from({length:8},(_,i)=>`TV ${i+1}`),inputs:Array.from({length:8},(_,i)=>`Content Source ${i+1}`),sourceEndpoints:Array.from({length:8},(_,i)=>`source${i+1}`)}}
function avLabels(){const d=defaultAvLabels(),x=S.pluto?.labels||{};return {outputs:Array.from({length:8},(_,i)=>String(x.outputs?.[i]||d.outputs[i])),inputs:Array.from({length:8},(_,i)=>String(x.inputs?.[i]||d.inputs[i])),sourceEndpoints:Array.from({length:8},(_,i)=>String(x.sourceEndpoints?.[i]||d.sourceEndpoints[i]))}}
function avOutputLabel(n){return avLabels().outputs[Number(n)-1]||`TV ${n}`}
function avInputLabel(n){return avLabels().inputs[Number(n)-1]||`Content Source ${n}`}
async function refreshPluto(){
 try{
  const [j,cfg,dev]=await Promise.all([api('/api/v1/pluto/status'),api('/api/v1/config'),api('/api/v1/devices').catch(()=>({status:{}}))]);S.pluto=j;S.avConfig=cfg||{};S.avDeviceStatus=dev.status||{};
  syncAvOutputLabelsFromDisplays();renderDisplayAvConfiguration();renderMatrix();renderOutputs();renderInputs();renderTV();
  avHealth.textContent=j.ok?'Matrix Online':'Matrix Partial';avHealth.className='pill '+(j.ok?'ok':'bad');avMsg.textContent=j.ok?'Ready':'Some matrix status queries failed';
 }catch(e){avHealth.textContent='Matrix Offline';avHealth.className='pill bad';avMsg.textContent=e.message}
}
let avLivePollBusy=false;setInterval(async()=>{if(avLivePollBusy||!document.getElementById('av')?.classList.contains('active'))return;avLivePollBusy=true;try{await refreshPluto();}catch{}finally{avLivePollBusy=false}},5000);
function avTvDisplayId(output){const hit=displayByAvOutput(output);return hit?.[0]||`tv${output}`}
function avTvOnline(output){return !!S.avDeviceStatus?.[avTvDisplayId(output)]?.online}
function avReportedPowerState(output){
 const o=Number(output),sources=[S.pluto?.cecStatus||{},S.pluto?.outputStatus||{}];
 for(const src of sources){for(const key of ['hdbtPower','hdbt_power','hdbtPowerState','hdbt_power_state','allhdbtpower','allhdbtpowerstate']){const a=src?.[key];if(Array.isArray(a)&&a.length>=o){const v=a[o-1];if(v===true||Number(v)===1)return {known:true,on:true,source:key};if(v===false||Number(v)===0)return {known:true,on:false,source:key}}}}
 return {known:false,on:null,source:null};
}
function storedAvPowerStates(){try{const value=JSON.parse(localStorage.getItem('classroomHub.avPowerStates')||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}}
function avPowerStateInfo(output){const live=avReportedPowerState(output);if(live.known)return {...live,verified:true,label:live.on?'On':'Off'};const m=storedAvPowerStates(),v=m[output];if(v&&typeof v==='object'&&(v.on===true||v.on===false))return {known:true,on:v.on,verified:false,label:v.on?'On':'Off',at:v.at||null};if(v===true||v===false)return {known:true,on:v,verified:false,label:v?'On':'Off'};return {known:false,on:null,verified:false,label:'Unknown'}}
function avPowerState(output){return avPowerStateInfo(output).on===true}
function saveAvPowerState(output,on){const m=storedAvPowerStates();m[output]={on:!!on,at:new Date().toISOString()};try{localStorage.setItem('classroomHub.avPowerStates',JSON.stringify(m))}catch{}}
function renderMatrix(){const v=S.pluto.videoStatus||{},routes=v.allsource||[],L=avLabels();matrix.innerHTML='<div class="mh">TV / SOURCE →</div>'+L.inputs.map((n,i)=>`<div class="mh"><button class="av40SourceHead" onclick="openAvSourceDrawer(${i+1})">${esc(n)}</button><small>Input ${i+1}</small></div>`).join('');for(let o=1;o<=8;o++){const online=avTvOnline(o),ps=avPowerStateInfo(o),cls=ps.known?(ps.on?'on':'off'):'unknown',title=ps.verified?`Live reported power: ${ps.label}. Click to toggle.`:ps.known?`Last RoomGoblin command: ${ps.label}. Hardware does not currently report live TV power. Click to toggle.`:'TV power state is not reported by the matrix. Click to send Power On.';matrix.innerHTML+=`<div class="mh av40TvCell"><button class="av40TvName" onclick="openAvTvDrawer(${o})"><b>${esc(L.outputs[o-1])}</b><small>HDBT ${o} • ${online?'Receiver online':'Receiver offline'}</small></button><button class="av40PowerMini ${cls} ${ps.verified?'reported':''}" title="${esc(title)}" onclick="event.stopPropagation();toggleRowTvPower(${o})">⏻</button></div>`;for(let i=1;i<=8;i++)matrix.innerHTML+=`<button class="route ${Number(routes[o-1])===i?'active':''}" onclick="route(${o},${i})">${Number(routes[o-1])===i?'●':'○'} ${esc(L.inputs[i-1])}</button>`}routeAll.innerHTML='<b>Route all TVs:</b>'+L.inputs.map((n,i)=>`<button onclick="routeAllTo(${i+1})">All → ${esc(n)}</button>`).join('');renderAv40Summary()}
async function toggleRowTvPower(output){const ps=avPowerStateInfo(output),turnOn=ps.known?!ps.on:true;try{await plutoAction({action:'cecOutput',output:Number(output),connection:'hdbt',index:turnOn?0:1},false);saveAvPowerState(output,turnOn);renderMatrix();avMsg.textContent=`${avOutputLabel(output)} power ${turnOn?'on':'off'} sent`;}catch(e){notify(e.message,'error')}}
function renderAv40Summary(){const routes=S.pluto.videoStatus?.allsource||[],L=avLabels(),counts={};routes.forEach(x=>counts[x]=(counts[x]||0)+1);const best=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];av40MatrixSummary.textContent=S.pluto?.ok?'Operational':'Needs Attention';av40MatrixSummary.className='kpi '+(S.pluto?.ok?'ok':'bad');av40Firmware.textContent=`Firmware ${S.pluto.systemStatus?.main||'—'}`;av40RouteSummary.textContent=best?`${best[1]} TV(s) → ${L.inputs[Number(best[0])-1]||'Unknown'}`:'No routes reported'}
async function route(o,i){await plutoAction({action:'route',output:o,input:i},false);for(let n=0;n<4;n++){await new Promise(r=>setTimeout(r,120*(n+1)));const v=(await jpost('/api/v1/pluto',{action:'videoStatus'})).data;if(Number(v.allsource?.[o-1])===i){S.pluto.videoStatus=v;renderMatrix();avMsg.textContent=`Verified: ${avOutputLabel(o)} → ${avInputLabel(i)}`;if(S.avDrawerOutput===o)renderAvDrawer();return}}avMsg.textContent=`Route sent but not verified: ${avOutputLabel(o)} → ${avInputLabel(i)}`}
async function routeAllTo(i){if(!confirm(`Route all TVs to ${avInputLabel(i)}?`))return;for(let o=1;o<=8;o++)await route(o,i);refreshPluto()}
async function powerAllAvTvs(index){if(!confirm(`Power all TVs ${index===0?'on':'off'}?`))return;for(let o=1;o<=8;o++){await plutoAction({action:'cecOutput',output:o,connection:'hdbt',index},false);saveAvPowerState(o,index===0)}renderMatrix();setTimeout(refreshPluto,300)}
function toggleAvAdvanced(){avAdvanced.open=!avAdvanced.open;if(avAdvanced.open)avAdvanced.scrollIntoView({behavior:'smooth',block:'start'})}
function openAvTvDrawer(output){S.avDrawerOutput=Number(output);renderAvDrawer();avTvDrawer.classList.add('open');avTvDrawerBackdrop.classList.add('open')}
function closeAvTvDrawer(){avTvDrawer.classList.remove('open');if(!avSourceDrawer.classList.contains('open'))avTvDrawerBackdrop.classList.remove('open')}
function openAvSourceDrawer(input){S.avDrawerInput=Number(input);renderAvSourceDrawer();avSourceDrawer.classList.add('open');avTvDrawerBackdrop.classList.add('open')}
function closeAvSourceDrawer(){avSourceDrawer.classList.remove('open');if(!avTvDrawer.classList.contains('open'))avTvDrawerBackdrop.classList.remove('open')}
function renderAvSourceDrawer(){const i=Number(S.avDrawerInput||1),L=avLabels(),x=S.pluto.inputStatus||{},inactive=Number(x.inactive?.[i-1]),edid=x.edid?.[i-1];avSourceDrawerTitle.textContent=L.inputs[i-1];avSourceDrawerSubtitle.textContent=`Matrix Input ${i}`;avSourceDrawerName.value=L.inputs[i-1];avSourceDrawerEndpoint.value=L.sourceEndpoints[i-1]||`source${i}`;avSourceDrawerEdid.value=edid??15;avSourceDrawerInfo.innerHTML=`Signal: <b>${inactive===0?'Detected':inactive===1?'No signal':'Unknown'}</b><br>EDID profile: ${esc(edid??'Unknown')}<br>Endpoint: ${esc(L.sourceEndpoints[i-1]||`source${i}`)}`}
async function sourceDrawerPower(index){const i=Number(S.avDrawerInput||1);await plutoAction({action:'cecInput',input:i,index},false);notify(`${avInputLabel(i)} power ${index===1?'on':'off'} command sent.`,'success')}
async function saveSourceDrawerEdid(){const i=Number(S.avDrawerInput||1),profile=Number(avSourceDrawerEdid.value);if(!Number.isFinite(profile)||profile<0||profile>255)return notify('EDID profile must be 0-255.','error');if(!confirm(`Change ${avInputLabel(i)} EDID profile to ${profile}? Only change EDID when troubleshooting source compatibility.`))return;await plutoAction({action:'setEdid',input:i,profile});setTimeout(refreshPluto,250)}
async function saveSourceDrawer(){const i=Number(S.avDrawerInput),L=avLabels(),name=avSourceDrawerName.value.trim()||`Content Source ${i}`,endpoint=avSourceDrawerEndpoint.value.trim()||`source${i}`;L.inputs[i-1]=name;L.sourceEndpoints[i-1]=endpoint;const j=await api('/api/v1/pluto/labels',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(L)});S.pluto.labels=j.labels;renderMatrix();renderAvSourceDrawer();renderDisplayAvConfiguration();notify('Source saved.','success')}
function renderAvDrawer(){const o=Number(S.avDrawerOutput||1),L=avLabels(),input=Number(S.pluto.videoStatus?.allsource?.[o-1]||1),hit=displayByAvOutput(o),id=hit?.[0]||`tv${o}`,st=S.avDeviceStatus?.[id]||{},sig=Number(S.pluto.inputStatus?.inactive?.[input-1])===0,ps=avPowerStateInfo(o);avDrawerTitle.textContent=L.outputs[o-1];avDrawerTvName.value=L.outputs[o-1];avDrawerSubtitle.textContent=`HDBT ${o} • Receiver ${id}`;avDrawerCurrentSource.textContent=L.inputs[input-1]||`Content Source ${input}`;avDrawerSource.innerHTML=L.inputs.map((n,i)=>`<option value="${i+1}" ${i+1===input?'selected':''}>${esc(n)} (Input ${i+1})</option>`).join('');avDrawerPowerStatus.textContent=ps.verified?`Power: ${ps.label} • live matrix report`:(ps.known?`Power: ${ps.label} • last RoomGoblin command; not hardware-confirmed`:'Power: Unknown • this matrix firmware is not reporting live TV power');avDrawerInfo.innerHTML=`Receiver: <b>${st.online?'Online':'Offline'}</b><br>Current Source: ${esc(L.inputs[input-1]||'—')}<br>Source Signal: ${sig?'Detected':'Not detected'}<br>Resolution: ${esc(st.meta?.resolution||'Unknown')}<br>Last Seen: ${esc(overviewLastSeen(st))}`;renderDrawerTvGroups(id)}
async function drawerTvPower(index){const o=Number(S.avDrawerOutput);await plutoAction({action:'cecOutput',output:o,connection:'hdbt',index},false);saveAvPowerState(o,index===0);renderMatrix();renderAvDrawer();notify(`${avOutputLabel(o)} power ${index===0?'on':'off'} sent.`,'success')}
async function saveDrawerTvName(){const o=Number(S.avDrawerOutput),name=avDrawerTvName.value.trim()||`TV ${o}`,hit=displayByAvOutput(o);if(!hit)throw new Error(`No receiver is mapped to HDBT ${o}`);const [id]=hit,devices={...(S.avConfig.devices||{})};devices[id]={...devices[id],name};await api('/api/v1/admin/displays',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:S.avConfig?.room,devices,displayGroups:S.avConfig?.displayGroups||{},lightingGroups:S.avConfig?.lightingGroups||[]})});const L=avLabels();L.outputs[o-1]=name;const j=await api('/api/v1/pluto/labels',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(L)});S.pluto.labels=j.labels;S.avConfig.devices=devices;renderMatrix();renderAvDrawer();renderDisplayAvConfiguration();notify('TV name saved.','success')}
function renderDrawerTvGroups(id){const groups=S.avConfig?.displayGroups||{};avDrawerGroups.innerHTML=Object.entries(groups).filter(([n])=>n!=='all').map(([name,members])=>`<label><input type="checkbox" data-drawer-tv-group="${esc(name)}" ${(members||[]).includes(id)?'checked':''}>${esc(name)}</label>`).join('')||'<span class="muted">No optional groups configured.</span>'}
async function saveDrawerTvGroups(){const o=Number(S.avDrawerOutput),id=avTvDisplayId(o),groups={...(S.avConfig?.displayGroups||{})};document.querySelectorAll('[data-drawer-tv-group]').forEach(cb=>{const n=cb.dataset.drawerTvGroup,m=new Set(groups[n]||[]);cb.checked?m.add(id):m.delete(id);groups[n]=[...m]});if(groups.all&&!groups.all.includes(id))groups.all=[...groups.all,id];await api('/api/v1/admin/displays',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:S.avConfig?.room,devices:S.avConfig?.devices||{},displayGroups:groups,lightingGroups:S.avConfig?.lightingGroups||[]})});S.avConfig.displayGroups=groups;notify('TV groups saved.','success')}
function drawerUpdateRoute(){return route(Number(S.avDrawerOutput),Number(avDrawerSource.value))}
async function sendTvTestImage(id,output){return api('/api/v1/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'display.image',target:id,payload:{url:`/test-images/tv${output}.svg`,fit:'contain'}})})}
async function drawerTestImage(){const o=Number(S.avDrawerOutput),id=avTvDisplayId(o);if(!S.avDeviceStatus?.[id]?.online){const e=`${avOutputLabel(o)} receiver ${id} is offline`;avDrawerToolStatus.textContent=e;return notify(e,'error')}await sendTvTestImage(id,o);avDrawerToolStatus.textContent=`Test image sent to ${id}`;notify(`Test image sent to ${avOutputLabel(o)}.`,'success')}
async function drawerDisplayCommand(type,label){const o=Number(S.avDrawerOutput),id=avTvDisplayId(o),st=S.avDeviceStatus?.[id];if(!st?.online)throw new Error(`${avOutputLabel(o)} receiver ${id} is offline`);avDrawerToolStatus.textContent=`Sending ${label} to ${id}…`;const j=await api('/api/v1/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,target:id,payload:{requestedAt:new Date().toISOString()}})});avDrawerToolStatus.textContent=`${label} sent to ${id}`;notify(`${label} sent to ${avOutputLabel(o)}.`,'success');return j}
async function drawerClearDisplay(){try{return await drawerDisplayCommand('display.clear','Clear Display')}catch(e){avDrawerToolStatus.textContent=e.message;notify(e.message,'error')}}
async function drawerReloadDisplay(){try{return await drawerDisplayCommand('display.reload','Reload Display')}catch(e){avDrawerToolStatus.textContent=e.message;notify(e.message,'error')}}
function renderAvTargets(){
 const L=avLabels();
 avTvTargets.innerHTML=L.outputs.map((n,i)=>`<label class="avTarget"><input type="checkbox" class="avTvTarget" value="${i+1}"><b>${esc(n)}</b><span class="muted">HDBT ${i+1}</span></label>`).join('');
 avBulkSource.innerHTML=L.inputs.map((n,i)=>`<option value="${i+1}">${esc(n)} (Input ${i+1})</option>`).join('');
}
function selectedAvTvs(){return [...document.querySelectorAll('.avTvTarget:checked')].map(x=>Number(x.value))}
function setAllAvTvTargets(state){document.querySelectorAll('.avTvTarget').forEach(x=>x.checked=state)}
async function routeSelectedTvs(){const outs=selectedAvTvs(),input=Number(avBulkSource.value);if(!outs.length)return alert('Select at least one TV.');for(const o of outs)await route(o,input);refreshPluto()}
async function powerSelectedTvs(index){const outs=selectedAvTvs();if(!outs.length)return alert('Select at least one TV.');for(const o of outs)await plutoAction({action:'cecOutput',output:o,connection:'hdbt',index},false);avMsg.textContent=`Power ${index===0?'On':'Off'} sent to ${outs.map(avOutputLabel).join(', ')}`;setTimeout(refreshPluto,250)}
function renderSourceSelector(){
 const L=avLabels(),old=Number(avSourceDevice.value)||1;
 avSourceDevice.innerHTML=L.inputs.map((n,i)=>`<option value="${i+1}">${esc(n)} (Input ${i+1})</option>`).join('');avSourceDevice.value=String(Math.min(8,Math.max(1,old)));updateSourceSignal();
 avSourceDevice.onchange=updateSourceSignal;
}
function updateSourceSignal(){const i=Number(avSourceDevice.value)||1,x=S.pluto.inputStatus||{},inactive=Number(x.inactive?.[i-1]);avSourceSignal.textContent=inactive===0?'Signal detected':inactive===1?'No signal':'Unknown';avSourceSignal.className='pill '+(inactive===0?'ok':'')}
function sourcePower(index){return plutoAction({action:'cecInput',input:Number(avSourceDevice.value),index})}
function selScaler(type,o,val){return `<select onchange="plutoAction({action:'${type}Scaler',output:${o},mode:Number(this.value)})"><option value="0" ${val==0?'selected':''}>Bypass</option><option value="1" ${val==1?'selected':''}>4K→1080p</option><option value="3" ${val==3?'selected':''}>Auto</option></select>`}
function renderOutputs(){
 const x=S.pluto.outputStatus||{},r=x.allsource||S.pluto.videoStatus?.allsource||[],L=avLabels();outputRows.innerHTML='';
 for(let o=1;o<=8;o++)outputRows.innerHTML+=`<tr><td><b>${esc(L.outputs[o-1])}</b><br><span class="muted">HDBT ${o}</span></td><td>${esc(avInputLabel(r[o-1]??0))}</td>
 <td><button onclick="plutoAction({action:'hdbtStream',output:${o},state:${!Number(x.allhdbtout?.[o-1])}})">${Number(x.allhdbtout?.[o-1])?'ON':'OFF'}</button></td>
 <td>${selScaler('hdbt',o,x.allhdbtscaler?.[o-1]??0)}</td>
 <td><button onclick="plutoAction({action:'txHdcp',output:${o},state:${!Number(x.allhdcp?.[o-1])}})">${Number(x.allhdcp?.[o-1])?'ON':'OFF'}</button></td></tr>`;
}
function renderInputs(){
 const x=S.pluto.inputStatus||{},L=avLabels();inputRows.innerHTML='';
 for(let i=1;i<=8;i++){
  const inactive=Number(x.inactive?.[i-1]),signal=inactive===0?'Detected':inactive===1?'None':'?';
  inputRows.innerHTML+=`<tr><td><b>${esc(L.inputs[i-1])}</b><br><span class="muted">Input ${i}</span></td><td><span class="pill ${inactive===0?'ok':''}">${signal}</span></td><td>${x.edid?.[i-1]??'?'}</td><td><input id="edid${i}" type="number" min="0" max="255" value="${x.edid?.[i-1]??15}" style="width:70px"><button onclick="plutoAction({action:'setEdid',input:${i},profile:Number(edid${i}.value)})">Set</button></td><td><button class="on" onclick="plutoAction({action:'cecInput',input:${i},index:1})">On</button><button class="danger" onclick="plutoAction({action:'cecInput',input:${i},index:2})">Off</button></td></tr>`;
 }
}
function displayByAvOutput(output){
 const ds=S.avConfig?.devices||{};
 return Object.entries(ds).find(([,d])=>Number(d?.avOutput)===Number(output))||null;
}
function syncAvOutputLabelsFromDisplays(){
 const L=avLabels();
 const outputs=L.outputs.map((fallback,i)=>{const hit=displayByAvOutput(i+1);return hit?String(hit[1]?.name||hit[0]):fallback;});
 S.pluto.labels={...L,outputs};
}
function renderDisplayAvConfiguration(){
 const cfg=S.avConfig||{},ds=cfg.devices||{},groups=cfg.displayGroups||{},L=avLabels();
 avTvConfig.innerHTML=Array.from({length:8},(_,idx)=>{
   const out=idx+1,hit=displayByAvOutput(out),id=hit?.[0]||`tv${out}`,d=hit?.[1]||{};
   return `<div class="card" data-av-tv-output="${out}" style="box-shadow:none;margin:7px 0"><div class="row"><b>HDBT ${out}</b><span class="pill">TV</span></div><label>Friendly name<input data-av-tv-name value="${esc(d.name||`TV ${out}`)}"></label><div class="grid2" style="margin-top:7px"><label>Receiver ID<input data-av-tv-id value="${esc(id)}" ${hit?'readonly':''}></label><label>Lighting mapping<input data-av-tv-light value="${esc(d.lightingAlias||'')}" placeholder="optional"></label></div><label style="display:flex;gap:7px;align-items:center;margin-top:7px"><input type="checkbox" data-av-tv-enabled ${d.enabled!==false?'checked':''}> Enabled</label></div>`;
 }).join('');
 avSourceConfig.innerHTML=Array.from({length:8},(_,idx)=>`<div class="card" data-av-source-input="${idx+1}" style="box-shadow:none;margin:7px 0"><div class="row"><b>Input ${idx+1}</b><span class="pill">SOURCE</span></div><label>Friendly name<input data-av-source-name value="${esc(L.inputs[idx])}"></label><label style="margin-top:7px">Browser / kiosk endpoint ID<input data-av-source-endpoint value="${esc(L.sourceEndpoints[idx])}" placeholder="source${idx+1}"></label></div>`).join('');
 avGroupEditor.innerHTML=Object.entries(groups).map(([name,members])=>avGroupCard(name,members,ds)).join('')||'<div class="muted">No TV groups configured.</div>';
}
function avGroupCard(name,members,devices){return `<div class="groupCard" data-av-group="${esc(name)}"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(name)}</b>${name==='all'?'<span class="pill">Core</span>':`<button class="danger" onclick="removeAvDisplayGroup(${inlineJsArg(name)})">Remove</button>`}</div><div class="checkGrid">${Object.keys(devices).map(id=>`<label class="checkItem"><input type="checkbox" value="${esc(id)}" ${(members||[]).includes(id)?'checked':''}>${esc(devices[id]?.name||id)}</label>`).join('')}</div></div>`}
function addAvDisplayGroup(){const n=avNewGroup.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-');if(!n)return;S.avConfig.displayGroups=S.avConfig.displayGroups||{};if(S.avConfig.displayGroups[n])return alert('That group already exists.');S.avConfig.displayGroups[n]=[];avNewGroup.value='';renderDisplayAvConfiguration()}
function removeAvDisplayGroup(name){if(!confirm(`Remove TV group ${name}?`))return;delete S.avConfig.displayGroups[name];renderDisplayAvConfiguration()}
async function saveDisplayAvConfiguration(){
 try{
   const old=S.avConfig?.devices||{},devices={...old};
   document.querySelectorAll('[data-av-tv-output]').forEach(card=>{const output=Number(card.dataset.avTvOutput),id=card.querySelector('[data-av-tv-id]').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-')||`tv${output}`,base={...(old[id]||{})};base.name=card.querySelector('[data-av-tv-name]').value.trim()||`TV ${output}`;base.enabled=card.querySelector('[data-av-tv-enabled]').checked;base.avOutput=output;base.lightingAlias=card.querySelector('[data-av-tv-light]').value.trim()||null;base.tags=Array.from(new Set([...(base.tags||[]),'classroom']));devices[id]=base});
   const displayGroups={};avGroupEditor.querySelectorAll('[data-av-group]').forEach(card=>displayGroups[card.dataset.avGroup]=[...card.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value));
   if(!displayGroups.all)displayGroups.all=Object.keys(devices).filter(id=>devices[id].enabled!==false);
   const inputs=[],sourceEndpoints=[];document.querySelectorAll('[data-av-source-input]').forEach(card=>{inputs.push(card.querySelector('[data-av-source-name]').value.trim()||`Content Source ${card.dataset.avSourceInput}`);sourceEndpoints.push(card.querySelector('[data-av-source-endpoint]').value.trim()||`source${card.dataset.avSourceInput}`)});
   const outputs=Array.from({length:8},(_,i)=>displayByAvOutput(i+1)?.[1]?.name||document.querySelector(`[data-av-tv-output="${i+1}"] [data-av-tv-name]`)?.value.trim()||`TV ${i+1}`);
   await api('/api/v1/admin/displays',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:S.avConfig?.room,devices,displayGroups,lightingGroups:S.avConfig?.lightingGroups||[]})});
   const lab=await api('/api/v1/pluto/labels',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({outputs,inputs,sourceEndpoints})});S.pluto.labels=lab.labels;avConfigMsg.textContent='TV, source and group mapping saved.';await refreshPluto();
 }catch(e){avConfigMsg.textContent=e.message}
}
function renderAvRawStatus(){avRawStatus.style.display='block';avRawStatus.textContent=JSON.stringify({video:S.pluto.videoStatus,outputs:S.pluto.outputStatus,inputs:S.pluto.inputStatus,cec:S.pluto.cecStatus,system:S.pluto.systemStatus,network:S.pluto.networkStatus},null,2)}
function renderTV(){const s=S.pluto.systemStatus||{},n=S.pluto.networkStatus||{};systemInfo.innerHTML=`Power: <b>${esc(s.power)}</b><br>Firmware: ${esc(s.main)}<br>Sub1: ${esc(s.sub1)}<br>Sub2: ${esc(s.sub2)}<br>CPLD: ${esc(s.cpld)}<br>Panel Lock: ${esc(s.lock)}<br>Beep: ${esc(s.beep)}`;networkInfo.innerHTML=`Model: <b>${esc(n.model)}</b><br>Hostname: ${esc(n.hostname)}<br>IP: ${esc(n.ipaddress)}<br>Subnet: ${esc(n.subnet)}<br>Gateway: ${esc(n.gateway)}<br>MAC: ${esc(n.macaddress)}<br>TCP: ${esc(n.tcpport)} • Telnet: ${esc(n.telnetport)}`}
function toggleSystem(action){const s=S.pluto.systemStatus||{},state=action==='panelLock'?!Number(s.lock):!Number(s.beep);plutoAction({action,state})}

async function loadGovee(){try{S.govee=await api('/api/v1/govee');renderGovee()}catch(e){lightDevices.innerHTML=`<div class="card bad">${esc(e.message)}</div>`}}
async function goveeCmd(target,action,body={}){const j=await jpost(`/api/v1/govee/${encodeURIComponent(target)}/${action}`,body);setTimeout(loadGovee,200);return j}
async function setGoveeAutoAdd(enabled){
  try{
    const j=await api('/api/v1/govee/discovery',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({autoAdd:enabled})});
    if(S.govee)S.govee.discovery=j.discovery;renderGoveeDiscovery();
  }catch(e){alert(e.message);loadGovee()}
}
async function reconcileGoveeNow(){
  try{
    const j=await api('/api/v1/govee/discovery/reconcile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:true})});
    S.govee=j.inventory;renderGovee();
    const total=(j.migrated||0)+(j.removed||0);
    alert(`Govee cleanup complete. Immediately removed ${total} stale/synthetic entr${total===1?'y':'ies'}.`);
  }catch(e){alert(e.message)}
}
async function saveGoveeDevice(alias){
  try{
    const name=document.getElementById(`edit_${alias}_name`).value.trim();
    const groups=document.getElementById(`edit_${alias}_groups`).value.split(/[,\s]+/).map(x=>x.trim()).filter(Boolean);
    await api('/api/v1/govee/device/'+encodeURIComponent(alias),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,groups})});
    await loadGovee();
  }catch(e){alert(e.message)}
}
function colorToHex(c){if(!c)return'#377dff';const h=n=>Number(n||0).toString(16).padStart(2,'0');return '#'+h(c.r)+h(c.g)+h(c.b)}
function lightCard(target,name,state,isGroup=false,device=null,presence=null,meta=null){
 const id='l_'+target.replace(/[^a-z0-9]/g,'_'),b=state?.brightness??50,col=colorToHex(state?.color);
 const online=presence?.online;
 const seen=presence?.lastSeen?new Date(presence.lastSeen).toLocaleString():'not yet';
 const status=online===true?'ONLINE':online===false?'OFFLINE':'UNKNOWN';
 const badge=isGroup?'':` • ${status}${meta?.discovered?' • AUTO-DISCOVERED':''}`;
 const groups=(meta?.groups||[]).join(', ');
 return `<div class="card lightCard"><h3>${esc(name)}</h3><div class="muted">${esc(target)}${state?` • ${esc(state.state||'')}`:''}${badge}</div>
 ${isGroup?'':`<div class="muted">ID: ${esc(device?.id||'')} ${device?.sku?`• ${esc(device.sku)}`:''}<br>Last seen: ${esc(seen)}</div>`}
 <div class="toolbar"><button class="on" onclick="goveeCmd('${target}','on')">On</button><button class="off" onclick="goveeCmd('${target}','off')">Off</button></div>
 <div class="row"><span>Brightness</span><input id="${id}_b" type="range" min="1" max="100" value="${b}"><button onclick="goveeCmd('${target}','brightness',{level:Number(${id}_b.value)})">Apply</button></div>
 <div class="row"><span>Color</span><input id="${id}_c" type="color" value="${col}"><button onclick="goveeCmd('${target}','color',{color:${id}_c.value)})">Apply</button></div>
 <div class="row"><span>Temp</span><input id="${id}_t" type="range" min="2000" max="9000" step="100" value="6500"><button onclick="goveeCmd('${target}','temp',{kelvin:Number(${id}_t.value)})">Apply</button></div>
 <div class="row"><span>Scene</span><select id="${id}_s"><option>Loading…</option></select><button onclick="goveeCmd('${target}','scene',{scene:${id}_s.value})">Apply</button></div>
 ${isGroup?'':`<details style="margin-top:10px"><summary>Edit Device</summary>
   <label>Friendly Name<input id="edit_${target}_name" value="${esc(name)}" style="width:100%"></label>
   <label>Groups <span class="muted">(comma separated; All is automatic)</span><input id="edit_${target}_groups" value="${esc(groups)}" placeholder="tvs, hallway, strip" style="width:100%"></label>
   <button class="primary" onclick="saveGoveeDevice('${target}')">Save Device</button>
 </details>`}
 </div>`;
}
function renderGoveeDiscovery(){
  const d=S.govee?.discovery||{};
  if(typeof goveeAutoAdd!=='undefined')goveeAutoAdd.checked=d.autoAdd!==false;
  if(typeof goveeDiscoveryStatus!=='undefined'){
    const when=d.lastDiscoveryAt?new Date(d.lastDiscoveryAt).toLocaleString():'none yet';
    goveeDiscoveryStatus.textContent=`${d.totalCount||0} total physical devices • ${d.discoveredCount||0} auto-discovered • last discovery ${when} • stale auto-devices removed after ${Math.round((d.reconcileGraceSeconds||600)/60)} min`;
  }
}
function renderGovee(){
 const g=S.govee||{};renderGoveeDiscovery();
 lightGroups.innerHTML=Object.entries(g.groups||{}).map(([k,v])=>{
   const friendly=(v||[]).map(alias=>g.devices?.[alias]?.name||alias);
   return lightCard(k,k.toUpperCase()+' — '+friendly.join(', '),null,true);
 }).join('');
 lightDevices.innerHTML=Object.entries(g.devices||{}).map(([k,d])=>lightCard(k,d.name,g.states?.[k],false,d,g.presence?.[k],g.meta?.[k])).join('');
 for(const k of Object.keys(g.devices||{}))loadScenes(k);
 for(const k of Object.keys(g.groups||{})){const first=g.groups[k]?.[0];if(first)loadScenes(first,'l_'+k.replace(/[^a-z0-9]/g,'_')+'_s')}
}
async function loadScenes(alias,selectId){try{const j=await api(`/api/v1/govee/${alias}/scenes`),sel=document.getElementById(selectId||('l_'+alias+'_s'));if(sel)sel.innerHTML=j.scenes.map(x=>`<option>${esc(x)}</option>`).join('')}catch{}}

const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function autoTargetValues(){
  const action=autoAction.value;
  if(action.startsWith('govee.')){
    const devices=Object.entries(S.govee?.devices||{}).map(([id,d])=>[id,d.name]);
    const groups=Object.keys(S.govee?.groups||{}).map(id=>[id,`${id.toUpperCase()} group`]);
    return [...groups,...devices];
  }
  if(action==='tv.power')return [
    ['all','All TVs'],['hdmi-all','All HDMI TVs'],['hdbt-all','All HDBT TVs'],
    ...configuredDisplayTargets(false)
  ];
  return configuredDisplayTargets(true);
}
function parseDateLines(v){
  return [...new Set(String(v||'').split(/[\n,;\s]+/).map(x=>x.trim()).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
}


function classDisplayTargets(){return configuredDisplayTargets(true)}

function classTargetLabel(id){
  return classDisplayTargets().find(x=>x[0]===id)?.[1]||id;
}
function selectedClassDefaultTargets(){
  const checked=[...document.querySelectorAll('[data-classtarget]:checked')].map(x=>x.dataset.classtarget);
  return checked.length?checked:['all'];
}
function classTargetChanged(changedId){
  const allBox=document.querySelector('[data-classtarget="all"]');
  if(changedId==='all'&&allBox?.checked){
    document.querySelectorAll('[data-classtarget]').forEach(x=>{
      if(x.dataset.classtarget!=='all')x.checked=false;
    });
  }else if(changedId!=='all'){
    const anyIndividual=[...document.querySelectorAll('[data-classtarget]:checked')]
      .some(x=>x.dataset.classtarget!=='all');
    if(anyIndividual&&allBox)allBox.checked=false;
  }

  const anyChecked=[...document.querySelectorAll('[data-classtarget]:checked')].length>0;
  if(!anyChecked&&allBox)allBox.checked=true;
}
function renderClassDefaultTargets(selected=['all']){
  if(!window.classDefaultTargets)return;
  let ids=Array.isArray(selected)&&selected.length?[...selected]:['all'];

  // "all" is intentionally exclusive so a class does not store redundant
  // values such as all + tv1 + tv2.
  if(ids.includes('all'))ids=['all'];

  classDefaultTargets.innerHTML=classDisplayTargets().map(([id,label])=>`
    <label style="display:inline-flex;gap:7px;align-items:center;margin:4px 12px 4px 0">
      <input type="checkbox" data-classtarget="${id}" ${ids.includes(id)?'checked':''}
             onchange="classTargetChanged('${id}')">
      ${esc(label)}
    </label>
  `).join('');

  if(!classDefaultTargets.querySelector('[data-classtarget]:checked')){
    const allBox=classDefaultTargets.querySelector('[data-classtarget="all"]');
    if(allBox)allBox.checked=true;
  }
}
function classTargetSummary(targets){
  const ids=Array.isArray(targets)&&targets.length?targets:['all'];
  return ids.includes('all')?'All Displays':ids.map(classTargetLabel).join(', ');
}

let currentClassEdit={days:[1,2,3,4,5],scheduleMode:'weekly',alternatePhase:'A',anchorDate:''};

function minutesFromTime(value){
  const [h,m]=String(value||'00:00').split(':').map(Number);
  return (Number.isFinite(h)?h:0)*60+(Number.isFinite(m)?m:0);
}
function classPhaseSortValue(cls){
  if(cls?.scheduleMode!=='alternating')return 2;
  return cls.alternatePhase==='B'?1:0;
}
function compareClassesByPhaseTime(a,b){
  return classPhaseSortValue(a)-classPhaseSortValue(b)
    || minutesFromTime(a.startTime)-minutesFromTime(b.startTime)
    || String(a.name||'').localeCompare(String(b.name||''));
}
function automationPrimarySortOccurrence(event){
  const occ=Array.isArray(event.resolvedOccurrences)&&event.resolvedOccurrences.length
    ? [...event.resolvedOccurrences].sort((a,b)=>minutesFromTime(a.time)-minutesFromTime(b.time))[0]
    : (event.resolved||event);
  return occ||event;
}
function automationPhaseSortValue(event){
  const occ=automationPrimarySortOccurrence(event);
  if(occ?.scheduleMode!=='alternating')return 2;
  return occ.alternatePhase==='B'?1:0;
}
function compareAutomationsByPhaseTime(a,b){
  const ao=automationPrimarySortOccurrence(a),bo=automationPrimarySortOccurrence(b);
  return automationPhaseSortValue(a)-automationPhaseSortValue(b)
    || minutesFromTime(ao.time||a.time)-minutesFromTime(bo.time||b.time)
    || String(a.name||'').localeCompare(String(b.name||''));
}
function phaseDisplayName(mode,phase){
  if(mode!=='alternating')return 'Weekly / Other';
  return `${scheduleGroup(phase==='B'?1:0).label} Days`;
}

function scheduleCycleDays(){return Array.isArray(S.scheduleProfile?.cycleDays)&&S.scheduleProfile.cycleDays.length?S.scheduleProfile.cycleDays:['A','B']}
function scheduleGroup(index){return S.scheduleProfile?.dayGroups?.[index]||{label:`Group ${index+1}`,cycleDays:index?scheduleCycleDays().filter((_,i)=>i%2):scheduleCycleDays().filter((_,i)=>!(i%2))}}

function periodPresetCycleDays(period){
  return S.scheduleProfile?.periodCycleDays?.[String(period||'')]||[];
}
function periodLabel(period){
  return period?`Period / Block ${period}`:'';
}
function cycleDayColor(days=[]){
  for(const group of S.scheduleProfile?.dayGroups||[])if(days.length&&days.every(x=>(group.cycleDays||[]).includes(x)))return group.label;
  return days.length?'Mixed':'Any';
}
function selectedClassCycleDays(){
  return [...document.querySelectorAll('[data-classcycle]:checked')].map(x=>x.dataset.classcycle);
}
function applyClassPeriodPreset(){
  if(classScheduleMode.value!=='schoolcycle')return;
  const preset=periodPresetCycleDays(classPeriod.value);
  document.querySelectorAll('[data-classcycle]').forEach(x=>x.checked=preset.includes(x.dataset.classcycle));
  const color=cycleDayColor(preset);
  const day=document.getElementById('classDayType');
  if(day)day.value=color==='Mixed'?'Any':color;
}
function classDaySummary(cls){
  if(cls.scheduleMode==='schoolcycle'){
    const cycle=cls.cycleDays?.length?cls.cycleDays:periodPresetCycleDays(cls.period);
    const color=cls.dayType&&cls.dayType!=='Any'?cls.dayType:cycleDayColor(cycle);
    return `${color} • Cycle ${cycle.join(', ')||'Any'}${cls.period?` • ${periodLabel(cls.period)}`:''}`;
  }
  if(cls.scheduleMode==='alternating')return `${scheduleGroup(cls.alternatePhase==='B'?1:0).label} Days`;
  const n=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return (cls.days||[]).map(d=>n[d]).join(', ');
}
function renderClassCurrentStatus(){
  const st=S.classStatus||{},cy=st.schoolCycle||{};
  const cycleText=cy.isStudentSchoolDay
    ? `${cy.dayColor} Day • Cycle ${cy.cycleDay}`
    : `No Student Cycle Today${cy.reason?' • '+cy.reason:''}`;
  if(st.activeClass){
    const mins=Math.max(0,Math.ceil((new Date(st.activeClass.endAt)-Date.now())/60000));
    classCurrentStatus.innerHTML=`<b>${esc(cycleText)}</b><br><b>Current:</b> ${esc(st.activeClass.name)} • ${st.activeClass.startTime}–${st.activeClass.endTime} • about ${mins} min left`;
  }else if(st.nextClass){
    classCurrentStatus.innerHTML=`<b>${esc(cycleText)}</b><br><b>Next:</b> ${esc(st.nextClass.name)} • ${new Date(st.nextClass.nextStartAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
  }else classCurrentStatus.innerHTML=`<b>${esc(cycleText)}</b><br>No active or upcoming class.`;
}
function renderClassScheduleList(){classScheduleList.innerHTML=S.classes.length?[...S.classes].sort(compareClassesByPhaseTime).map(x=>`<div class="card" style="margin-bottom:8px"><div class="top"><div><b>${esc(x.name)}</b><div class="muted">${esc(x.startTime)}–${esc(x.endTime)} • ${esc(classDaySummary(x))} • Displays: ${esc(classTargetSummary(x.defaultTargets))}</div></div><div class="toolbar"><button onclick="editClassSchedule(${inlineJsArg(x.id)})">Edit</button><button onclick="duplicateClassSchedule(${inlineJsArg(x.id)})">Duplicate</button><button class="danger" onclick="deleteClassSchedule(${inlineJsArg(x.id)})">Delete</button></div></div></div>`).join(''):'<div class="muted">No classes configured.</div>'}
function selectedAutomationClassIds(){return [...document.querySelectorAll('[data-autoclass]:checked')].map(x=>x.dataset.autoclass)}
function populateAutomationClassSelect(selected=[]){
  if(!window.autoClassIds)return;
  const selectedIds=Array.isArray(selected)?selected:[selected].filter(Boolean);
  autoClassIds.innerHTML=[...S.classes].sort(compareClassesByPhaseTime).map(cls=>`<label><input type="checkbox" data-autoclass="${esc(cls.id)}" ${selectedIds.includes(cls.id)?'checked':''} onchange="renderAutomationClassBinding()"> ${esc(cls.name)} <span class="muted">(${esc(classDaySummary(cls))} ${esc(cls.startTime)}–${esc(cls.endTime)})</span></label>`).join('')||'<span class="muted">No classes configured.</span>';
}
async function loadClassSchedules(){
  try{
    const x=await api('/api/v1/class-schedules');
    S.classes=x.classes||[];
    S.classStatus={schoolCycle:x.schoolCycle||null,activeClass:x.activeClass||null,nextClass:x.nextClass||null};
    if(window.classCurrentStatus){renderClassCurrentStatus();renderClassScheduleList()}
    populateAutomationClassSelect(typeof selectedAutomationClassIds==='function'?selectedAutomationClassIds():[]);
    populateTimerOverlayClassSelect(window.autoTimerOverlayClass?.value||'');
  }catch(e){
    if(window.classCurrentStatus)classCurrentStatus.innerHTML=`<div class="bad">Class schedule status error: ${esc(e.message)}</div>`;
    if(window.classScheduleList)classScheduleList.innerHTML=`<div class="bad">${esc(e.message)}</div>`;
  }
}
function renderClassScheduleMode(data=currentClassEdit){
  const mode=classScheduleMode.value;
  currentClassEdit={...data,scheduleMode:mode};

  if(mode==='schoolcycle'){
    const selected=currentClassEdit.cycleDays?.length?currentClassEdit.cycleDays:periodPresetCycleDays(classPeriod.value);
    const color=currentClassEdit.dayType||cycleDayColor(selected);
    const groups=S.scheduleProfile?.dayGroups||[];
    classScheduleModeFields.innerHTML=`<div class="grid2">
      <label>Day Group<select id="classDayType"><option value="Any" ${color==='Any'?'selected':''}>Any</option>${groups.map(g=>`<option value="${esc(g.label)}" ${color===g.label?'selected':''}>${esc(g.label)}</option>`).join('')}</select></label>
      <label>Anchor<input value="${esc(S.scheduleProfile?.anchorDate||'Set in School Calendar')} = Cycle ${esc(scheduleCycleDays()[0])}" disabled></label>
    </div>
    <b>Cycle Days</b>
    <div class="toolbar">${scheduleCycleDays().map(letter=>`<label><input type="checkbox" data-classcycle="${esc(letter)}" ${selected.includes(letter)?'checked':''}> ${esc(letter)}</label>`).join('')}</div>
    <div class="muted">${groups.map(g=>`${esc(g.label)}: ${(g.cycleDays||[]).map(esc).join(' ')}`).join(' • ')} • closed/no-student days do not advance the cycle.</div>`;
    return;
  }

  if(mode==='weekly'){
    const n=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    classScheduleModeFields.innerHTML=`<b>Meeting Days</b><div class="toolbar">${n.map((x,i)=>`<label><input type="checkbox" data-classday="${i}" ${(currentClassEdit.days||[]).includes(i)?'checked':''}> ${x}</label>`).join('')}</div>`;
    return;
  }

  classScheduleModeFields.innerHTML=`<div class="grid2">
    <label>Day Group<select id="classAlternatePhase"><option value="A" ${currentClassEdit.alternatePhase!=='B'?'selected':''}>${esc(scheduleGroup(0).label)} Days</option><option value="B" ${currentClassEdit.alternatePhase==='B'?'selected':''}>${esc(scheduleGroup(1).label)} Days</option></select></label>
    <label>Anchor<input value="${esc(S.scheduleProfile?.anchorDate||'Set in School Calendar')} = ${esc(scheduleGroup(0).label)}" disabled></label>
  </div>`;
}
function newClassSchedule(){
  classId.value='';className.value='';classShortName.value='';classPeriod.value='';
  classContinuationOf.value='';
  classStart.value='08:00';classEnd.value='09:00';renderClassDefaultTargets(['all']);classNotes.value='';
  classScheduleMode.value='schoolcycle';
  currentClassEdit={days:[1,2,3,4,5],scheduleMode:'schoolcycle',alternatePhase:'A',anchorDate:S.scheduleProfile?.anchorDate||'',cycleDays:[],dayType:'Any'};
  renderClassScheduleMode(currentClassEdit);classEditorTitle.textContent='Add Class';classEditorMsg.textContent='';
}
function editClassSchedule(id){
  const x=S.classes.find(c=>c.id===id);if(!x)return;
  classId.value=x.id;className.value=x.name;classShortName.value=x.shortName||'';classPeriod.value=x.period||'';
  classContinuationOf.value=x.continuationOf||'';
  classStart.value=x.startTime;classEnd.value=x.endTime;renderClassDefaultTargets(x.defaultTargets?.length?x.defaultTargets:['all']);
  classNotes.value=x.notes||'';classScheduleMode.value=x.scheduleMode||'schoolcycle';
  currentClassEdit={days:x.days||[1,2,3,4,5],scheduleMode:x.scheduleMode||'schoolcycle',alternatePhase:x.alternatePhase||'A',anchorDate:x.anchorDate||S.scheduleProfile?.anchorDate||'',cycleDays:x.cycleDays||periodPresetCycleDays(x.period),dayType:x.dayType||cycleDayColor(x.cycleDays||[])};
  renderClassScheduleMode(currentClassEdit);classEditorTitle.textContent='Edit Class';
}
async function saveClassSchedule(){
  try{
    const mode=classScheduleMode.value;
    const cycleDays=mode==='schoolcycle'?selectedClassCycleDays():[];
    const body={
      name:className.value.trim(),shortName:classShortName.value.trim(),period:classPeriod.value,continuationOf:classContinuationOf.value.trim(),
      startTime:classStart.value,endTime:classEnd.value,scheduleMode:mode,
      days:mode==='weekly'?[...classScheduleModeFields.querySelectorAll('[data-classday]:checked')].map(x=>Number(x.dataset.classday)):[1,2,3,4,5],
      alternatePhase:mode==='alternating'?(document.getElementById('classAlternatePhase')?.value||'A'):'A',
      anchorDate:S.scheduleProfile?.anchorDate||'',
      dayType:mode==='schoolcycle'?(document.getElementById('classDayType')?.value||cycleDayColor(cycleDays)):(mode==='alternating'?scheduleGroup(document.getElementById('classAlternatePhase')?.value==='B'?1:0).label:'Any'),
      cycleDays,defaultTargets:selectedClassDefaultTargets(),notes:classNotes.value,enabled:true
    };
    if(!body.name)throw Error('Class name is required');
    if(mode==='schoolcycle'&&!cycleDays.length)throw Error('Select at least one Cycle Day or choose a Period preset.');
    const id=classId.value;
    if(id)await api('/api/v1/class-schedules/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    else await jpost('/api/v1/class-schedules',body);
    classEditorMsg.textContent='Saved';await loadClassSchedules();await loadSchedules();newClassSchedule();
  }catch(e){classEditorMsg.textContent=e.message}
}
async function deleteClassSchedule(id){const x=S.classes.find(c=>c.id===id);if(!confirm(`Delete "${x?.name||id}"?`))return;await api('/api/v1/class-schedules/'+encodeURIComponent(id),{method:'DELETE'});await loadClassSchedules();await loadSchedules()}
async function duplicateClassSchedule(id){
  const source=S.classes.find(x=>x.id===id);
  if(!source)return;
  const name=prompt('Name for duplicated class:',`${source.name} - Copy`);
  if(name===null)return;
  try{
    await jpost(`/api/v1/class-schedules/${encodeURIComponent(id)}/duplicate`,{name:name.trim()||`${source.name} - Copy`});
    await loadClassSchedules();
    await loadSchedules();
  }catch(e){alert(e.message)}
}

function automationResolvedTime(cls,ref,offset){const t=ref==='end'?cls.endTime:cls.startTime;let [h,m]=t.split(':').map(Number),mins=h*60+m+Number(offset||0);mins=((mins%1440)+1440)%1440;return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`}
function renderAutomationClassBinding(){
  const ids=selectedAutomationClassIds(),classes=ids.map(id=>S.classes.find(x=>x.id===id)).filter(Boolean);
  const linked=classes.length>0;
  autoClassBindingFields.style.display=linked?'block':'none';
  autoTime.disabled=linked;autoScheduleMode.disabled=linked;scheduleModeFields.style.opacity=linked?'.45':'1';
  updateAutomationClassPreview();
}
function updateAutomationClassPreview(){
  const classes=selectedAutomationClassIds().map(id=>S.classes.find(x=>x.id===id)).filter(Boolean);
  if(!classes.length){autoClassPreview.textContent='';return}
  autoClassPreview.innerHTML=classes.map(cls=>`${esc(cls.name)} → ${automationResolvedTime(cls,autoClassRef.value,autoClassOffset.value)} • ${esc(classDaySummary(cls))}`).join('<br>')+`<br><span class="muted">The same event/actions will run separately for each linked class.</span>`;
}

let currentScheduleData={days:[1,2,3,4,5],scheduleMode:'weekly',alternatePhase:'A',anchorDate:'',includeDates:[],dayType:'Any',cycleDays:[]};
function renderScheduleModeFields(data=currentScheduleData){
  currentScheduleData={...currentScheduleData,...data};
  const mode=autoScheduleMode.value||currentScheduleData.scheduleMode||'weekly';
  currentScheduleData.scheduleMode=mode;

  if(mode==='weekly'){
    scheduleModeFields.innerHTML=`<b>Days of Week</b><div id="autoDays" class="toolbar" style="margin-top:6px">${days.map((d,i)=>`<label><input type="checkbox" data-autoday="${i}" ${(currentScheduleData.days||[]).includes(i)?'checked':''}> ${d}</label>`).join('')}</div>`;
    scheduleModeSummary.textContent='Runs on the selected weekdays.';
  }else if(mode==='schoolcycle'){
    const selected=currentScheduleData.cycleDays||[];
    const groups=S.scheduleProfile?.dayGroups||[];
    scheduleModeFields.innerHTML=`<div class="grid2">
      <label>Day Group<select id="autoDayType"><option value="Any" ${(currentScheduleData.dayType||'Any')==='Any'?'selected':''}>Any</option>${groups.map(g=>`<option value="${esc(g.label)}" ${currentScheduleData.dayType===g.label?'selected':''}>${esc(g.label)}</option>`).join('')}</select></label>
      <label>Anchor<input value="${esc(S.scheduleProfile?.anchorDate||'Set in School Calendar')} = Cycle ${esc(scheduleCycleDays()[0])}" disabled></label>
    </div>
    <b>Cycle Days</b><div class="toolbar">${scheduleCycleDays().map(letter=>`<label><input type="checkbox" data-autocycle="${esc(letter)}" ${selected.includes(letter)?'checked':''}> ${esc(letter)}</label>`).join('')}</div>
    <div class="muted">Only student school days advance the cycle.</div>`;
    scheduleModeSummary.textContent='Runs on the selected school day group and cycle days.';
  }else if(mode==='alternating'){
    scheduleModeFields.innerHTML=`<div class="grid2">
      <label>Run On<select id="autoAlternatePhase"><option value="A" ${currentScheduleData.alternatePhase!=='B'?'selected':''}>${esc(scheduleGroup(0).label)} Days</option><option value="B" ${currentScheduleData.alternatePhase==='B'?'selected':''}>${esc(scheduleGroup(1).label)} Days</option></select></label>
      <label>Anchor<input value="${esc(S.scheduleProfile?.anchorDate||'Set in School Calendar')} = ${esc(scheduleGroup(0).label)}" disabled></label>
    </div><div class="muted">Alternating groups are derived from the configured student cycle.</div>`;
    scheduleModeSummary.textContent='Runs on the selected alternating school-day group.';
  }else{
    scheduleModeFields.innerHTML=`<label><b>Specific Dates</b><textarea id="autoIncludeDates" rows="6" placeholder="2026-08-24&#10;2026-08-26" style="width:100%;resize:vertical">${esc((currentScheduleData.includeDates||[]).join('\n'))}</textarea><span class="muted">School calendar rules still apply.</span></label>`;
    scheduleModeSummary.textContent='Runs only on the listed dates.';
  }
}
function renderAutoTargets(selected=[]){
  const opts=autoTargetValues();
  const defaults=selected.length?selected:[opts[0]?.[0]].filter(Boolean);
  autoTargets.innerHTML=opts.map(([id,name])=>`<label><input type="checkbox" data-autotarget="${esc(id)}" ${defaults.includes(id)?'checked':''}> ${esc(name)}</label>`).join('');
}

function payloadInput(label,id,type='text',value='',extra=''){
  return `<label style="display:block;margin:8px 0">${label}<input id="${id}" type="${type}" value="${esc(value)}" ${extra} style="width:100%"></label>`;
}
function payloadTextarea(label,id,value='',extra=''){
  return `<label style="display:block;margin:8px 0">${label}<textarea id="${id}" ${extra} style="width:100%;min-height:150px;resize:vertical;white-space:pre-wrap;line-height:1.35;font:inherit;padding:10px 12px;box-sizing:border-box">${esc(value)}</textarea></label>`;
}

const automationVariables=['%date%','%time%','%day%','%class%','%class_short%','%classes%','%classes_short%','%class_start%','%class_end%','%minutes_left%','%schedule_day%','%room%'];
function variableButtons(targetId){
  return `<div class="toolbar" style="margin:4px 0 8px">${automationVariables.map(v=>`<button type="button" onclick="insertAutomationVariable('${targetId}','${v}')">${v}</button>`).join('')}</div>`;
}
function insertAutomationVariable(targetId,value){
  const field=document.getElementById(targetId);if(!field)return;
  const start=Number.isInteger(field.selectionStart)?field.selectionStart:field.value.length;
  const end=Number.isInteger(field.selectionEnd)?field.selectionEnd:start;
  field.value=field.value.slice(0,start)+value+field.value.slice(end);
  field.focus();const pos=start+value.length;try{field.setSelectionRange(pos,pos)}catch{}
  field.dispatchEvent(new Event('change',{bubbles:true}));
}
function renderAutomationFields(payload={}){
  renderAutoTargets(currentEditTargets||[]);
  const action=autoAction.value;
  let h='';
  if(action==='tv.power'||action==='govee.power'){
    h=`<label>State<select id="autoState"><option value="on" ${payload.state!=='off'?'selected':''}>On</option><option value="off" ${payload.state==='off'?'selected':''}>Off</option></select></label>`;
  }else if(action==='display.text'){
    h=payloadInput('Title','autoTitle','text',payload.title||'')+variableButtons('autoTitle')+
      payloadTextarea('Main Text','autoText',payload.text||'','rows="7" placeholder="Enter multiple lines here. Blank lines are preserved."')+variableButtons('autoText')+
      payloadInput('Subtitle','autoSubtitle','text',payload.subtitle||'')+variableButtons('autoSubtitle')+
      `<div class="grid2">${payloadInput('Text Color','autoTextColor','color',payload.color||'#ffffff')}${payloadInput('Background','autoBg','color',payload.background||'#000000')}</div>`+
      `<div class="grid2">${payloadInput('Text Size','autoTextSize','number',payload.size||54,'min="12" max="200"')}`+
      `<label>Position<select id="autoPosition"><option value="center" ${payload.position!=='top'&&payload.position!=='bottom'?'selected':''}>Center</option><option value="top" ${payload.position==='top'?'selected':''}>Top</option><option value="bottom" ${payload.position==='bottom'?'selected':''}>Bottom</option></select></label></div>`;
  }else if(action==='display.url'){
    h=payloadInput('Website / URL','autoUrl','url',payload.url||location.origin+'/')+
      `<label style="display:flex;gap:8px;align-items:flex-start;margin:10px 0">
        <input id="autoLocalDirect" type="checkbox" ${payload.localDirect!==false?'checked':''} style="margin-top:3px">
        <span><strong>Load directly from the TV browser</strong><br>
        <span class="muted">Use the selected TV's local network connection to open this URL. RoomGoblin only sends the URL to the TV; the Hub server does not fetch the page.</span></span>
      </label>`;
  }else if(action==='display.media'){
    const opts=S.mediaFiles.map(f=>`<option value="${esc(f.storedName)}" ${payload.storedName===f.storedName?'selected':''}>${esc(f.originalName||f.storedName)} — ${esc(f.type)}</option>`).join('');
    h=`<label>Uploaded File<select id="autoMedia">${opts||'<option value="">No uploaded media</option>'}</select></label>
       <div class="grid2" style="margin-top:8px">
        <label>Fit<select id="autoFit"><option value="contain" ${payload.fit!=='cover'?'selected':''}>Contain</option><option value="cover" ${payload.fit==='cover'?'selected':''}>Cover</option></select></label>
        ${payloadInput('Slide/Page Seconds','autoMediaSeconds','number',Math.round((payload.autoAdvanceMs||10000)/1000),'min="0" max="300"')}
       </div>
       <div class="toolbar"><label><input id="autoLoop" type="checkbox" ${payload.loop!==false?'checked':''}> Loop</label><label><input id="autoMuted" type="checkbox" ${payload.muted?'checked':''}> Mute Video</label></div>`;
  }else if(action==='display.timer.class-end'){
    h=payloadInput('Timer Label','autoTimerLabel','text',payload.label||'Class Ends In')+
      `<div class="grid2"><label>Position<select id="autoTimerPosition"><option value="top">Top</option><option value="center">Center</option><option value="bottom" selected>Bottom</option></select></label>${payloadInput('Font Size','autoTimerSize','number',payload.fontSize||64,'min="20" max="220"')}${payloadInput('Text Color','autoTimerTextColor','color',payload.textColor||'#ffffff')}${payloadInput('Border Color','autoTimerBorderColor','color',payload.borderColor||'#ffffff')}${payloadInput('Border Width','autoTimerBorderWidth','number',payload.borderWidth??4)}${payloadInput('Border Radius','autoTimerBorderRadius','number',payload.borderRadius??18)}</div>`+
      payloadInput('Background CSS','autoTimerBackground','text',payload.background||'rgba(0,0,0,.35)')+
      `<div class="muted">Link this event to a class. The timer calculates that class's actual end time when it runs.</div>`;
  }else if(action==='display.clear'){
    h='<div class="muted">The selected display(s) will be completely cleared at this time.</div>';
  }else if(action==='govee.color'){
    h=payloadInput('Color','autoColor','color',payload.color||'#0066ff');
  }else if(action==='govee.brightness'){
    h=payloadInput('Brightness 1–100','autoBrightness','number',payload.level||50,'min="1" max="100"');
  }else if(action==='govee.temp'){
    h=payloadInput('Color Temperature (Kelvin)','autoKelvin','number',payload.kelvin||6500,'min="2000" max="9000" step="100"');
  }else if(action==='govee.scene'){
    const firstTarget=[...autoTargets.querySelectorAll('[data-autotarget]:checked')][0]?.dataset.autotarget;
    const aliases=S.govee?.groups?.[firstTarget];
    const lookup=aliases?.[0]||firstTarget||'tv1';
    h=`<label>Scene<select id="autoScene"><option value="${esc(payload.scene||'')}">${esc(payload.scene||'Select target then Load Scenes')}</option></select></label>
       <button style="margin-top:8px" onclick="loadAutomationScenes('${esc(lookup)}')">Load Scenes</button>`;
  }
  autoPayload.innerHTML=h;
}

let currentEditTargets=[];


let autoSteps=[];
const AUTOMATION_ACTION_META={
  'tv.power':{group:'TV',label:'TV → Power On / Off',short:'TV Power'},
  'display.text':{group:'Display',label:'Display → Show Text',short:'Show Text'},
  'display.url':{group:'Display',label:'Display → Show Website',short:'Show Website'},
  'display.media':{group:'Display',label:'Display → Show Image / Video / Document',short:'Show Media'},
  'display.timer.class-end':{group:'Display',label:'Display → Class-End Countdown Timer',short:'Class-End Timer'},
  'display.clear':{group:'Display',label:'Display → Clear Screen',short:'Clear Screen'},
  'govee.power':{group:'Lighting',label:'Lighting → Power On / Off',short:'Light Power'},
  'govee.color':{group:'Lighting',label:'Lighting → Set Color',short:'Light Color'},
  'govee.brightness':{group:'Lighting',label:'Lighting → Set Brightness',short:'Light Brightness'},
  'govee.temp':{group:'Lighting',label:'Lighting → Set Color Temperature',short:'Light Temperature'},
  'govee.scene':{group:'Lighting',label:'Lighting → Activate Scene',short:'Light Scene'}
};

function automationActionOptions(selected){
  const groups=['TV','Display','Lighting'];
  return groups.map(group=>{
    const opts=Object.entries(AUTOMATION_ACTION_META)
      .filter(([,m])=>m.group===group)
      .map(([value,m])=>`<option value="${value}" ${selected===value?'selected':''}>${esc(m.label)}</option>`).join('');
    return `<optgroup label="${group}">${opts}</optgroup>`;
  }).join('');
}
function automationActionLabel(action){
  return AUTOMATION_ACTION_META[action]?.short||action||'Action';
}
function addAutomationStep(){
  autoSteps.push({
    id:`step-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action:'display.clear',targets:[],useEventTargets:true,payload:{},
    delaySeconds:0,continueOnError:true
  });
  renderAutomationSteps();
}
function removeAutomationStep(i){autoSteps.splice(i,1);renderAutomationSteps()}
function moveAutomationStep(i,d){
  const j=i+d;if(j<0||j>=autoSteps.length)return;
  [autoSteps[i],autoSteps[j]]=[autoSteps[j],autoSteps[i]];
  renderAutomationSteps();
}

async function ensureAutomationMediaLibrary(){
  if(S.mediaFiles?.length)return S.mediaFiles;
  try{
    const j=await api('/api/v1/media');
    S.mediaFiles=j.files||[];
  }catch(e){
    console.warn('Unable to load media library for scheduler:',e.message);
  }
  return S.mediaFiles||[];
}
function automationMediaOptions(selected=''){
  const files=S.mediaFiles||[];
  if(!files.length)return `<option value="${esc(selected)}">${selected?esc(selected):'No uploaded media found'}</option>`;
  const allowed=files.filter(f=>['image','video','pdf','presentation','document'].includes(f.type));
  const selectedExists=allowed.some(f=>f.storedName===selected);
  return `${selected&&!selectedExists?`<option value="${esc(selected)}" selected>${esc(selected)} (saved item)</option>`:''}
    <option value="">— Select uploaded media —</option>
    ${allowed.map(f=>`<option value="${esc(f.storedName)}" ${selected===f.storedName?'selected':''}>${esc(f.originalName||f.storedName)} • ${esc(f.type)}</option>`).join('')}`;
}
function previewAutomationMedia(i){
  const stored=autoSteps[i]?.payload?.storedName;
  if(!stored)return alert('Select media first.');
  const f=(S.mediaFiles||[]).find(x=>x.storedName===stored);
  if(!f?.url)return alert('This media item does not have a preview URL.');
  window.open(f.url,'_blank','noopener');
}
function refreshAutomationMediaPickers(){
  document.querySelectorAll('[data-step-media]').forEach(sel=>{
    const i=Number(sel.dataset.stepMedia);
    const selected=autoSteps[i]?.payload?.storedName||'';
    sel.innerHTML=automationMediaOptions(selected);
    sel.value=selected;
  });
}

function automationActionDomain(action){
  const a=String(action||'').toLowerCase();
  if(a.startsWith('govee.'))return 'lighting';
  if(a==='tv.power')return 'tv';
  if(a.startsWith('display.'))return 'display';
  return 'other';
}
function stepTargetValues(step){
  const domain=automationActionDomain(step?.action);
  if(domain==='lighting'){
    const groups=Object.keys(S.govee?.groups||{}).map(id=>[id,`${id.toUpperCase()} group`]);
    const devices=Object.entries(S.govee?.devices||{}).map(([id,d])=>[id,d.name||id]);
    return [...groups,...devices];
  }
  if(domain==='tv')return [
    ['all','All TVs'],['hdmi-all','All HDMI TVs'],['hdbt-all','All HDBT TVs'],
    ...Array.from({length:8},(_,n)=>[`tv${n+1}`,`TV ${n+1}`])
  ];
  return classDisplayTargets();
}
function stepTargetOptions(i){
  const step=autoSteps[i]||{};
  const values=stepTargetValues(step);
  const selected=Array.isArray(step.targets)&&step.targets.length?step.targets:[values[0]?.[0]||'all'];
  const domain=automationActionDomain(step.action);
  const help=domain==='lighting'?'Choose Govee lighting groups or individual lighting devices.'
    :domain==='tv'?'Choose All TVs, a TV transport group, or specific TVs.'
    :'Choose All Displays or select specific display clients.';
  return `<div class="panel" style="box-shadow:none;padding:10px;margin-top:6px">
    <b>Targets for this action</b>
    <div class="muted">${esc(help)}</div>
    <div class="toolbar" style="margin-top:6px">
      ${values.map(([id,label])=>`<label style="display:flex;gap:6px;align-items:center">
        <input type="checkbox" data-steptarget="${i}" data-target="${esc(id)}" ${selected.includes(id)?'checked':''}
          onchange="updateAutomationStepTargets(${i},'${esc(id)}',this.checked)">
        ${esc(label)}
      </label>`).join('')}
    </div>
  </div>`;
}
function updateAutomationStepTargets(i,id,checked){
  let targets=Array.isArray(autoSteps[i].targets)?[...autoSteps[i].targets]:[];
  if(id==='all'&&checked){
    targets=['all'];
  }else{
    targets=targets.filter(x=>x!=='all'&&x!==id);
    if(checked)targets.push(id);
    if(!targets.length)targets=['all'];
  }
  autoSteps[i].targets=[...new Set(targets)];
  renderAutomationSteps();
}

function stepPayloadHtml(step,i){
  const p=step.payload||{},a=step.action;

  if(a==='tv.power'){
    return `<div class="grid2">
      <label>TV Power
        <select onchange="autoSteps[${i}].payload.state=this.value">
          <option value="on" ${p.state!=='off'?'selected':''}>Turn On</option>
          <option value="off" ${p.state==='off'?'selected':''}>Turn Off</option>
        </select>
      </label>
    </div><div class="muted">Controls power for the TVs selected by this action.</div>`;
  }

  if(a==='govee.power'){
    return `<label>Lighting Power
      <select onchange="autoSteps[${i}].payload.state=this.value">
        <option value="on" ${p.state!=='off'?'selected':''}>Turn On</option>
        <option value="off" ${p.state==='off'?'selected':''}>Turn Off</option>
      </select>
    </label>`;
  }

  if(a==='display.text'){
    return `<label>Title<input id="stepTitle${i}" value="${esc(p.title||'')}" onchange="autoSteps[${i}].payload.title=this.value"></label>
      ${variableButtons(`stepTitle${i}`)}
      <label>Main Text<textarea id="stepText${i}" rows="5" onchange="autoSteps[${i}].payload.text=this.value">${esc(p.text||'')}</textarea></label>
      ${variableButtons(`stepText${i}`)}
      <label>Subtitle<input id="stepSubtitle${i}" value="${esc(p.subtitle||'')}" onchange="autoSteps[${i}].payload.subtitle=this.value"></label>
      ${variableButtons(`stepSubtitle${i}`)}
      <div class="muted">Variables are replaced when the scheduled event actually runs.</div>`;
  }

  if(a==='display.url'){
    return `<label>Website Address
      <input type="url" value="${esc(p.url||'https://')}" placeholder="https://example.com"
        onchange="autoSteps[${i}].payload.url=this.value">
    </label>
    <div class="muted">Enter the full website address that should appear on the display.</div>`;
  }

  if(a==='display.media'){
    return `<label>Media
      <select data-step-media="${i}" onchange="autoSteps[${i}].payload.storedName=this.value">
        ${automationMediaOptions(p.storedName||'')}
      </select>
    </label>
    <div class="toolbar" style="margin-top:8px">
      <button type="button" onclick="previewAutomationMedia(${i})">Preview Selected Media</button>
      <button type="button" onclick="ensureAutomationMediaLibrary().then(()=>{refreshAutomationMediaPickers()})">Refresh Media List</button>
    </div>
    <div class="muted">Choose an image, video, PDF, presentation, or document already uploaded to RoomGoblin. You no longer need the internal stored filename.</div>`;
  }

  if(a==='display.timer.class-end'){
    return `<label>Timer Label
      <input id="stepTimerLabel${i}" value="${esc(p.label||'%class_short% • Class Ends In')}"
        onchange="autoSteps[${i}].payload.label=this.value">
    </label>
    ${variableButtons(`stepTimerLabel${i}`)}
    <div class="muted">Counts down to the linked class's actual end time and remains at 00:00 when finished.</div>`;
  }

  if(a==='display.clear'){
    return `<div><b>Clear Display</b><div class="muted">Removes the current text/media content from the selected display targets.</div></div>`;
  }

  if(a==='govee.brightness'){
    return `<label>Brightness
      <input type="range" min="1" max="100" value="${Number(p.brightness??p.level??100)}"
        oninput="this.nextElementSibling.textContent=this.value+'%';autoSteps[${i}].payload.brightness=Number(this.value);autoSteps[${i}].payload.level=Number(this.value)">
      <span>${Number(p.brightness??p.level??100)}%</span>
    </label>`;
  }

  if(a==='govee.scene'){
    return `<label>Lighting Scene
      <input value="${esc(p.scene||'Rainbow')}" placeholder="Rainbow"
        onchange="autoSteps[${i}].payload.scene=this.value">
    </label><div class="muted">Enter the scene name recognized by the configured Govee integration.</div>`;
  }

  if(a==='govee.color'){
    return `<label>Lighting Color
      <input type="color" value="${esc(p.color||'#ffffff')}"
        onchange="autoSteps[${i}].payload.color=this.value">
    </label>`;
  }

  if(a==='govee.temp'){
    return `<label>White Color Temperature (Kelvin)
      <input type="number" min="2000" max="9000" step="100" value="${Number(p.temperature??p.kelvin??4000)}"
        onchange="autoSteps[${i}].payload.temperature=Number(this.value);autoSteps[${i}].payload.kelvin=Number(this.value)">
    </label>`;
  }

  return '<div class="muted">No additional settings are required for this action.</div>';
}

function renderAutomationSteps(){
  if(!window.autoActionSteps)return;

  if(!autoSteps.length){
    autoActionSteps.innerHTML=`<div class="muted">No additional actions configured. Click <b>+ Add Action</b> to run another command from the same scheduled event.</div>`;
    return;
  }

  autoActionSteps.innerHTML=autoSteps.map((step,i)=>{
    const actionNumber=i+2;
    const label=automationActionLabel(step.action);
    return `<div class="card" style="margin-top:12px;border-width:2px">
      <div class="top">
        <div>
          <b>ACTION ${actionNumber} — ${esc(label)}</b>
          <div class="muted">Runs after Action ${actionNumber-1}${Number(step.delaySeconds||0)>0?` with a ${Number(step.delaySeconds)} second delay`:''}.</div>
        </div>
        <div class="toolbar">
          <button type="button" onclick="moveAutomationStep(${i},-1)" ${i===0?'disabled':''}>↑ Move Up</button>
          <button type="button" onclick="moveAutomationStep(${i},1)" ${i===autoSteps.length-1?'disabled':''}>↓ Move Down</button>
          <button type="button" class="danger" onclick="removeAutomationStep(${i})">Remove Action</button>
        </div>
      </div>

      <div class="grid2">
        <label>What should this action do?
          <select onchange="const oldDomain=automationActionDomain(autoSteps[${i}].action);autoSteps[${i}].action=this.value;const newDomain=automationActionDomain(this.value);autoSteps[${i}].payload={};if(oldDomain!==newDomain){autoSteps[${i}].useEventTargets=(newDomain===automationActionDomain(autoAction.value));autoSteps[${i}].targets=[];}renderAutomationSteps();if(this.value==='display.media')ensureAutomationMediaLibrary().then(refreshAutomationMediaPickers)">
            ${automationActionOptions(step.action)}
          </select>
        </label>

        <label>Wait before running
          <div style="display:flex;gap:8px;align-items:center">
            <input type="number" min="0" max="3600" value="${Number(step.delaySeconds||0)}"
              onchange="autoSteps[${i}].delaySeconds=Number(this.value)">
            <span class="muted">seconds</span>
          </div>
        </label>
      </div>

      <div class="panel" style="box-shadow:none;margin-top:10px">
        ${(()=>{const sameDomain=automationActionDomain(step.action)===automationActionDomain(autoAction.value);return `
        <label style="display:flex;gap:8px;align-items:center;margin:0">
          <input type="checkbox" ${sameDomain&&step.useEventTargets!==false?'checked':''} ${sameDomain?'':'disabled'}
            onchange="autoSteps[${i}].useEventTargets=this.checked;renderAutomationSteps()">
          <b>Use the same targets as the main scheduled event</b>
        </label>
        ${sameDomain&&step.useEventTargets!==false
          ? `<div class="muted" style="margin-top:5px">This action uses the same compatible ${esc(automationActionDomain(step.action))} targets selected at the top of the event.</div>`
          : `${!sameDomain?`<div class="muted" style="margin-top:5px"><b>Different target type:</b> the main event uses ${esc(automationActionDomain(autoAction.value))} targets while this action requires ${esc(automationActionDomain(step.action))} targets. Select them explicitly below.</div>`:''}${stepTargetOptions(i)}`}
        `})()}
      </div>

      <div class="panel" style="box-shadow:none;margin-top:10px">
        <b>Action Settings</b>
        <div style="margin-top:8px">${stepPayloadHtml(step,i)}</div>
      </div>

      <label style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <input type="checkbox" ${step.continueOnError!==false?'checked':''}
          onchange="autoSteps[${i}].continueOnError=this.checked">
        Continue to the next action if this action fails
      </label>
    </div>`;
  }).join('');

  if(autoSteps.some(x=>x.action==='display.media')){
    ensureAutomationMediaLibrary().then(refreshAutomationMediaPickers);
  }
}
function readAutomationSteps(){return autoSteps.map((x,i)=>({id:x.id||`step-${i+1}`,action:x.action,targets:x.targets||[],useEventTargets:x.useEventTargets!==false,payload:x.payload||{},delaySeconds:Number(x.delaySeconds||0),continueOnError:x.continueOnError!==false}))}

function populateTimerOverlayClassSelect(selected=''){
  if(!window.autoTimerOverlayClass)return;
  const current=String(selected||'');
  const classes=[...S.classes].sort(compareClassesByPhaseTime);
  autoTimerOverlayClass.innerHTML=
    `<option value="">Use Event Linked / Active Class</option>`+
    classes.map(cls=>
      `<option value="${esc(cls.id)}" ${current===cls.id?'selected':''}>${esc(cls.name)} • ${esc(classDaySummary(cls))} • ends ${esc(cls.endTime)}</option>`
    ).join('');
  autoTimerOverlayClass.value=current;
}

function renderTimerOverlayFields(data=undefined){
  // Passing null means "this event has no timer overlay". Reset the UI fully
  // instead of retaining the state from the previously edited event.
  if(data===null){
    autoTimerOverlayEnabled.checked=false;
    autoTimerOverlaySource.value='class-end';
    populateTimerOverlayClassSelect('');
    autoTimerOverlayMinutes.value='10';
    autoTimerOverlayPosition.value='bottom';
    autoTimerOverlaySize.value='64';
    autoTimerOverlayTextColor.value='#ffffff';
    autoTimerOverlayBorderColor.value='#ffffff';
    autoTimerOverlayBorderWidth.value='4';
    autoTimerOverlayBorderRadius.value='18';
    autoTimerOverlayLabel.value='%class_short% • Class Ends In';
    autoTimerOverlayBackground.value='rgba(0,0,0,.35)';
    autoTimerOverlayUseEventTargets.checked=true;
    autoTimerOverlayFollowLinkedClasses.checked=true;
  }else if(data&&typeof data==='object'){
    autoTimerOverlayEnabled.checked=!!data.enabled;
    autoTimerOverlaySource.value=data.source||'class-end';
    populateTimerOverlayClassSelect(data.classId||'');
    autoTimerOverlayMinutes.value=String(Math.max(1,Math.round(Number(data.durationSeconds||600)/60)));
    autoTimerOverlayPosition.value=data.position||'bottom';
    autoTimerOverlaySize.value=String(data.fontSize||64);
    autoTimerOverlayTextColor.value=data.textColor||'#ffffff';
    autoTimerOverlayBorderColor.value=data.borderColor||'#ffffff';
    autoTimerOverlayBorderWidth.value=String(data.borderWidth??4);
    autoTimerOverlayBorderRadius.value=String(data.borderRadius??18);
    autoTimerOverlayLabel.value=data.label||'%class_short% • Class Ends In';
    autoTimerOverlayBackground.value=data.background||'rgba(0,0,0,.35)';
    autoTimerOverlayUseEventTargets.checked=data.useEventTargets!==false;
    autoTimerOverlayFollowLinkedClasses.checked=data.followLinkedClasses!==false;
  }

  if(data===undefined)populateTimerOverlayClassSelect(autoTimerOverlayClass?.value||'');

  const enabled=autoTimerOverlayEnabled.checked;
  autoTimerOverlayFields.style.display=enabled?'block':'none';
  autoTimerOverlayDurationWrap.style.display=(enabled&&autoTimerOverlaySource.value==='duration')?'block':'none';
  autoTimerOverlayClassWrap.style.display=(enabled&&autoTimerOverlaySource.value==='class-end')?'block':'none';
}
function readTimerOverlay(){
  if(!autoTimerOverlayEnabled.checked)return null;
  return {
    enabled:true,
    source:autoTimerOverlaySource.value,
    classId:autoTimerOverlaySource.value==='class-end'?(window.autoTimerOverlayClass?.value||''):'',
    durationSeconds:Math.max(60,Number(autoTimerOverlayMinutes.value||10)*60),
    position:autoTimerOverlayPosition.value,
    fontSize:Number(autoTimerOverlaySize.value||64),
    textColor:autoTimerOverlayTextColor.value,
    borderColor:autoTimerOverlayBorderColor.value,
    borderWidth:Number(autoTimerOverlayBorderWidth.value||4),
    borderRadius:Number(autoTimerOverlayBorderRadius.value||18),
    label:autoTimerOverlayLabel.value,
    background:autoTimerOverlayBackground.value,
    useEventTargets:autoTimerOverlayUseEventTargets.checked,
    followLinkedClasses:autoTimerOverlayFollowLinkedClasses.checked,
    followGapMinutes:15
  };
}
function newAutomation(){
  autoId.value='';autoName.value='';autoTime.value='07:45';autoAction.value='tv.power';autoEnabled.value='1';autoSteps=[];renderAutomationSteps();renderTimerOverlayFields(null);populateAutomationClassSelect([]);autoClassRef.value='start';autoClassOffset.value='0';autoUseClassTargets.checked=true;
  currentEditTargets=[configuredDisplayTargets(false)[0]?.[0]||'all'];
  currentScheduleData={days:[1,2,3,4,5],scheduleMode:'weekly',alternatePhase:'A',anchorDate:'',includeDates:[]};
  autoScheduleMode.value='weekly';renderScheduleModeFields(currentScheduleData);renderAutomationFields({state:'on'});renderAutomationClassBinding();
  automationEditorTitle.textContent='New Scheduled Event';autoEditorMsg.textContent='';
}
function readAutoPayload(){
  const action=autoAction.value;
  if(action==='tv.power'||action==='govee.power')return {state:autoState.value};
  if(action==='display.text')return {title:autoTitle.value,text:autoText.value,subtitle:autoSubtitle.value,color:autoTextColor.value,background:autoBg.value,size:Number(autoTextSize.value),position:autoPosition.value};
  if(action==='display.url')return {url:autoUrl.value.trim(),localDirect:autoLocalDirect.checked};
  if(action==='display.media')return {storedName:autoMedia.value,fit:autoFit.value,autoAdvanceMs:Number(autoMediaSeconds.value||0)*1000,loop:autoLoop.checked,muted:autoMuted.checked};
  if(action==='display.timer.class-end')return {label:autoTimerLabel.value,position:autoTimerPosition.value,fontSize:Number(autoTimerSize.value||64),textColor:autoTimerTextColor.value,borderColor:autoTimerBorderColor.value,borderWidth:Number(autoTimerBorderWidth.value||4),borderRadius:Number(autoTimerBorderRadius.value||18),background:autoTimerBackground.value};
  if(action==='display.clear')return {};
  if(action==='govee.color')return {color:autoColor.value};
  if(action==='govee.brightness')return {level:Number(autoBrightness.value)};
  if(action==='govee.temp')return {kelvin:Number(autoKelvin.value)};
  if(action==='govee.scene')return {scene:autoScene.value};
  return {};
}
function editorEvent(){
  const mode=autoScheduleMode.value;
  const daysSelected=mode==='weekly'?[...scheduleModeFields.querySelectorAll('[data-autoday]:checked')].map(x=>Number(x.dataset.autoday)):[1,2,3,4,5];
  return {
    name:autoName.value.trim()||autoAction.options[autoAction.selectedIndex].text,
    enabled:autoEnabled.value==='1',
    time:autoTime.value,
    days:daysSelected,
    scheduleMode:mode,
    alternatePhase:mode==='alternating'?(document.getElementById('autoAlternatePhase')?.value||'A'):'A',
    anchorDate:mode==='alternating'?(S.scheduleProfile?.anchorDate||currentScheduleData.anchorDate||''):'',
    includeDates:mode==='dates'?parseDateLines(document.getElementById('autoIncludeDates')?.value||''):[],
    dayType:mode==='schoolcycle'?(document.getElementById('autoDayType')?.value||'Any'):'Any',
    cycleDays:mode==='schoolcycle'?[...document.querySelectorAll('[data-autocycle]:checked')].map(x=>x.dataset.autocycle):[],
    classIds:selectedAutomationClassIds(),classId:selectedAutomationClassIds()[0]||'',classTimeReference:autoClassRef.value,classTimeOffsetMinutes:Number(autoClassOffset.value||0),useClassTargets:autoUseClassTargets.checked,
    action:autoAction.value,
    targets:[...autoTargets.querySelectorAll('[data-autotarget]:checked')].map(x=>x.dataset.autotarget),
    payload:readAutoPayload(),actions:readAutomationSteps(),timerOverlay:readTimerOverlay()
  };
}
async function saveAutomation(){
  try{
    const body=editorEvent();
    if(!body.targets.length&&!((body.classIds||[]).length&&body.useClassTargets))throw Error('Select a target or use the class default targets');
    const id=autoId.value;
    const j=id?
      await api('/api/v1/automations/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}):
      await jpost('/api/v1/automations',body);
    autoEditorMsg.textContent=body.timerOverlay?.enabled?'Saved • Timer Overlay enabled':'Saved • Timer Overlay disabled';await loadSchedules();editAutomation(j.event.id);
  }catch(e){autoEditorMsg.textContent=e.message}
}
async function deleteAutomation(id,name){
  if(!confirm(`Delete scheduled event "${name}"?`))return;
  await api('/api/v1/automations/'+encodeURIComponent(id),{method:'DELETE'});loadSchedules();newAutomation();
}
function automationRunFailureSummary(result={}){
  const failures=(result.steps||[]).filter(x=>x?.ok===false).map(x=>`${automationActionLabel(x.action)}: ${x.error||'failed'}`);
  if(result.timerOverlay?.ok===false)failures.push(`Timer Overlay: ${result.timerOverlay.error||'failed'}`);
  return failures;
}
async function runAutomation(id){
  const msg=document.getElementById('autoEditorMsg');
  try{
    const result=await jpost('/api/v1/automations/'+encodeURIComponent(id)+'/run',{});
    const failures=automationRunFailureSummary(result);
    await loadSchedules();
    if(msg)msg.textContent=failures.length?`Test completed with errors: ${failures.join(' • ')}`:'Test completed successfully.';
    if(failures.length)console.warn('Automation Test Now failures',failures,result);
    return result;
  }catch(e){
    if(msg)msg.textContent=e.message;
    alert(e.message);
    throw e;
  }
}
async function testAutomationEditor(){
  try{
    const id=autoId.value;
    if(id)return runAutomation(id);
    autoEditorMsg.textContent='Save the event first, then Test Now.';
  }catch(e){autoEditorMsg.textContent=e.message}
}
async function duplicateAutomation(id){
  const source=S.automations.find(x=>x.id===id);
  if(!source)return;
  const name=prompt('Name for duplicated scheduled event:',`${source.name} - Copy`);
  if(name===null)return;
  try{
    await jpost(`/api/v1/automations/${encodeURIComponent(id)}/duplicate`,{name:name.trim()||`${source.name} - Copy`});
    await loadSchedules();
  }catch(e){alert(e.message)}
}

function editAutomation(id){
  const e=S.automations.find(x=>x.id===id);if(!e)return;
  autoId.value=e.id;autoName.value=e.name||'';autoTime.value=e.time;autoAction.value=e.action;autoEnabled.value=e.enabled?'1':'0';populateAutomationClassSelect(Array.isArray(e.classIds)&&e.classIds.length?e.classIds:[e.classId].filter(Boolean));autoClassRef.value=e.classTimeReference||'start';autoClassOffset.value=String(e.classTimeOffsetMinutes||0);autoUseClassTargets.checked=e.useClassTargets!==false;
  currentEditTargets=[...(e.targets||[])];
  currentScheduleData={days:e.days||[1,2,3,4,5],scheduleMode:e.scheduleMode||'weekly',alternatePhase:e.alternatePhase||'A',anchorDate:e.anchorDate||'',includeDates:e.includeDates||[],dayType:e.dayType||'Any',cycleDays:e.cycleDays||[]};
  autoScheduleMode.value=currentScheduleData.scheduleMode;renderScheduleModeFields(currentScheduleData);renderAutomationFields(e.payload||{});renderAutomationClassBinding();renderTimerOverlayFields(e.timerOverlay||null);autoSteps=Array.isArray(e.actions)?JSON.parse(JSON.stringify(e.actions)):[];renderAutomationSteps();
  automationEditorTitle.textContent='Edit Scheduled Event';
}
function describeAutomation(e){
  const p=e.payload||{};
  if(e.action==='tv.power'||e.action==='govee.power')return String(p.state||'on').toUpperCase();
  if(e.action==='display.text'){
    const body=String(p.text||'').replace(/\r\n/g,'\n');
    const preview=body.split('\n').filter(x=>x.trim()).slice(0,2).join(' / ');
    return `Text: ${p.title||preview||'(blank)'}`;
  }
  if(e.action==='display.url')return `${p.url||'URL'}${p.localDirect!==false?' • TV local':''}`;
  if(e.action==='display.media'){const f=S.mediaFiles.find(x=>x.storedName===p.storedName);return `Media: ${f?.originalName||p.storedName||'unknown'}`}
  if(e.action==='display.timer.class-end')return `Countdown to class end${e.classId?' • class-linked':''}`;
  if(e.action==='display.clear')return 'Clear display';
  if(e.action==='govee.color')return `Color ${p.color||''}`;
  if(e.action==='govee.brightness')return `Brightness ${p.level||''}%`;
  if(e.action==='govee.temp')return `${p.kelvin||''}K`;
  if(e.action==='govee.scene')return `Scene: ${p.scene||''}`;
  return e.action;
}
function scheduleDescription(e){
  if(e.scheduleMode==='schoolcycle')return `${e.dayType||'Any'} • Cycle ${(e.cycleDays||[]).join(', ')||'Any'}`;
  const mode=e.scheduleMode||'weekly';
  if(mode==='alternating')return `${e.alternatePhase||'A'} Days • anchor ${e.anchorDate||'not set'}`;
  if(mode==='dates'){
    const ds=e.includeDates||[];
    return `${ds.length} specific date${ds.length===1?'':'s'}${ds.length?` • ${ds.slice(0,3).join(', ')}${ds.length>3?'…':''}`:''}`;
  }
  return (e.days||[]).map(d=>days[d]).join(', ')||'No weekdays';
}
function renderSchedulerCalendar(){
  const c=S.schedulerCalendar||{};
  const p=S.scheduleProfile||{};
  const groups=p.dayGroups||[];
  schoolProfileName.value=p.name||'School Schedule';
  schoolProfileAnchor.value=p.anchorDate||'';
  schoolProfileCycleDays.value=(p.cycleDays||[]).join(', ');
  schoolProfileContinuationGap.value=p.continuation?.maximumGapMinutes??15;
  schoolProfileLegacyContinuation.checked=p.continuation?.legacyBisonCompatibility===true;
  schoolProfileGroupOneLabel.value=groups[0]?.label||'Day A';schoolProfileGroupOneDays.value=(groups[0]?.cycleDays||[]).join(', ');
  schoolProfileGroupTwoLabel.value=groups[1]?.label||'Day B';schoolProfileGroupTwoDays.value=(groups[1]?.cycleDays||[]).join(', ');
  schoolProfileAdditionalGroups.value=JSON.stringify(groups.slice(2),null,2);
  schoolProfilePeriodMap.value=JSON.stringify(p.periodCycleDays||{},null,2);
  schoolProfileExceptionRules.value=JSON.stringify(p.exceptionRules||{},null,2);
  calendarExcludedDates.value=(c.noSchoolDates||c.excludedDates||[]).join('\n');
  calendarHalfDayDates.value=(c.halfDayDates||[]).join('\n');
  calendarOneHourDelayDates.value=(c.oneHourDelayDates||[]).join('\n');
  calendarTwoHourDelayDates.value=(c.twoHourDelayDates||[]).join('\n');
  calendarRemoteDates.value=(c.remoteDates||[]).join('\n');
  districtCalendarPreview.textContent=`Rotation is recalculated live from ${p.anchorDate||'the first configured school day'} = ${groups[0]?.label||'first group'} / Cycle ${(p.cycleDays||[])[0]||'A'}. ${calendarExcludedDates.value?parseDateLines(calendarExcludedDates.value).length:0} no-school • ${(c.halfDayDates||[]).length} half-day • ${(c.oneHourDelayDates||[]).length} one-hour delay • ${(c.twoHourDelayDates||[]).length} two-hour delay • ${(c.remoteDates||[]).length} remote.`;
}
async function saveSchedulerCalendar(){
  try{
    const csv=value=>[...new Set(String(value||'').split(',').map(x=>x.trim()).filter(Boolean))];
    const cycleDays=csv(schoolProfileCycleDays.value);
    const parseObject=(value,label)=>{let parsed;try{parsed=JSON.parse(value||'{}')}catch{throw Error(`${label} must be valid JSON`)}if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw Error(`${label} must be a JSON object`);return parsed};
    const parseArray=(value,label)=>{let parsed;try{parsed=JSON.parse(value||'[]')}catch{throw Error(`${label} must be valid JSON`)}if(!Array.isArray(parsed))throw Error(`${label} must be a JSON array`);return parsed};
    const body={
      noSchoolDates:parseDateLines(calendarExcludedDates.value),
      halfDayDates:parseDateLines(calendarHalfDayDates.value),
      oneHourDelayDates:parseDateLines(calendarOneHourDelayDates.value),
      twoHourDelayDates:parseDateLines(calendarTwoHourDelayDates.value),
      remoteDates:parseDateLines(calendarRemoteDates.value),
      scheduleProfile:{
        ...S.scheduleProfile,name:schoolProfileName.value.trim(),anchorDate:schoolProfileAnchor.value,cycleDays,
        dayGroups:[
          {...(S.scheduleProfile?.dayGroups?.[0]||{}),id:S.scheduleProfile?.dayGroups?.[0]?.id||'group-1',label:schoolProfileGroupOneLabel.value.trim(),cycleDays:csv(schoolProfileGroupOneDays.value)},
          {...(S.scheduleProfile?.dayGroups?.[1]||{}),id:S.scheduleProfile?.dayGroups?.[1]?.id||'group-2',label:schoolProfileGroupTwoLabel.value.trim(),cycleDays:csv(schoolProfileGroupTwoDays.value)},
          ...parseArray(schoolProfileAdditionalGroups.value,'Additional day groups')
        ],
        periodCycleDays:parseObject(schoolProfilePeriodMap.value,'Period mapping'),
        exceptionRules:parseObject(schoolProfileExceptionRules.value,'Exception rules'),
        continuation:{maximumGapMinutes:Number(schoolProfileContinuationGap.value||15),legacyBisonCompatibility:schoolProfileLegacyContinuation.checked}
      }
    };
    const j=await api('/api/v1/automations/calendar',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    S.schedulerCalendar=j.calendar;S.scheduleProfile=j.scheduleProfile||S.scheduleProfile;S.districtNoSchoolDates=j.districtNoSchoolDates||S.districtNoSchoolDates;calendarMsg.textContent='School calendar rules and profile saved; cycle recalculated';renderSchedulerCalendar();
    await refreshBrandStatus();
    const [autos,cls]=await Promise.all([api('/api/v1/automations'),api('/api/v1/class-schedules/status')]);
    S.automations=autos.events||S.automations;S.scheduler=autos.scheduler||S.scheduler;S.classStatus={schoolCycle:cls.schoolCycle||null,calendarRule:cls.calendarRule||null,activeClass:cls.activeClass||null,nextClass:cls.nextClass||null};
    renderSchedulerClock();renderAutomationList();
  }catch(e){calendarMsg.textContent=e.message}
}

function renderSchedulerClock(){
  const s=S.scheduler;
  schedulerClock.innerHTML=s
    ? `Scheduler: <b>${esc(s.localTime)}</b> • Timezone: <b>${esc(s.timezone)}</b> • UTC: ${esc(s.utcTime)} • Catch-up: ${Number(s.catchupMinutes||0)} min`
    : 'Scheduler clock unavailable';
}
function renderAutomationList(){
  if(!S.automations.length){automationList.innerHTML='<div class="muted">No scheduled events yet.</div>';return}
  const sorted=[...S.automations].sort(compareAutomationsByPhaseTime);
  automationList.innerHTML=sorted.map(e=>{
    const last=e.lastRun?`${e.lastRun.ok?'✓':'✕'} ${new Date(e.lastRun.at).toLocaleString()}${e.lastRun.message?' — '+esc(e.lastRun.message):''}`:'Never';
    return `<div class="card" style="box-shadow:none;margin:8px 0">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div><b>${esc(e.time)} — ${esc(e.name)}</b> ${e.enabled?'<span class="pill">Enabled</span>':'<span class="pill">Disabled</span>'}
        <div class="muted">${esc(scheduleDescription(e))} • ${esc(e.action)} • ${esc((e.targets||[]).join(', '))}</div>
        <div>${esc(describeAutomation(e))}</div><div class="muted">Last run: ${last}</div></div>
        <div class="toolbar"><button onclick="editAutomation(${inlineJsArg(e.id)})">Edit</button><button onclick="duplicateAutomation(${inlineJsArg(e.id)})">Duplicate</button><button onclick="runAutomation(${inlineJsArg(e.id)})">Run Now</button><button class="danger" onclick="deleteAutomation(${inlineJsArg(e.id)},${inlineJsArg(e.name)})">Delete</button></div>
      </div>
    </div>`;
  }).join('');
}
async function loadAutomationScenes(alias){
  try{
    const j=await api('/api/v1/govee/'+encodeURIComponent(alias)+'/scenes');
    autoScene.innerHTML=j.scenes.map(x=>`<option>${esc(x)}</option>`).join('');
  }catch(e){autoEditorMsg.textContent=e.message}
}
async function loadMorningWatch(){
  try{
    const x=await api('/api/v1/automations/morning-announcements'),c=x.config||{},r=x.runtime||{};
    morningWatchEnabled.value=c.enabled===false?'0':'1';morningWatchUrl.value=c.streamUrl||'';morningWatchStart.value=c.startTime||'07:00';morningWatchEnd.value=c.endTime||'08:30';morningWatchVolume.value=String(Number.isFinite(Number(c.volumePercent))?Number(c.volumePercent):100);morningWatchVolumeValue.textContent=morningWatchVolume.value+'%';
    const unknown=!r.active&&r.lastCheck&&r.probeStatus==='unavailable';
    morningWatchState.textContent=r.active?'PLAYING':(r.live?'LIVE':(unknown?'UNKNOWN':'OFFLINE'));
    morningWatchState.className='pill '+(r.active||r.live?'ok':'');
    const extra=r.lastCheck?` • last check ${new Date(r.lastCheck).toLocaleTimeString()}`:'';
    const duration=Number.isFinite(Number(r.probeDurationMs))?` • ${Number(r.probeDurationMs)} ms`:'';
    const probeLabel=r.probe?(r.probeStatus?`${r.probe}: ${r.probeStatus}`:r.probe):'not checked';
    morningWatchMsg.textContent=`${probeLabel}${extra}${duration}${r.lastError?' • '+r.lastError:''}`;
  }catch(e){morningWatchMsg.textContent=e.message}
}
async function saveMorningWatch(){
  try{
    const x=await api('/api/v1/automations/morning-announcements',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:morningWatchEnabled.value==='1',streamUrl:morningWatchUrl.value.trim(),startTime:morningWatchStart.value,endTime:morningWatchEnd.value,volumePercent:Number(morningWatchVolume.value),targets:['all'],offlineConfirmations:2,checkIntervalSeconds:15})});
    morningWatchMsg.textContent='Saved';await loadMorningWatch();return x;
  }catch(e){morningWatchMsg.textContent=e.message}
}
async function checkMorningWatch(){
  const btn=document.getElementById('morningWatchCheckBtn');
  if(btn?.disabled)return;
  if(btn){btn.disabled=true;btn.textContent='Checking…'}
  morningWatchMsg.textContent='Checking stream now…';
  morningWatchState.textContent='CHECKING';morningWatchState.className='pill';
  try{
    // The manual action is deliberately independent of the configured watch window.
    // It always performs a real probe and returns the result directly to this click.
    const x=await jpost('/api/v1/automations/morning-announcements/check',{});
    const r=x.runtime||{};
    const state=x.live===true?'LIVE':(x.live===false?'OFFLINE':'UNKNOWN');
    morningWatchState.textContent=r.active?'PLAYING':state;
    morningWatchState.className='pill '+(r.active||x.live?'ok':'');
    const checked=r.lastCheck?` • checked ${new Date(r.lastCheck).toLocaleTimeString()}`:'';
    const duration=Number.isFinite(Number(x.durationMs))?` • ${Number(x.durationMs)} ms`:'';
    const detail=x.status?` • ${x.status}`:'';
    const attempts=Array.isArray(x.attempts)&&x.attempts.length?` • attempts: ${x.attempts.map(a=>`${a.probe||'?'}=${a.live===true?'live':(a.live===false?'offline':(a.status||a.httpStatus||a.error||'no-result'))}`).join(', ')}`:'';
    morningWatchMsg.textContent=`Probe: ${x.probe||'none'} • ${state}${detail}${checked}${duration}${attempts}`;
  }catch(e){
    morningWatchState.textContent='ERROR';morningWatchState.className='pill';
    morningWatchMsg.textContent=`Check failed: ${e.message}`;
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Check Stream Now'}
  }
}

async function loadSchedules(){
  try{
    const [a,m,g,cal,cls]=await Promise.all([
      api('/api/v1/automations'),
      api('/api/v1/media'),
      api('/api/v1/govee'),
      api('/api/v1/automations/calendar'),
      api('/api/v1/class-schedules')
    ]);
    S.automations=a.events||[];S.mediaFiles=m.files||[];S.govee=g;S.scheduler=a.scheduler||null;S.classes=cls.classes||[];S.classStatus={schoolCycle:cls.schoolCycle||null,calendarRule:cls.calendarRule||null,activeClass:cls.activeClass||null,nextClass:cls.nextClass||null};populateAutomationClassSelect(selectedAutomationClassIds());
    S.schedulerCalendar=cal.calendar||S.schedulerCalendar;S.scheduleProfile=cal.scheduleProfile||S.scheduleProfile;S.districtNoSchoolDates=cal.districtNoSchoolDates||[];
    renderSchedulerClock();renderSchedulerCalendar();renderAutomationList();loadMorningWatch();
    if(!autoId.value)newAutomation();
  }catch(e){automationList.innerHTML=`<div class="bad">${esc(e.message)}</div>`}
}

function diagBadge(ok,label,value=''){
  return `<div class="card"><div class="muted">${esc(label)}</div><div class="kpi ${ok?'ok':'bad'}">${ok?'OK':'ISSUE'}</div>${value?`<div class="muted">${esc(value)}</div>`:''}</div>`;
}
function diagnosticRows(rows){
  if(!rows?.length)return '<div class="muted">No matching events.</div>';
  return `<table><thead><tr><th>Time</th><th>Type</th><th>Component / Operation</th><th>Status</th><th>Details</th></tr></thead><tbody>${
    rows.slice().reverse().map(e=>{
      const component=e.component||e.source||e.commandType||e.kind||'';
      const op=e.operation||e.commandType||e.path||e.action||'';
      const status=e.status??(e.ok===false?'FAILED':e.ok===true?'OK':'');
      const details=e.message||e.error||e.target||e.name||'';
      return `<tr><td>${esc(new Date(e.at).toLocaleString())}</td><td>${esc(e.kind||'')}</td><td>${esc(`${component}${op?` • ${op}`:''}`)}</td><td>${esc(String(status))}</td><td>${esc(String(details))}</td></tr>`;
    }).join('')
  }</tbody></table>`;
}
async function loadDiagnostics(){
  try{
    const x=await api('/api/v1/diagnostics');
    window.DIAG=x;
    loadDiagnosticInfrastructure();
    const sv=x.services||{};
    diagSummary.innerHTML=[
      diagBadge(!!sv.classroomHub?.ok,'RoomGoblin',x.system?.version||''),
      diagBadge(!!sv.mqtt?.ok,'MQTT',sv.mqtt?.ok?'Connected':'Disconnected'),
      diagBadge(!!sv.pluto?.ok,'Pluto',sv.pluto?.lastError||'Healthy'),
      diagBadge(!!sv.govee?.ok,'Govee',sv.govee?.lastError||`${sv.govee?.configuredDevices||0} devices`),
      diagBadge(!!sv.veyon?.ok,'Veyon',`Pool ${sv.veyon?.pool?.size||0}/${sv.veyon?.pool?.max||0}`),
      diagBadge(!!sv.displays?.ok,'Displays',`${sv.displays?.online||0}/${sv.displays?.configured||0} online`),
      diagBadge(!!sv.database?.ok,'Database',sv.database?.ok?`Schema ${sv.database.schemaVersion||1} • ${sv.database.normalized?.displays||0} displays • ${sv.database.normalized?.automations||0} automations • ${sv.database.audits||0} audits • ${sv.database.telemetry||0} telemetry states`:'Unavailable')
    ].join('');

    diagServices.innerHTML=Object.entries(sv).map(([name,v])=>
      `<div class="card" style="margin-bottom:8px"><b>${esc(name)}</b> <span class="pill">${v?.ok===false?'ISSUE':'OK'}</span><pre class="raw">${esc(JSON.stringify(v,null,2))}</pre></div>`
    ).join('');

    diagSystem.textContent=JSON.stringify(x.system||{},null,2);
    diagVeyon.textContent=JSON.stringify({service:sv.veyon,configuration:x.configuration?.veyon},null,2);
    diagScheduler.textContent=JSON.stringify({
      scheduler:sv.scheduler,
      configuration:x.configuration?.scheduler,
      classes:x.data?.classes,
      automations:x.data?.automations
    },null,2);
    diagErrors.innerHTML=diagnosticRows(x.recent?.errors||[]);
    diagActions.innerHTML=diagnosticRows(x.recent?.actions||[]);
    diagApiLog.innerHTML=diagnosticRows((x.recent?.events||[]).filter(e=>e.kind==='api.request'||e.kind==='api.error'));
    diagRaw.textContent=JSON.stringify(x,null,2);
  }catch(e){
    diagRaw.textContent=e.message;
  }
}
async function loadDiagnosticEvents(errorsOnly){
  try{
    const x=await api(`/api/v1/diagnostics/events?limit=750${errorsOnly?'&errorsOnly=true':''}`);
    if(errorsOnly)diagErrors.innerHTML=diagnosticRows(x.events||[]);
    else diagActions.innerHTML=diagnosticRows((x.events||[]).filter(e=>!['api.request','api.error'].includes(e.kind)));
  }catch(e){alert(e.message)}
}
async function runDiagnosticTest(test){
  diagTestOutput.textContent=`Running ${test} checks…`;
  try{
    const x=await jpost('/api/v1/diagnostics/test',{test});
    diagTestOutput.textContent=JSON.stringify(x,null,2);
    await loadDiagnostics();
  }catch(e){diagTestOutput.textContent=e.message}
}
function downloadDiagnostics(){
  const a=document.createElement('a');
  a.href='/api/v1/diagnostics/export';
  a.download='';
  document.body.appendChild(a);a.click();a.remove();
}
async function sendRawPluto(){try{rawPlutoOut.textContent=JSON.stringify(await jpost('/api/v1/pluto',{action:'raw',body:JSON.parse(rawPluto.value)}),null,2)}catch(e){rawPlutoOut.textContent=e.message}}

renderClassDefaultTargets(['all']);

// -----------------------------------------------------------------------------

// RoomGoblin 1.0 alpha.5 database-native structured configuration
let ADMINCFG=null;
async function loadAdminConfiguration(){
  try{
    const [j,sum,privacy]=await Promise.all([api('/api/v1/admin/config'),api('/api/v1/admin/summary'),api('/api/v1/admin/privacy-retention')]);ADMINCFG=j;
    const site=j.site||{},theme=site.theme||{};cfgSchool.value=site.school||'';cfgRoom.value=site.room||j.devices?.room||'';cfgProductName.value=site.productName||'RoomGoblin';cfgLogoUrl.value=site.logoUrl||'';cfgFaviconUrl.value=site.faviconUrl||'';cfgDisplayPrefix.value=site.displayPrefix||'TV';cfgTimezone.value=site.timezone||'America/New_York';cfgThemeMode.value=theme.mode||'dark';cfgThemePrimary.value=theme.primary||'#2aa866';cfgThemeAccent.value=theme.accent||'#1b7a49';cfgThemeBackground.value=theme.background||'#040705';cfgThemeSurface.value=theme.surface||'#121923';cfgThemeText.value=theme.text||'#eef4f8';applySiteBranding(site);
    renderIntegrationConnections(j.integrationConnections||{});
    privacyHistoryEnabled.checked=privacy.policy?.browserHistoryEnabled===true;privacyHistoryHours.value=privacy.policy?.browserHistoryHours??0;privacyHistoryHours.disabled=!privacyHistoryEnabled.checked;privacyScreenshotDays.value=privacy.policy?.screenshotDays??7;privacyAlertDays.value=privacy.policy?.alertDays??30;privacyAuditDays.value=privacy.policy?.auditDays??180;
    cfgHardware.value=JSON.stringify(j.hardware||{},null,2);
    renderAdminSummary(sum);renderAdminIntegrationCards();
    const d=j.database||{};cfgDatabase.innerHTML=`<div class="grid"><div class="card"><div class="muted">Schema</div><div class="kpi">v${esc(d.schemaVersion||0)}</div></div><div class="card"><div class="muted">Database</div><div class="kpi">${fmtBytes(d.size||0)}</div></div><div class="card"><div class="muted">Audits</div><div class="kpi">${Number(d.audits||0).toLocaleString()}</div></div><div class="card"><div class="muted">Telemetry States</div><div class="kpi">${Number(d.telemetry||0).toLocaleString()}</div></div></div><div class="muted" style="margin-top:8px">SQLite WAL • encrypted secrets ${d.encryptedSecrets?'enabled':'unavailable'} • ${d.objects||0} compatibility objects remaining</div>`;
    await Promise.all([loadAdminSecrets(),loadAdminProfiles(),loadAdminUsers(),loadDisplayCredentialSecurity()]);
  }catch(e){cfgSummary.innerHTML=`<div class="bad">${esc(e.message)}</div>`}
}
async function savePrivacyRetention(){if(!confirm('Apply these retention limits now? Records older than the selected limits will be permanently removed.'))return;try{const body={browserHistoryEnabled:privacyHistoryEnabled.checked,browserHistoryHours:privacyHistoryEnabled.checked?Number(privacyHistoryHours.value):0,screenshotDays:Number(privacyScreenshotDays.value),alertDays:Number(privacyAlertDays.value),auditDays:Number(privacyAuditDays.value),applyNow:true};const j=await api('/api/v1/admin/privacy-retention',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});notify('Student-data retention policy saved and applied.','success');privacyHistoryEnabled.checked=j.policy.browserHistoryEnabled===true;privacyHistoryHours.value=j.policy.browserHistoryHours;privacyHistoryHours.disabled=!privacyHistoryEnabled.checked;privacyScreenshotDays.value=j.policy.screenshotDays;privacyAlertDays.value=j.policy.alertDays;privacyAuditDays.value=j.policy.auditDays}catch(e){notify(e.message,'error')}}
let DISPLAY_CREDENTIAL_STATE=null;
async function loadDisplayCredentialSecurity(){try{const j=await api('/api/v1/admin/display-credentials');DISPLAY_CREDENTIAL_STATE=j;cfgRequireDisplayAuth.checked=j.policy?.authenticationRequired===true;cfgLegacyDisplayToken.checked=j.policy?.legacySharedTokenAllowed!==false;cfgEnrollmentTtl.value=j.policy?.enrollmentTtlMinutes||15;const c=j.coverage||{};cfgDisplayCredentialCoverage.innerHTML=`<span class="pill ${j.policy?.authenticationRequired?'':'ok'}">${j.policy?.authenticationRequired?'Credential authentication REQUIRED':'Stable URL access ON'}</span> <span class="pill ${c.enrolled===c.enabled?'ok':''}">${Number(c.enrolled||0)}/${Number(c.enabled||0)} enabled displays enrolled</span> ${j.policy?.authenticationRequired&&j.policy?.legacySharedTokenAllowed?'<span class="pill">Legacy token fallback ON</span>':''}`;cfgDisplayCredentials.innerHTML=(j.displays||[]).map(d=>{const active=(d.credentials||[]).filter(x=>!x.revokedAt),revoked=(d.credentials||[]).filter(x=>x.revokedAt),pending=d.pending||[];return `<div class="card" style="box-shadow:none;margin:8px 0"><div class="top" style="position:static;box-shadow:none;margin:0"><div><b>${esc(d.name)}</b> <code>${esc(d.id)}</code> ${d.enabled?'<span class="pill">Enabled</span>':'<span class="pill">Disabled</span>'}<div class="muted">${active.length} active credential(s) • ${revoked.length} revoked • ${pending.length} pending link(s)</div></div><div class="toolbar"><button onclick="issueDisplayEnrollment('${esc(d.id)}',false)">Create Link</button><button class="danger" onclick="issueDisplayEnrollment('${esc(d.id)}',true)">Rotate All</button>${pending.length?`<button onclick="cancelDisplayEnrollment('${esc(d.id)}')">Cancel Link</button>`:''}</div></div>${active.map(x=>`<div class="toolbar" style="justify-content:space-between;margin-top:7px"><span class="muted">${esc(x.label||'Classroom display')} • created ${esc(new Date(x.createdAt).toLocaleString())} • last used ${x.lastUsedAt?esc(new Date(x.lastUsedAt).toLocaleString()):'never'}</span><button class="danger" onclick="revokeDisplayCredential('${esc(x.id)}')">Revoke</button></div>`).join('')}</div>`}).join('')||'<div class="muted">No displays are configured.</div>'}catch(e){cfgDisplayCredentials.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
async function issueDisplayEnrollment(id,rotate){if(rotate&&!confirm(`Revoke every credential for ${id} and create a replacement enrollment link? The current display will disconnect.`))return;try{const j=await api(`/api/v1/admin/displays/${encodeURIComponent(id)}/enrollment`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ttlMinutes:Number(cfgEnrollmentTtl.value||15),revokeExisting:rotate})}),absolute=new URL(j.enrollment.url,location.origin).toString();cfgEnrollmentResult.style.display='block';cfgEnrollmentResult.innerHTML=`<b>One-use enrollment link for ${esc(j.enrollment.displayName||id)}</b><div class="muted">Expires ${esc(new Date(j.enrollment.expiresAt).toLocaleString())}. Anyone with this link can enroll this display until it is used or expires.</div><div class="toolbar" style="margin-top:8px"><input id="issuedDisplayEnrollmentUrl" value="${esc(absolute)}" readonly style="flex:1;min-width:260px"><button onclick="copyDisplayEnrollmentUrl()">Copy Link</button></div>`;await loadDisplayCredentialSecurity()}catch(e){notify(e.message,'error')}}
async function copyDisplayEnrollmentUrl(){const value=document.getElementById('issuedDisplayEnrollmentUrl')?.value||'';try{await navigator.clipboard.writeText(value);notify('Enrollment link copied.','success')}catch{prompt('Copy this enrollment link:',value)}}
async function cancelDisplayEnrollment(id){try{await api(`/api/v1/admin/displays/${encodeURIComponent(id)}/enrollment`,{method:'DELETE'});cfgEnrollmentResult.style.display='none';await loadDisplayCredentialSecurity()}catch(e){notify(e.message,'error')}}
async function revokeDisplayCredential(id){if(!confirm('Revoke this display credential? The connected display will be disconnected and need a new enrollment link.'))return;try{await api(`/api/v1/admin/display-credentials/${encodeURIComponent(id)}`,{method:'DELETE'});await loadDisplayCredentialSecurity()}catch(e){notify(e.message,'error')}}
async function saveDisplayCredentialPolicy(){try{const body={authenticationRequired:cfgRequireDisplayAuth.checked,legacySharedTokenAllowed:cfgLegacyDisplayToken.checked,enrollmentTtlMinutes:Number(cfgEnrollmentTtl.value||15)};await api('/api/v1/admin/display-credentials/policy',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});notify('Display access policy saved.','success');await loadDisplayCredentialSecurity()}catch(e){notify(e.message,'error');await loadDisplayCredentialSecurity()}}
function renderIntegrationConnections(value){const m=value.mqtt||{},p=value.pluto||{},v=value.veyon||{};cfgMqttUrl.value=m.url||'';cfgMqttUsername.value=m.username||'';cfgMqttPassword.value='';cfgMqttPassword.placeholder=m.passwordConfigured?'Password stored — leave blank to keep it':'Optional broker password';cfgMqttJsonBridge.checked=m.jsonBridge!==false;cfgMqttLegacyBridge.checked=m.legacyBridge!==false;cfgPlutoUrl.value=p.url||'';cfgPlutoTimeout.value=p.timeoutMs||4000;cfgPlutoRetries.value=p.readRetries??4;cfgVeyonUrl.value=v.url||'http://127.0.0.1:11080';cfgVeyonKeyName.value=v.keyName||'ClassroomControlHub';cfgVeyonSubnet.value=v.scanSubnet||'';cfgVeyonScanStart.value=v.scanStart||1;cfgVeyonScanEnd.value=v.scanEnd||254;cfgVeyonPool.value=v.poolMax||24;cfgVeyonRetries.value=v.authRetries??2;cfgVeyonThumbs.value=v.thumbnailConcurrency||8;cfgVeyonPrivateKey.value='';cfgVeyonPrivateKey.placeholder=v.privateKeyConfigured?'Private key stored — leave blank to keep it':'Paste the Veyon private key PEM'}
async function saveIntegrationConnections(){try{cfgConnectionsMsg.textContent='Validating and applying…';const body={mqtt:{url:cfgMqttUrl.value.trim(),username:cfgMqttUsername.value.trim(),jsonBridge:cfgMqttJsonBridge.checked,legacyBridge:cfgMqttLegacyBridge.checked},pluto:{url:cfgPlutoUrl.value.trim(),timeoutMs:Number(cfgPlutoTimeout.value),readRetries:Number(cfgPlutoRetries.value)},veyon:{url:cfgVeyonUrl.value.trim(),keyName:cfgVeyonKeyName.value.trim(),scanSubnet:cfgVeyonSubnet.value.trim(),scanStart:Number(cfgVeyonScanStart.value),scanEnd:Number(cfgVeyonScanEnd.value),poolMax:Number(cfgVeyonPool.value),authRetries:Number(cfgVeyonRetries.value),thumbnailConcurrency:Number(cfgVeyonThumbs.value)}};if(cfgMqttPassword.value)body.mqtt.password=cfgMqttPassword.value;if(cfgVeyonPrivateKey.value)body.veyon.privateKey=cfgVeyonPrivateKey.value;const j=await api('/api/v1/admin/integration-connections',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});renderIntegrationConnections(j.integrationConnections||{});ADMINCFG.integrationConnections=j.integrationConnections;cfgConnectionsMsg.textContent='Saved in the database and applied live.';notify('Integration connection settings applied.','success');await refreshOverview()}catch(e){cfgConnectionsMsg.textContent=e.message;notify(e.message,'error')}}
function renderAdminSummary(j){const c=j.counts||{},d=j.database||{};cfgSummary.innerHTML=`<div class="card"><div class="muted">TVs</div><div class="kpi">${c.displays||0}</div></div><div class="card"><div class="muted">TV Groups</div><div class="kpi">${c.displayGroups||0}</div></div><div class="card"><div class="muted">Lighting Devices</div><div class="kpi">${c.lightingDevices||0}</div></div><div class="card"><div class="muted">Access Profiles</div><div class="kpi">${c.accessProfiles||0}</div></div><div class="card"><div class="muted">DB Schema</div><div class="kpi">v${d.schemaVersion||0}</div></div>`}
function renderAdminDisplayEditor(){
  const ds=ADMINCFG?.devices?.devices||{},groups=ADMINCFG?.devices?.displayGroups||{};
  cfgDisplayEditor.innerHTML=`<div class="configRow header"><div>ID</div><div>Name</div><div>Enabled</div><div>AV Output</div><div>Lighting</div><div>Tags</div><div></div></div>`+Object.entries(ds).map(([id,d])=>`<div class="configRow" data-display-id="${esc(id)}"><div><code>${esc(id)}</code></div><div><input data-f="name" value="${esc(d.name||id)}"></div><div><select data-f="enabled"><option value="1" ${d.enabled!==false?'selected':''}>Yes</option><option value="0" ${d.enabled===false?'selected':''}>No</option></select></div><div><input data-f="avOutput" type="number" min="1" max="64" value="${esc(d.avOutput??'')}"></div><div><input data-f="lightingAlias" value="${esc(d.lightingAlias||'')}" placeholder="none"></div><div><input data-f="tags" value="${esc((d.tags||[]).join(', '))}"></div><div><button class="danger" onclick="removeAdminDisplay('${esc(id).replace(/'/g,"\'")}')">Remove</button></div></div>`).join('');
  cfgGroupEditor.innerHTML=Object.entries(groups).map(([name,members])=>adminGroupCard(name,members,ds)).join('')||'<div class="muted">No groups configured.</div>';
}
function adminGroupCard(name,members,devices){return `<div class="groupCard" data-group="${esc(name)}"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(name)}</b>${name==='all'?'<span class="pill">Core</span>':`<button class="danger" onclick="removeAdminDisplayGroup('${esc(name).replace(/'/g,"\'")}')">Remove</button>`}</div><div class="checkGrid">${Object.keys(devices).map(id=>`<label class="checkItem"><input type="checkbox" value="${esc(id)}" ${(members||[]).includes(id)?'checked':''}>${esc(id)}</label>`).join('')}</div></div>`}
function collectAdminDisplays(){
  const old=ADMINCFG?.devices?.devices||{},devices={};
  cfgDisplayEditor.querySelectorAll('[data-display-id]').forEach(row=>{const id=row.dataset.displayId,d={...(old[id]||{})};d.name=row.querySelector('[data-f="name"]').value.trim()||id;d.enabled=row.querySelector('[data-f="enabled"]').value==='1';const av=row.querySelector('[data-f="avOutput"]').value;d.avOutput=av===''?null:Number(av);d.lightingAlias=row.querySelector('[data-f="lightingAlias"]').value.trim()||null;d.tags=row.querySelector('[data-f="tags"]').value.split(',').map(x=>x.trim()).filter(Boolean);devices[id]=d});
  const displayGroups={};cfgGroupEditor.querySelectorAll('[data-group]').forEach(card=>{displayGroups[card.dataset.group]=[...card.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value)});
  return {room:ADMINCFG?.devices?.room||cfgRoom.value.trim(),devices,displayGroups,lightingGroups:ADMINCFG?.devices?.lightingGroups||[]};
}
async function saveAdminDisplaysStructured(){try{const v=collectAdminDisplays();const j=await api('/api/v1/admin/displays',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});ADMINCFG.devices={...v,devices:j.devices,displayGroups:j.displayGroups};cfgDisplaysMsg.textContent='Displays and groups validated and saved.';renderAdminDisplayEditor();await loadAdminConfiguration()}catch(e){cfgDisplaysMsg.textContent=e.message}}
function removeAdminDisplay(id){if(!confirm(`Remove display ${id}? Existing schedules referencing it may need review.`))return;delete ADMINCFG.devices.devices[id];for(const g of Object.keys(ADMINCFG.devices.displayGroups||{}))ADMINCFG.devices.displayGroups[g]=(ADMINCFG.devices.displayGroups[g]||[]).filter(x=>x!==id);renderAdminDisplayEditor()}
function addAdminDisplayGroup(){const n=cfgNewGroup.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-');if(!n)return;if(!ADMINCFG.devices.displayGroups)ADMINCFG.devices.displayGroups={};if(ADMINCFG.devices.displayGroups[n])return alert('That group already exists.');ADMINCFG.devices.displayGroups[n]=[];cfgNewGroup.value='';renderAdminDisplayEditor()}
function removeAdminDisplayGroup(name){if(!confirm(`Remove display group ${name}?`))return;delete ADMINCFG.devices.displayGroups[name];renderAdminDisplayEditor()}
function renderAdminIntegrationCards(){const hw=ADMINCFG?.hardware||{},g=hw.govee||{},p=hw.pluto||{};cfgIntegrationCards.innerHTML=`<div class="integrationCard"><div><b>Pluto AV Matrix</b><div class="muted">${esc(p.name||'AV matrix')}</div><div class="integrationState"><span class="pill">${esc(p.host||'Host not configured')}</span><span class="pill">External hardware</span></div></div><button onclick="showPage('av')">Open Displays & AV</button></div><div class="integrationCard"><div><b>Govee Lighting</b><div class="muted">${Object.keys(g.devices||{}).length} devices • ${Object.keys(g.groups||{}).length} groups</div><div class="integrationState"><span class="pill">MQTT-backed</span><span class="pill">Encrypted secrets supported</span></div></div><button onclick="showPage('lights')">Open Lighting</button></div>`}
async function saveAdminSite(){try{const body={school:cfgSchool.value.trim(),room:cfgRoom.value.trim(),productName:cfgProductName.value.trim()||'RoomGoblin',logoUrl:cfgLogoUrl.value.trim(),faviconUrl:cfgFaviconUrl.value.trim(),displayPrefix:cfgDisplayPrefix.value.trim()||'TV',timezone:cfgTimezone.value.trim(),theme:{mode:cfgThemeMode.value,primary:cfgThemePrimary.value,accent:cfgThemeAccent.value,background:cfgThemeBackground.value,surface:cfgThemeSurface.value,text:cfgThemeText.value}};const j=await api('/api/v1/admin/site',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});cfgSiteMsg.textContent=`Saved to database (revision ${j.site.revision}).`;ADMINCFG&&(ADMINCFG.site=j.site);applySiteBranding(j.site||{})}catch(e){cfgSiteMsg.textContent=e.message}}
async function saveAdminHardware(){try{const v=JSON.parse(cfgHardware.value);await api('/api/v1/admin/hardware',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(v)});ADMINCFG.hardware=v;renderAdminIntegrationCards();cfgHardwareMsg.textContent='Hardware configuration validated and saved. Restart RoomGoblin if integration endpoints changed.'}catch(e){cfgHardwareMsg.textContent=e.message}}
function showLogin(){document.body.classList.add('auth-locked');loginOverlay.style.display='flex';setTimeout(()=>loginUser.focus(),50)}
function hideLogin(){document.body.classList.remove('auth-locked');loginOverlay.style.display='none';loginMsg.textContent=''}
const PAGE_CAPABILITIES={overview:['classroom.read'],av:['integrations.control'],lights:['integrations.control'],display:['classroom.control'],presentations:['media.manage'],media:['media.manage'],music:['classroom.control'],lab:['lab.read'],classes:['schedule.manage'],schedules:['schedule.manage','automation.manage'],diagnostics:['diagnostics.read'],settings:['admin'],system:['admin']};
const ACTION_CAPABILITIES={
  admin:['saveAdmin','loadAdmin','createLabAgentEnrollment','saveLabAgentPolicy','revokeLabAgentCredential','loadSystemManagement'],
  media:['presentationControl','startSelectedPresentation','newPresentationFolder','renamePresentation','movePresentation','deletePresentation','rebuildPresentation','showMedia','convertMedia','deleteMedia'],
  automation:['saveAutomation','deleteAutomation','duplicateAutomation','runAutomation','testAutomationEditor','saveMorningWatch','checkMorningWatch'],
  schedule:['saveClassSchedule','deleteClassSchedule','duplicateClassSchedule','saveSchedulerCalendar'],
  integrations:['goveeCmd','plutoAction','route','powerAllAvTvs','drawerTvPower','drawerUpdateRoute','sourceDrawerPower','saveMusicAssistantConfig'],
  classroom:['clearClassroom','overviewTestImage','overviewTvPower','reloadAllDisplays','bgmControl','bgmPlayFavorite','bgmUseFavorite','deleteBgmFavorite','maPlayerCmd','maMute','maSetVolume','musicAssistantTvBridge']
};
function userCan(capability){const u=window.AUTH_STATUS?.user;if(!u)return false;if(capability==='admin')return u.role==='admin';const caps=Array.isArray(u.capabilities)?u.capabilities:[];return caps.includes('*')||caps.includes(capability)}
function actionCapability(code=''){for(const name of ACTION_CAPABILITIES.admin)if(code.includes(name))return 'admin';for(const name of ACTION_CAPABILITIES.media)if(code.includes(name))return 'media.manage';for(const name of ACTION_CAPABILITIES.automation)if(code.includes(name))return 'automation.manage';for(const name of ACTION_CAPABILITIES.schedule)if(code.includes(name))return 'schedule.manage';for(const name of ACTION_CAPABILITIES.integrations)if(code.includes(name))return 'integrations.control';for(const name of ACTION_CAPABILITIES.classroom)if(code.includes(name))return 'classroom.control';return null}
function enforceCapabilityControls(root=document){for(const el of root.querySelectorAll?.('button[onclick],input[onchange],select[onchange]')||[]){const required=actionCapability(el.getAttribute('onclick')||el.getAttribute('onchange')||'');if(!required)continue;const allowed=userCan(required);el.disabled=!allowed;el.setAttribute('aria-disabled',String(!allowed));if(!allowed)el.title=`Permission required: ${required}`}}
const capabilityObserver=new MutationObserver(records=>{if(!window.AUTH_STATUS?.user)return;for(const record of records)for(const node of record.addedNodes)if(node.nodeType===Node.ELEMENT_NODE){if(node.matches?.('button[onclick],input[onchange],select[onchange]'))enforceCapabilityControls(node.parentElement||document);else enforceCapabilityControls(node)}});
capabilityObserver.observe(document.body,{childList:true,subtree:true});
function applyAuthUi(j){window.AUTH_STATUS=j||{};const u=j?.user;if(u){authAccount.style.display='block';authAccountName.textContent=u.displayName||u.username;authAccountRole.textContent=(u.role||'').toUpperCase();accountIdentity.textContent=`${u.displayName||u.username} • ${u.username} • ${u.role}`;for(const [pageId,required] of Object.entries(PAGE_CAPABILITIES)){const allowed=required.every(userCan),page=document.getElementById(pageId),nav=document.querySelector(`nav button[data-page="${pageId}"]`);if(page)page.dataset.authorized=String(allowed);if(nav){nav.hidden=!allowed;nav.setAttribute('aria-hidden',String(!allowed))}}enforceCapabilityControls();const active=document.querySelector('.page.active');if(active?.dataset.authorized==='false'){const first=[...document.querySelectorAll('nav button[data-page]')].find(x=>!x.hidden);if(first)showPage(first.dataset.page)}}else{authAccount.style.display='none'}}
async function performLogin(){try{loginMsg.textContent='';const r=await fetch('/api/v1/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:loginUser.value,password:loginPassword.value,remember:loginRemember.checked})}),j=await r.json();if(!r.ok)throw Error(j.error||'Login failed');loginPassword.value='';await bootstrapController()}catch(e){loginMsg.textContent=e.message}}
async function performLogout(){try{await fetch('/api/v1/auth/logout',{method:'POST',credentials:'same-origin'});}finally{window.AUTH_STATUS={authEnabled:true,user:null};applyAuthUi(window.AUTH_STATUS);showLogin();closeAccountModal();controllerBootstrapped=false;if(window.ws&&typeof window.ws.close==='function')try{window.ws.close()}catch{} }}
async function checkAuthentication(){try{const r=await fetch('/api/v1/auth/status',{cache:'no-store',credentials:'same-origin'}),j=await r.json();window.AUTH_STATUS=j;applyAuthUi(j);if(j.authEnabled&&!j.user){showLogin();return false}hideLogin();return true}catch(e){showLogin();loginMsg.textContent='Unable to verify authentication';return false}}
let accountReturnFocus=null;
function openAccountModal(){accountReturnFocus=document.activeElement;accountModal.style.display='flex';loadMySessions();setTimeout(()=>currentPassword.focus(),0)}
function closeAccountModal(){accountModal.style.display='none';currentPassword.value='';newPassword.value='';confirmPassword.value='';passwordMsg.textContent='';accountReturnFocus?.focus?.()}
async function loadMySessions(){try{const j=await api('/api/v1/auth/sessions');sessionList.innerHTML=(j.sessions||[]).map(x=>`<div class="sessionRow"><div><b>${x.current?'Current session':'Session'}</b><div class="meta">${esc(x.remoteAddr||'')} • ${esc(new Date(x.lastSeenAt||x.createdAt).toLocaleString())}<br>${esc((x.userAgent||'').slice(0,120))}</div></div><div>${x.current?'<span class="pill ok">CURRENT</span>':`<button class="danger" onclick="revokeMySession(${inlineJsArg(x.id)})">Revoke</button>`}</div></div>`).join('')||'<div class="muted">No active sessions.</div>'}catch(e){sessionList.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
async function revokeMySession(id){try{await api('/api/v1/auth/sessions/'+encodeURIComponent(id),{method:'DELETE'});await loadMySessions()}catch(e){alert(e.message)}}
async function logoutOtherSessions(){if(!confirm('Sign out every other RoomGoblin session for this account?'))return;try{const j=await api('/api/v1/auth/logout-others',{method:'POST'});alert(`Signed out ${j.removed||0} other session(s).`);await loadMySessions()}catch(e){alert(e.message)}}
async function changeMyPassword(){passwordMsg.textContent='';if(newPassword.value!==confirmPassword.value){passwordMsg.textContent='New passwords do not match.';return}try{const j=await api('/api/v1/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:currentPassword.value,newPassword:newPassword.value})});passwordMsg.textContent=j.message||'Password changed.';currentPassword.value='';newPassword.value='';confirmPassword.value='';await loadMySessions()}catch(e){passwordMsg.textContent=e.message}}
let controllerBootstrapped=false;
async function bootstrapController(){const ok=await checkAuthentication();if(!ok)return;if(controllerBootstrapped)return;controllerBootstrapped=true;startBrandClock();await loadSiteBranding();refreshOverview();loadClassSchedules()}
async function loadAdminUsers(){try{const [j,pj]=await Promise.all([api('/api/v1/admin/users'),api('/api/v1/admin/access-profiles')]);window.ADMIN_USERS=j;const profiles=(pj.profiles||[]).filter(x=>x.enabled);userProfile.innerHTML=profiles.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');authToggleBtn.textContent='Local Authentication: ON';cfgUsers.innerHTML=`<table><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Access Profile</th><th>Enabled</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>${(j.users||[]).map(x=>`<tr><td>${esc(x.username)}</td><td>${esc(x.displayName)}</td><td><select onchange="updateAdminUser(${inlineJsArg(x.id)},{role:this.value})"><option value="viewer" ${x.role==='viewer'?'selected':''}>Read Only</option><option value="operator" ${x.role==='operator'?'selected':''}>Operator / Teacher</option><option value="admin" ${x.role==='admin'?'selected':''}>Administrator</option></select></td><td><select onchange="updateAdminUser(${inlineJsArg(x.id)},{profileId:this.value})">${profiles.map(p=>`<option value="${esc(p.id)}" ${x.profileId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></td><td><button onclick="updateAdminUser(${inlineJsArg(x.id)},{enabled:${!x.enabled}})">${x.enabled?'Disable':'Enable'}</button></td><td>${x.lastLoginAt?esc(new Date(x.lastLoginAt).toLocaleString()):'Never'}</td><td><button onclick="resetAdminUserPassword(${inlineJsArg(x.id)},${inlineJsArg(x.username)})">Reset Password</button> <button class="danger" onclick="deleteAdminUser(${inlineJsArg(x.id)})">Delete</button></td></tr>`).join('')}</tbody></table>`;authStandardHours.value=j.policy?.standardHours||12;authRememberHours.value=j.policy?.rememberHours||168;authMaxSessions.value=j.policy?.maxSessions||10;cfgAdminSessions.innerHTML=`<table><thead><tr><th>User</th><th>Role</th><th>Last Seen</th><th>Expires</th><th>Address</th><th></th></tr></thead><tbody>${(j.sessions||[]).map(x=>`<tr><td>${esc(x.displayName||x.username)}</td><td>${esc(x.role)}</td><td>${esc(new Date(x.lastSeenAt).toLocaleString())}</td><td>${esc(new Date(x.expiresAt).toLocaleString())}</td><td>${esc(x.remoteAddr||'')}</td><td><button class="danger" onclick="revokeAdminSession(${inlineJsArg(x.id)})">Revoke</button></td></tr>`).join('')}</tbody></table>`}catch(e){cfgUsers.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
async function updateAdminUser(id,changes){try{await api('/api/v1/admin/users/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});notify('User updated.','success');await loadAdminUsers()}catch(e){notify(e.message,'error');await loadAdminUsers()}}
async function resetAdminUserPassword(id,username){const p=prompt(`Enter a new password for ${username} (minimum 10 characters):`);if(p===null)return;try{const j=await api('/api/v1/admin/users/'+encodeURIComponent(id)+'/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p})});notify(j.message||'Password reset.','success');await loadAdminUsers()}catch(e){notify(e.message,'error')}}
async function revokeAdminSession(id){if(!confirm('Revoke this active session?'))return;try{await api('/api/v1/admin/sessions/'+encodeURIComponent(id),{method:'DELETE'});notify('Session revoked.','success');await loadAdminUsers()}catch(e){notify(e.message,'error')}}
async function saveAuthPolicy(){try{await api('/api/v1/admin/auth-policy',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({standardHours:Number(authStandardHours.value),rememberHours:Number(authRememberHours.value),maxSessions:Number(authMaxSessions.value)})});notify('Session policy saved.','success');await loadAdminUsers()}catch(e){notify(e.message,'error')}}
async function saveAdminUser(){try{if(!userUsername.value.trim()||!userPassword.value)throw Error('Username and password are required');await api('/api/v1/admin/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:userUsername.value.trim(),displayName:userDisplayName.value.trim()||userUsername.value.trim(),role:userRole.value,profileId:userProfile.value,password:userPassword.value,enabled:true})});userPassword.value='';userUsername.value='';userDisplayName.value='';notify('User created.','success');await loadAdminUsers()}catch(e){notify(e.message,'error')}}
async function deleteAdminUser(id){if(!confirm('Delete this local user? This action cannot be undone.'))return;try{await api('/api/v1/admin/users/'+encodeURIComponent(id),{method:'DELETE'});notify('User deleted.','success');await loadAdminUsers()}catch(e){notify(e.message,'error')}}
function toggleLocalAuth(){notify('Local authentication is mandatory and cannot be disabled.','info')}
checkAuthentication();
async function loadAdminSecrets(){try{const j=await api('/api/v1/admin/secrets');cfgSecrets.innerHTML=`<table><thead><tr><th>Name</th><th>Purpose</th><th>Updated</th><th></th></tr></thead><tbody>${(j.secrets||[]).map(x=>`<tr><td style="text-align:left"><code>${esc(x.name)}</code></td><td style="text-align:left">${esc(x.metadata?.integration||x.metadata?.type||'Encrypted secret')}</td><td>${esc(new Date(x.updatedAt).toLocaleString())}</td><td><button class="danger" onclick="deleteAdminSecret(${inlineJsArg(x.name)})">Delete</button></td></tr>`).join('')}</tbody></table>`}catch(e){cfgSecrets.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
async function saveAdminSecret(){const name=newSecretName.value.trim(),value=newSecretValue.value;if(!name||!value)return alert('Enter a secret name and value.');try{await api('/api/v1/admin/secrets/'+encodeURIComponent(name),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value,metadata:{managedFrom:'controller'}})});newSecretValue.value='';await loadAdminSecrets()}catch(e){alert(e.message)}}
async function deleteAdminSecret(name){if(!confirm(`Delete encrypted secret ${name}?`))return;try{await api('/api/v1/admin/secrets/'+encodeURIComponent(name),{method:'DELETE'});await loadAdminSecrets()}catch(e){alert(e.message)}}
async function loadAdminProfiles(){try{const j=await api('/api/v1/admin/access-profiles');cfgProfiles.innerHTML=`<table><thead><tr><th style="text-align:left">Profile</th><th>Role</th><th>Enabled</th><th></th></tr></thead><tbody>${(j.profiles||[]).map(x=>`<tr><td style="text-align:left"><b>${esc(x.name)}</b><div class="muted"><code>${esc(x.id)}</code>${x.config?.description?' • '+esc(x.config.description):''}</div></td><td>${esc(x.role)}</td><td>${x.enabled?'Yes':'No'}</td><td><button class="danger" onclick="deleteAdminProfile(${inlineJsArg(x.id)})">Delete</button></td></tr>`).join('')}</tbody></table>`}catch(e){cfgProfiles.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
async function saveAdminProfile(){const id=profileId.value.trim();if(!id)return alert('Enter a profile ID.');try{const capabilities=profileCapabilities.value.split(',').map(x=>x.trim()).filter(Boolean);await api('/api/v1/admin/access-profiles/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:profileName.value.trim()||id,role:profileRole.value,enabled:true,config:{capabilities}})});profileId.value='';profileName.value='';profileCapabilities.value='';await Promise.all([loadAdminProfiles(),loadAdminUsers()])}catch(e){alert(e.message)}}
async function deleteAdminProfile(id){if(['administrator','technician','teacher','read-only'].includes(id)&&!confirm(`This is a default profile. Delete ${id} anyway?`))return;if(!['administrator','technician','teacher','read-only'].includes(id)&&!confirm(`Delete access profile ${id}?`))return;try{await api('/api/v1/admin/access-profiles/'+encodeURIComponent(id),{method:'DELETE'});await loadAdminProfiles()}catch(e){alert(e.message)}}

// RoomGoblin 1.0 System Management
// -----------------------------------------------------------------------------
let fileManagerPath='.';
let AVAILABLE_APP_RELEASE=null,APP_UPDATE_POLL=null;
async function maintApi(path,opt={}){return api('/api/v1/maintenance'+path,opt)}
function fmtBytes(n){n=Number(n||0);if(!n)return '0 B';const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return `${n.toFixed(i?1:0)} ${u[i]}`}
async function loadSystemManagement(){loadHostServices();loadCleanupPlan();
  await Promise.allSettled([loadMaintenanceHealth(),loadHostHealth(),loadApplianceInventory(),loadManagedContainers(),loadManagedModules(),loadManagedBackups(),loadRecoveryRetention(),loadAppUpdates()]);
}
async function loadMaintenanceHealth(){
  try{
    const [h,s]=await Promise.all([maintApi('/health'),maintApi('/system')]);
    maintHealth.innerHTML=`<div class="toolbar"><span class="pill ${h.ok?'ok':'bad'}">Maintenance Agent: ${h.ok?'READY':'ISSUE'}</span><span class="pill">Docker: ${h.docker?'Connected':'Unavailable'}</span><span class="pill">Advanced Shell: ${h.shellEnabled?'Enabled':'Disabled'}</span></div>`;
    maintSystem.textContent=JSON.stringify(s,null,2);
  }catch(e){maintHealth.innerHTML=`<div class="bad"><b>Maintenance Agent unavailable:</b> ${esc(e.message)}</div>`;maintSystem.textContent=e.message}
}

async function loadHostHealth(){const el=document.getElementById('hostHealth');if(!el)return;try{const j=await maintApi('/host/system');const mem=j.memory||{},disk=j.disk||{},temp=j.temperature||{},smart=j.smart||{},updates=j.updates||{};const usedMem=(mem.totalBytes||0)-(mem.availableBytes||0);const pct=(a,b)=>b?Math.round(a*100/b):0;const mp=pct(usedMem,mem.totalBytes),dp=pct(disk.used,disk.total),load=Number((j.loadavg||[])[0]||0),cpu=Number(j.cpuCount||1),t=temp.celsius;let alerts=[];if(dp>=90)alerts.push(['bad','Disk usage is critical']);else if(dp>=80)alerts.push(['warn','Disk usage is high']);if(mp>=90)alerts.push(['bad','Memory pressure is critical']);if(t!=null&&t>=85)alerts.push(['bad','Host temperature is critical']);else if(t!=null&&t>=75)alerts.push(['warn','Host temperature is elevated']);if(smart.healthy===false)alerts.push(['bad','SMART reports a disk-health problem']);if((updates.security||0)>0)alerts.push(['bad',`${updates.security} security update(s) available`]);else if((updates.upgradable||0)>0)alerts.push(['warn',`${updates.upgradable} normal package update(s) available`]);if(load>cpu*1.5)alerts.push(['warn','CPU load is elevated']);const sev=alerts.some(x=>x[0]==='bad')?'ACTION':alerts.length?'ADVISORY':'HEALTHY';el.innerHTML=`<div class="grid"><div class="card"><div class="muted">Overall</div><div class="kpi ${sev==='HEALTHY'?'ok':sev==='ACTION'?'bad':''}">${sev}</div><div class="muted">${alerts.length?alerts.map(x=>esc(x[1])).join(' • '):'No host health conditions require attention.'}</div></div><div class="card"><div class="muted">CPU / Load</div><div class="kpi">${esc(j.cpuCount||'?')} CPU</div><div class="muted">Load ${esc((j.loadavg||[]).map(x=>Number(x).toFixed(2)).join(' / '))}</div></div><div class="card"><div class="muted">Memory</div><div class="kpi ${mp>=90?'bad':''}">${mp}%</div><div class="muted">${fmtBytes(usedMem)} / ${fmtBytes(mem.totalBytes)}</div></div><div class="card"><div class="muted">Root Storage</div><div class="kpi ${dp>=90?'bad':''}">${dp}%</div><div class="muted">${fmtBytes(disk.free)} free</div></div><div class="card"><div class="muted">Temperature</div><div class="kpi ${t>=85?'bad':''}">${t==null?'N/A':Number(t).toFixed(1)+'°C'}</div></div><div class="card"><div class="muted">SMART</div><div class="kpi ${smart.healthy===false?'bad':smart.healthy===true?'ok':''}">${smart.available?(smart.healthy===false?'ISSUE':smart.healthy===true?'HEALTHY':'UNKNOWN'):'N/A'}</div><div class="muted">${(smart.devices||[]).length} device(s)</div></div><div class="card"><div class="muted">Ubuntu Updates</div><div class="kpi ${updates.security>0?'bad':''}">${updates.upgradable==null?'N/A':updates.upgradable}</div><div class="muted">${updates.security||0} security${updates.rebootRequired?' • reboot required':''}</div></div></div>`}catch(e){el.innerHTML=`<div class="bad">Host health unavailable: ${esc(e.message)}</div>`}}

async function loadApplianceInventory(){
  const el=document.getElementById('applianceInventory');if(!el)return;
  try{const j=await maintApi('/appliance/inventory');const rows=j.items||[];el.innerHTML=`<div class="toolbar" style="margin-bottom:10px"><span class="pill">${j.summary?.total||0} containers</span><span class="pill ok">${j.summary?.core||0} core</span><span class="pill">${j.summary?.integrated||0} integrations</span><span class="pill ${j.summary?.review?'bad':''}">${j.summary?.review||0} review</span></div><div class="scroll"><table><thead><tr><th>Container</th><th>Ownership</th><th>Recommendation</th><th>Purpose</th><th>Status</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(x.name)}</b><br><span class="muted">${esc(x.image)}</span></td><td>${esc(x.owner)}</td><td>${esc(x.recommendation)}</td><td>${esc(x.purpose)}</td><td>${esc(x.status)}</td></tr>`).join('')}</tbody></table></div>`}catch(e){el.innerHTML=`<div class="bad">${esc(e.message)}</div>`}
}
async function loadHostServices(){
  const el=document.getElementById('hostServices'),agent=document.getElementById('hostAgentStatus');if(!el)return;
  if(agent){try{const h=await maintApi('/host/agent/health');agent.innerHTML=`<span class="pill ok">Native Host Agent ${esc(h.version||'online')}</span> <span class="muted">local Unix socket • systemd ${h.systemd?'available':'unavailable'}</span>`}catch(e){agent.innerHTML=`<span class="pill bad">Host Agent unavailable</span> ${esc(e.message)}`}}
  try{const j=await maintApi('/host/services');const rows=j.items||[];el.innerHTML=`<div class="toolbar" style="margin-bottom:10px"><span class="pill">${j.summary?.total||0} managed/known</span><span class="pill ok">${j.summary?.running||0} running</span><span class="pill">${j.summary?.integrated||0} integrated</span><span class="pill ${j.summary?.review?'bad':''}">${j.summary?.review||0} review</span></div><table><thead><tr><th>Service</th><th>Ownership</th><th>State</th><th>Purpose</th><th>Actions</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(x.name)}</b><br><span class="muted">${esc(x.description||'')}</span></td><td>${esc(x.owner)}<br><span class="muted">${esc(x.recommendation||'')}</span></td><td><span class="pill ${x.active==='active'?'ok':'bad'}">${esc(x.active)}</span><br><span class="muted">${esc(x.enabled)}</span></td><td>${esc(x.purpose||'')}</td><td><div class="toolbar"><button onclick="hostServiceAction('${esc(x.name)}','restart')">Restart</button><button onclick="hostServiceLogs('${esc(x.name)}')">Logs</button>${x.protected?'':`<button onclick="hostServiceAction('${esc(x.name)}','start')">Start</button><button onclick="hostServiceAction('${esc(x.name)}','stop')">Stop</button><button onclick="hostServiceAction('${esc(x.name)}','enable')">Enable</button><button onclick="hostServiceAction('${esc(x.name)}','disable')">Disable</button>`}</div></td></tr>`).join('')}</tbody></table>`}catch(e){el.innerHTML=`<div class="bad">${esc(e.message)}</div>`}
}
async function hostServiceAction(name,action){const destructive=['stop','disable'].includes(action);if(destructive&&!confirm(`${action} ${name}? This changes the appliance host.`))return;try{const j=await maintApi(`/host/service/${encodeURIComponent(name)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:destructive,now:action==='enable'||action==='disable'})});notify?.(`${name}: ${action} completed`,'ok');await loadHostServices()}catch(e){if(typeof notify==='function')notify(e.message,'bad');else alert(e.message)}}
async function hostServiceLogs(name){try{const j=await maintApi(`/host/service/${encodeURIComponent(name)}/logs?tail=300`);const out=document.getElementById('maintLogOutput');if(out){out.textContent=j.text||'';out.scrollIntoView({behavior:'smooth',block:'center'})}}catch(e){alert(e.message)}}
async function loadCleanupPlan(){const el=document.getElementById('cleanupPlan');if(!el)return;try{const j=await maintApi('/host/cleanup/plan');const backups=j.legacyBackups||[],optional=j.optionalContainers||[],dangling=j.danglingImages||[];const fmt=n=>{n=Number(n||0);if(n>1073741824)return (n/1073741824).toFixed(1)+' GB';if(n>1048576)return (n/1048576).toFixed(1)+' MB';if(n>1024)return (n/1024).toFixed(1)+' KB';return n+' B'};el.innerHTML=`<div class="grid"><div class="card"><div class="muted">Legacy backup trees</div><div class="kpi">${backups.length}</div></div><div class="card"><div class="muted">Dangling images</div><div class="kpi">${dangling.length}</div></div><div class="card"><div class="muted">Optional/redundant containers</div><div class="kpi">${optional.length}</div></div></div><div style="margin-top:12px"><h3>Legacy RoomGoblin Backups</h3>${backups.length?`<table><thead><tr><th>Backup</th><th>Size</th><th>Recommendation</th><th>Safe Actions</th></tr></thead><tbody>${backups.map(x=>`<tr><td><b>${esc((x.path||'').split('/').pop())}</b><br><span class="muted">${esc(x.path||'')}</span></td><td>${fmt(x.size)}</td><td>${esc(x.recommendation||'review')}</td><td><div class="toolbar"><button type="button" data-cleanup-action="archive-backup" data-path="${esc(x.path||'')}">Archive</button><button type="button" class="danger" data-cleanup-action="delete-backup" data-path="${esc(x.path||'')}">Delete</button></div></td></tr>`).join('')}</tbody></table>`:'<div class="muted">No legacy backup trees found.</div>'}</div><div style="margin-top:16px"><h3>Redundant / Optional Containers</h3>${optional.length?`<table><thead><tr><th>Container</th><th>Status</th><th>Dependency Check</th><th>Action</th></tr></thead><tbody>${optional.map(x=>`<tr><td><b>${esc(x.name)}</b><br><span class="muted">${esc(x.image||'')}</span></td><td>${esc(x.status||'')}</td><td><span class="pill ${x.managedByCurrentCompose?'bad':'ok'}">${esc(x.dependencyCheck||'review')}</span></td><td>${x.managedByCurrentCompose?'<span class="muted">Protected by current Compose project</span>':`<button type="button" class="danger" data-cleanup-action="remove-container" data-name="${esc(x.name||'')}">Remove Container</button>`}</td></tr>`).join('')}</tbody></table>`:'<div class="muted">No redundant containers detected.</div>'}</div>${dangling.length?`<details style="margin-top:14px"><summary>Dangling Docker images (${dangling.length})</summary><pre class="raw">${esc(dangling.join('\n'))}</pre></details>`:''}<div class="muted" style="margin-top:10px">${esc(j.note||'')}</div>`}catch(e){el.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
async function cleanupLegacyBackup(path,action){const verb=action==='archive'?'archive':'permanently delete';if(!confirm(`${verb} this legacy backup?\n\n${path}\n\nA fresh operational recovery backup will be created first.`))return;if(action==='delete'&&!confirm('Permanent deletion cannot be undone from the old backup tree. The new safety backup will remain. Continue?'))return;try{notify(`${action==='archive'?'Archiving':'Deleting'} legacy backup…`);const j=await maintApi('/host/cleanup/legacy-backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,action,confirm:action==='archive'?'ARCHIVE':'DELETE'})});notify(`Cleanup completed. Safety backup: ${j.safetyBackup||'created'}`,'success');await loadCleanupPlan();await loadManagedBackups()}catch(e){notify(e.message,'error')}}
async function cleanupOptionalContainer(name){if(!confirm(`Remove ${name} from this RoomGoblin appliance?\n\nRoomGoblin will verify Docker access, create a recovery backup, remove only the container, and preserve named volumes for rollback.`))return;if(!confirm(`Confirm removal of ${name}. Its persistent Docker volumes will NOT be deleted.`))return;try{notify(`Removing ${name}…`);const j=await maintApi('/host/cleanup/container',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,action:'remove',confirm:'REMOVE'})});notify(`${name} removed. Safety backup: ${j.safetyBackup||'created'}`,'success');await loadCleanupPlan();await loadManagedContainers()}catch(e){notify(e.message,'error')}}

// Alpha.25: appliance cleanup uses delegated events instead of embedding data in
// inline JavaScript. This avoids quote/parser failures for paths and container names.
const cleanupPlanEl=document.getElementById('cleanupPlan');
cleanupPlanEl?.addEventListener('click',event=>{
  const button=event.target.closest('button[data-cleanup-action]');
  if(!button||!cleanupPlanEl.contains(button))return;
  const action=button.dataset.cleanupAction;
  if(action==='archive-backup')return cleanupLegacyBackup(button.dataset.path||'','archive');
  if(action==='delete-backup')return cleanupLegacyBackup(button.dataset.path||'','delete');
  if(action==='remove-container')return cleanupOptionalContainer(button.dataset.name||'');
});

async function loadManagedContainers(){
  try{const j=await maintApi('/docker/containers');const rows=j.containers||[];managedContainers.innerHTML=`<table><thead><tr><th>Name</th><th>Image</th><th>Status</th><th>Network</th><th>Ports / listeners</th><th>Actions</th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.Names||c.Name||'')}</td><td>${esc(c.Image||'')}</td><td>${esc(c.Status||c.State||'')}</td><td>${esc(c.Networks||'unknown')}</td><td>${esc(c.Ports||(c.Networks==='host'?'Host listeners (no port mappings)':''))}</td><td><div class="toolbar"><button onclick="managedContainerAction('${esc(c.Names||c.Name)}','restart')">Restart</button><button onclick="managedContainerAction('${esc(c.Names||c.Name)}','stop')">Stop</button><button onclick="managedContainerAction('${esc(c.Names||c.Name)}','start')">Start</button></div></td></tr>`).join('')}</tbody></table>`;maintLogContainer.innerHTML=rows.map(c=>`<option>${esc(c.Names||c.Name||'')}</option>`).join('')}catch(e){managedContainers.innerHTML=`<div class="bad">${esc(e.message)}</div>`}
}
async function managedContainerAction(name,action){if(action==='stop'&&!confirm(`Stop ${name}?`))return;try{await maintApi(`/docker/${encodeURIComponent(name)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await loadManagedContainers()}catch(e){alert(e.message)}}
async function loadManagedLog(){const n=maintLogContainer.value;if(!n)return;try{const j=await maintApi(`/docker/${encodeURIComponent(n)}/logs?tail=${encodeURIComponent(maintLogTail.value)}`);maintLogOutput.textContent=j.text||''}catch(e){maintLogOutput.textContent=e.message}}
function downloadManagedLog(){const n=maintLogContainer.value;if(n)window.open(`/api/v1/maintenance/docker/${encodeURIComponent(n)}/logs?tail=${encodeURIComponent(maintLogTail.value)}&download=1`,'_blank')}
async function runFullOperationsCheck(){operationsCheck.innerHTML='<span class="muted">Running checks…</span>';try{const j=await maintApi('/checks/run');operationsCheck.innerHTML=`<div class="grid" style="margin-top:10px"><div class="card"><div class="muted">Checks</div><div class="kpi ${j.ok?'ok':'bad'}">${j.summary?.passed||0}/${j.summary?.total||0}</div></div><div class="card"><div class="muted">Result</div><div class="kpi ${j.ok?'ok':'bad'}">${j.ok?'HEALTHY':'ISSUES'}</div></div></div><table><thead><tr><th>Check</th><th>Status</th><th>Time</th><th>Details</th></tr></thead><tbody>${(j.checks||[]).map(x=>`<tr><td>${esc(x.name)}</td><td class="${x.ok?'ok':'bad'}">${x.ok?'PASS':'FAIL'}</td><td>${Number(x.ms||0)} ms</td><td style="text-align:left">${esc(x.error||JSON.stringify(x.value??''))}</td></tr>`).join('')}</tbody></table>`}catch(e){operationsCheck.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
function downloadDiagnosticBundle(){window.open('/api/v1/maintenance/diagnostics/bundle','_blank')}
async function loadAuditStatus(){try{const j=await maintApi('/audit/status');auditStatus.innerHTML=`<b>${Number(j.total||0).toLocaleString()}</b> audit records • Oldest: ${j.first?esc(new Date(j.first).toLocaleString()):'none'} • Newest: ${j.last?esc(new Date(j.last).toLocaleString()):'none'} • DB: ${fmtBytes(j.database?.size||0)}`}catch(e){auditStatus.innerHTML=`<span class="bad">${esc(e.message)}</span>`}}
async function pruneAuditHistory(){const days=Number(auditRetentionDays.value||180);if(!confirm(`Permanently remove audit records older than ${days} days? Create a backup first if you need historical retention.`))return;try{const j=await maintApi('/audit/prune',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({days,confirm:true})});alert(`Removed ${Number(j.removed||0).toLocaleString()} audit records.`);await loadAuditStatus()}catch(e){alert(e.message)}}
let HOST_UPDATE_POLL=null;
async function refreshUbuntuUpdates(){const out=document.getElementById('hostUpdateOutput');try{const j=await maintApi('/host/updates');out.style.display='block';out.textContent=JSON.stringify(j,null,2);await loadHostHealth();if(j.job?.running)pollHostUpdateJob()}catch(e){out.style.display='block';out.textContent=e.message}}
async function installUbuntuUpdates(){const out=document.getElementById('hostUpdateOutput');if(!confirm('Install available Ubuntu/third-party package updates on the RoomGoblin appliance? A RoomGoblin operational recovery backup will be created first.'))return;if(!confirm('The native updater will verify dpkg/APT health, then run apt update and apt upgrade. Automatic autoremove is NOT performed. Continue?'))return;out.style.display='block';out.textContent='Creating recovery backup and starting native host update job…';try{const j=await maintApi('/host/updates/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'INSTALL_UPDATES'})});out.textContent=`Safety backup: ${j.safetyBackup||'created'}
Native update job started.`;pollHostUpdateJob()}catch(e){out.textContent=e.message}}
async function pollHostUpdateJob(){clearTimeout(HOST_UPDATE_POLL);const out=document.getElementById('hostUpdateOutput');try{const j=await maintApi('/host/updates/job');out.style.display='block';out.textContent=`Phase: ${j.phase||'unknown'}
${j.message||''}
${j.rebootRequired?'REBOOT REQUIRED AFTER UPDATE\n':''}
${j.log||''}`;if(j.running||['preflight','refreshing','installing','verifying'].includes(j.phase))HOST_UPDATE_POLL=setTimeout(pollHostUpdateJob,2500);else{await loadHostHealth()}}catch(e){out.textContent=e.message}}
async function loadRecoveryRetention(){const el=document.getElementById('recoveryRetention');if(!el)return;try{const [a,m]=await Promise.all([maintApi('/backups/retention'),maintApi('/host/migration-snapshots')]);el.innerHTML=`<b>${a.automatic||0}</b> automatic safety backup(s) using ${fmtBytes(a.automaticBytes||0)} • <b>${m.count||0}</b> installer rollback snapshot(s). Manual recovery backups are protected from automatic retention.`}catch(e){el.innerHTML=`<span class="bad">${esc(e.message)}</span>`}}
async function applyRecoveryRetention(){const keepA=Math.max(2,Number(keepAutoBackups.value||10)),keepM=Math.max(2,Number(keepMigrationSnapshots.value||10));if(!confirm(`Keep the newest ${keepA} automatic safety backups and ${keepM} installer rollback snapshots? Older automatic items will be permanently removed. Manual/full backups are not affected.`))return;try{const [a,m]=await Promise.all([maintApi('/backups/retention',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keep:keepA,confirm:'PRUNE_AUTOMATIC_BACKUPS'})}),maintApi('/host/migration-retention',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keep:keepM,confirm:'PRUNE_MIGRATIONS'})})]);alert(`Retention applied. Removed ${a.removed||0} automatic backup(s) and ${m.removedCount||0} migration snapshot(s).`);await Promise.all([loadRecoveryRetention(),loadManagedBackups()])}catch(e){alert(e.message)}}
async function createManagedBackup(){const scope=backupScope.value,sensitive=scope!=='diagnostic';if(sensitive&&!confirm(scope==='full'?'Full Recovery backups contain private appliance data, credentials, and the encryption master key. Store and share them only as secrets. Create it anyway?':'This recovery backup can contain private appliance data, local device identifiers, student records, or endpoint credentials. Store and share it only as a secret. Create it anyway?'))return;try{const j=await maintApi('/backup/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope,confirmSensitiveData:sensitive,confirmSecrets:scope==='full'})});alert(`Backup created: ${j.name}${j.containsSensitiveData?' (sensitive — protect this file)':''}`);await loadManagedBackups()}catch(e){alert(e.message)}}
function managedBackupRestoreButtons(item){const name=esc(item.name).replace(/'/g,"\\'"),modes=new Set(item.restoreModes||[]);return `${modes.has('configuration')?`<button onclick="restoreManagedBackup('${name}','configuration')">Restore Settings</button>`:''}${modes.has('configuration-data')?`<button class="danger" onclick="restoreManagedBackup('${name}','configuration-data')">Restore Settings + Data</button>`:''}${modes.size?'':'<span class="muted">Inspect only</span>'}`}
async function loadManagedBackups(){try{
  const j=await maintApi('/backups/catalog'),items=j.managed||[];
  let html=(j.migrations?.length?`<div class="muted" style="margin-bottom:8px"><b>${j.migrations.length}</b> installer rollback snapshot(s) detected under /opt/classroom-control-hub-backups. They are preserved separately from managed ZIP backups.</div>`:'');
  html+=`<table><thead><tr><th>Backup</th><th>Classification</th><th>Size</th><th>Created</th><th>Actions</th></tr></thead><tbody>${items.map(x=>`<tr><td style="text-align:left">${esc(x.name)}</td><td><span class="pill ${x.containsSensitiveData?'bad':'ok'}">${x.containsSensitiveData?'Sensitive recovery data':'Support-safe diagnostic'}</span></td><td>${fmtBytes(x.size)}</td><td>${esc(new Date(x.modifiedAt).toLocaleString())}</td><td><div class="toolbar"><button onclick="inspectManagedBackup('${esc(x.name).replace(/'/g,"\\'")}')">Inspect</button><button onclick="restorePlanManagedBackup('${esc(x.name).replace(/'/g,"\\'")}')">Restore Plan</button>${managedBackupRestoreButtons(x)}<button onclick="downloadManagedBackup('${esc(x.name).replace(/'/g,"\\'")}',${x.containsSensitiveData===true})">Download</button><button class="danger" onclick="deleteManagedBackup('${esc(x.name).replace(/'/g,"\\'")}')">Delete</button></div></td></tr>`).join('')}</tbody></table>`;
  if(j.migrations?.length)html+=`<details style="margin-top:10px"><summary>Installer rollback snapshots (${j.migrations.length})</summary><table><tbody>${j.migrations.map(x=>`<tr><td style="text-align:left">${esc(x.name)}</td><td>${esc(new Date(x.modifiedAt).toLocaleString())}</td><td class="muted">Host-level migration rollback snapshot</td></tr>`).join('')}</tbody></table></details>`;
  managedBackups.innerHTML=html;
}catch(e){managedBackups.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
async function restorePlanManagedBackup(name){try{const j=await maintApi(`/backup/${encodeURIComponent(name)}/restore-plan`);maintenanceOutput.textContent=JSON.stringify(j,null,2);maintenanceOutput.scrollIntoView({behavior:'smooth',block:'center'})}catch(e){alert(e.message)}}
function downloadManagedBackup(name,sensitive){if(sensitive&&!confirm('This backup contains sensitive recovery data. Keep it encrypted at rest and do not attach it to support tickets. Download anyway?'))return;window.open(`/api/v1/maintenance/backup/${encodeURIComponent(name)}`,'_blank')}
async function restoreManagedBackup(name,mode){const label=mode==='configuration'?'database-backed settings':'settings and operational data';if(!confirm(`Restore ${label} from ${name}? A new safety backup will be created automatically first.`))return;if(!confirm('This can overwrite current settings and may restart RoomGoblin. Continue?'))return;try{maintenanceOutput.textContent='Restoring backup…';const j=await maintApi(`/backup/${encodeURIComponent(name)}/restore`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode,confirm:'RESTORE'})});maintenanceOutput.textContent=JSON.stringify(j,null,2);alert(`Restore completed. Safety backup: ${j.safetyBackup||'created'}`);setTimeout(()=>location.reload(),2500)}catch(e){maintenanceOutput.textContent=e.message;alert(e.message)}}
async function inspectManagedBackup(name){try{const j=await maintApi(`/backup/${encodeURIComponent(name)}/inspect`);maintenanceOutput.textContent=JSON.stringify(j,null,2);document.getElementById('maintenanceOutput').scrollIntoView({behavior:'smooth',block:'center'})}catch(e){alert(e.message)}}
async function deleteManagedBackup(name){if(!confirm(`Delete backup ${name}?`))return;try{await maintApi(`/backup/${encodeURIComponent(name)}`,{method:'DELETE'});await loadManagedBackups()}catch(e){alert(e.message)}}
async function runMaintenancePreset(preset){try{const j=await maintApi('/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preset})});maintenanceOutput.textContent=j.output||JSON.stringify(j,null,2)}catch(e){maintenanceOutput.textContent=e.message}}
function renderAppUpdateHistory(history=[]){appUpdateHistory.innerHTML=history.length?`<table><thead><tr><th>Time</th><th>Action</th><th>Result</th><th>Version</th><th>Recovery</th></tr></thead><tbody>${history.slice(0,20).map(x=>`<tr><td>${esc(x.at?new Date(x.at).toLocaleString():'')}</td><td>${esc(x.action||'update')}</td><td><span class="pill ${x.ok===true?'ok':x.ok===false?'bad':''}">${esc(x.phase||'')}</span><br><span class="muted">${esc(x.message||'')}</span></td><td>${esc(x.activeVersion||x.targetRef||'')}</td><td>${esc(x.rollback===true?'Rolled back':x.backupName||'')}</td></tr>`).join('')}</tbody></table>`:'<div class="muted">No application update history yet.</div>'}
async function loadAppUpdates(){try{const [settings,job]=await Promise.all([api('/api/v1/admin/app-updates/settings'),api('/api/v1/admin/app-updates/job').catch(e=>({ok:false,error:e.message,history:[]}))]);const p=settings.settings||{};appUpdateRepository.value=p.repository||'';appUpdateChannel.value=p.channel||'alpha';appUpdateInterval.value=p.checkIntervalHours||24;appUpdateStart.value=p.maintenanceStart||'02:00';appUpdateEnd.value=p.maintenanceEnd||'04:00';appUpdateAutomatic.checked=!!p.automatic;appUpdateToken.placeholder=settings.tokenConfigured?'Token stored — leave blank to keep it':'Optional for public repositories';renderAppUpdateHistory(job.history||settings.history||[]);revertAppUpdateBtn.disabled=job.revertAvailable!==true||job.running;updateOutput.textContent=job.error?job.error:`Current: ${settings.currentVersion}\nPhase: ${job.phase||'idle'}\n${job.message||''}${job.targetRef?`\nTarget: ${job.targetRef}`:''}${job.backupName?`\nRecovery backup: ${job.backupName}`:''}`;if(job.running)pollAppUpdateJob()}catch(e){updateOutput.textContent=e.message}}
function clearSelectedAppRelease(){AVAILABLE_APP_RELEASE=null;if(window.installAppUpdateBtn)installAppUpdateBtn.disabled=true}
async function saveAppUpdateSettings(){clearSelectedAppRelease();try{const body={repository:appUpdateRepository.value.trim(),channel:appUpdateChannel.value,automatic:appUpdateAutomatic.checked,checkIntervalHours:Number(appUpdateInterval.value||24),maintenanceStart:appUpdateStart.value,maintenanceEnd:appUpdateEnd.value};if(appUpdateToken.value)body.token=appUpdateToken.value;const j=await api('/api/v1/admin/app-updates/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});appUpdateToken.value='';appUpdateToken.placeholder=j.tokenConfigured?'Token stored — leave blank to keep it':'Optional for public repositories';notify('Application update settings saved. Check GitHub again before installing.','success')}catch(e){notify(e.message,'error')}}
async function clearAppUpdateToken(){if(!confirm('Remove the stored GitHub read token? Public repository updates will continue to work.'))return;try{const j=await api('/api/v1/admin/app-updates/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({repository:appUpdateRepository.value.trim(),channel:appUpdateChannel.value,automatic:appUpdateAutomatic.checked,checkIntervalHours:Number(appUpdateInterval.value||24),maintenanceStart:appUpdateStart.value,maintenanceEnd:appUpdateEnd.value,clearToken:true})});appUpdateToken.value='';appUpdateToken.placeholder=j.tokenConfigured?'Token stored — leave blank to keep it':'Optional for public repositories';notify('Stored GitHub token removed.','success')}catch(e){notify(e.message,'error')}}
async function checkAppUpdate(){updateOutput.textContent='Checking GitHub releases…';installAppUpdateBtn.disabled=true;try{const j=await api('/api/v1/admin/app-updates/check',{method:'POST'});AVAILABLE_APP_RELEASE=j.available||null;installAppUpdateBtn.disabled=!AVAILABLE_APP_RELEASE;updateOutput.textContent=AVAILABLE_APP_RELEASE?`Update available: ${AVAILABLE_APP_RELEASE.version}\nTag: ${AVAILABLE_APP_RELEASE.tag}\nPublished: ${AVAILABLE_APP_RELEASE.publishedAt?new Date(AVAILABLE_APP_RELEASE.publishedAt).toLocaleString():'unknown'}\n${AVAILABLE_APP_RELEASE.name||''}`:`No newer approved ${j.channel} release is available.\nCurrent: ${j.currentVersion}${j.latest?`\nLatest channel release: ${j.latest.version}`:''}`}catch(e){updateOutput.textContent=e.message}}
async function installAppUpdate(){if(!AVAILABLE_APP_RELEASE)return;if(!confirm(`Install ${AVAILABLE_APP_RELEASE.version} from GitHub? A recovery backup will be created before source or containers change.`))return;if(!confirm('The controller will disconnect while images rebuild. Failed health verification will automatically restore the previous release. Continue?'))return;try{const j=await api('/api/v1/admin/app-updates/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag:AVAILABLE_APP_RELEASE.tag})});updateOutput.textContent=`Update job started.\nRecovery backup: ${j.safetyBackup||'creating'}\nThe page will keep checking progress.`;installAppUpdateBtn.disabled=true;pollAppUpdateJob()}catch(e){updateOutput.textContent=e.message}}
async function revertAppUpdate(){if(!confirm('Revert to the previous application release and restore its matching pre-upgrade configuration/database backup?'))return;if(!confirm('This will replace the current release and restart the appliance. Continue with rollback?'))return;try{const j=await api('/api/v1/admin/app-updates/revert',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'REVERT_RELEASE'})});updateOutput.textContent=`Rollback job started.\nCurrent-state safety backup: ${j.safetyBackup||'creating'}`;pollAppUpdateJob()}catch(e){updateOutput.textContent=e.message}}
async function pollAppUpdateJob(){clearTimeout(APP_UPDATE_POLL);try{const j=await api('/api/v1/admin/app-updates/job');renderAppUpdateHistory(j.history||[]);updateOutput.textContent=`Phase: ${j.phase||'unknown'}\n${j.message||''}${j.targetRef?`\nTarget: ${j.targetRef}`:''}${j.backupName?`\nRecovery backup: ${j.backupName}`:''}${j.log?`\n\n${j.log.slice(-8000)}`:''}`;revertAppUpdateBtn.disabled=j.revertAvailable!==true||j.running;if(j.running){APP_UPDATE_POLL=setTimeout(pollAppUpdateJob,3000)}else if(j.phase==='completed'||j.phase==='rolled-back'){setTimeout(()=>location.reload(),2500)}}catch(e){updateOutput.textContent=e.message;APP_UPDATE_POLL=setTimeout(pollAppUpdateJob,5000)}}


let MA_PLAYERS=[],MA_SELECTED_PLAYER='',BGM_FAVORITES=[],BGM_SCHEDULE={};
const BGM_DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
async function maApi(command,args={}){const r=await api('/api/v1/music-assistant/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,args})});return r.result}
function renderBgmDays(selected=[1,2,3,4,5]){const set=new Set((selected||[]).map(Number));bgmDays.innerHTML=BGM_DAY_NAMES.map((n,i)=>`<label class="pill"><input type="checkbox" class="bgmDay" value="${i}" ${set.has(i)?'checked':''}> ${n}</label>`).join('')}
function renderBgmFavorites(){
  bgmFavorite.innerHTML='<option value="">Select a saved favorite…</option>'+BGM_FAVORITES.map(f=>`<option value="${esc(f.id)}" ${String(BGM_SCHEDULE.favoriteId||'')===String(f.id)?'selected':''}>${esc(f.name)}</option>`).join('');
  bgmFavorites.innerHTML=BGM_FAVORITES.length?BGM_FAVORITES.map(f=>`<div class="card" style="box-shadow:none;margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${esc(f.name)}</b><div class="muted">${esc(f.detail||'')}</div><div class="muted" style="font-size:11px">${esc(f.uri)}</div></div><div class="toolbar"><button class="primary" onclick="bgmPlayFavorite(${inlineJsArg(f.id)})">Play</button><button onclick="bgmUseFavorite(${inlineJsArg(f.id)})">Use for Schedule</button><button class="danger" onclick="deleteBgmFavorite(${inlineJsArg(f.id)})">Remove</button></div></div></div>`).join(''):'<div class="muted">No favorites saved yet. Search Music Assistant below and choose Save Favorite.</div>';
  enforceCapabilityControls(bgmFavorites);
}
function renderBgmSchedule(bg){
  BGM_SCHEDULE=bg.schedule||{};BGM_FAVORITES=bg.favorites||[];
  bgmEnabled.value=BGM_SCHEDULE.enabled?'1':'0';bgmStart.value=BGM_SCHEDULE.startTime||'07:00';bgmEnd.value=BGM_SCHEDULE.endTime||'15:00';bgmVolume.value=String(BGM_SCHEDULE.volume??20);bgmSchoolDays.checked=BGM_SCHEDULE.schoolDaysOnly!==false;bgmPausePriority.checked=BGM_SCHEDULE.pauseForPriorityAudio!==false;renderBgmDays(BGM_SCHEDULE.days||[1,2,3,4,5]);
  bgmPlayer.innerHTML='<option value="">Select player…</option>'+MA_PLAYERS.map(p=>{const id=p.player_id||p.playerId||p.id||'',name=p.display_name||p.name||id;return `<option value="${esc(id)}" ${String(BGM_SCHEDULE.playerId||'')===String(id)?'selected':''}>${esc(name)}</option>`}).join('');
  if(BGM_SCHEDULE.playerId)MA_SELECTED_PLAYER=BGM_SCHEDULE.playerId;renderBgmFavorites();
  const r=bg.runtime||{},pr=r.priority||{};const state=r.pausedForPriority?'PAUSED FOR AUTOMATION AUDIO':r.playing?'PLAYING':r.paused?'PAUSED':r.scheduleActive?'SCHEDULE ACTIVE':'IDLE';bgmRuntime.innerHTML=`<span class="pill ${r.playing?'ok':r.lastError?'bad':''}">${esc(state)}</span> ${pr.active?`<span class="pill">Audio priority: ${esc((pr.targets||[]).join(', '))}</span>`:''} ${r.lastActionAt?`<span class="muted">Last action ${esc(new Date(r.lastActionAt).toLocaleTimeString())}</span>`:''} ${r.lastError?`<span class="bad">${esc(r.lastError)}</span>`:''}`;
}
async function loadMusicAssistant(){try{const [j,d,bg]=await Promise.all([api('/api/v1/music-assistant/status'),api('/api/v1/devices'),api('/api/v1/music-assistant/background')]);maUrl.value=j.url||'http://127.0.0.1:8095';maStatus.innerHTML=`<span class="pill ${j.online?'ok':'bad'}">${j.online?'ONLINE':j.configured?'OFFLINE':'SETUP REQUIRED'}</span> <span class="muted">${esc(j.transport||'Music Assistant')} • API ${esc(j.apiTransport||'connecting')}</span> ${j.error?`<span class="muted">${esc(j.error)}</span>`:''}`;MA_PLAYERS=j.players||[];renderBgmSchedule(bg);renderMaPlayers();const sts=d.status||{},attached=new Set(j.attachedTargets||[]),bs=j.bridgeStatus||{};maTvTargets.innerHTML=Object.entries(sts).filter(([id,v])=>v?.online).map(([id,v])=>{const m=bs[id]||{},state=attached.has(id)?(m.state||'waiting'):'detached',cls=['registered','playing'].includes(state)||m.registered===true?'ok':['error','protocol-timeout'].includes(state)?'bad':'';return `<label class="pill ${cls}" title="${esc(m.clientId||m.error||'')}"><input type="checkbox" class="maTvTarget" value="${esc(id)}" ${attached.has(id)?'checked':''}> ${esc(id.toUpperCase())} • ${esc(state)}${m.isPlaying?' • PLAYING':''}</label>`}).join('')||'<span class="muted">No online RoomGoblin displays.</span>'}catch(e){maStatus.innerHTML=`<span class="bad">${esc(e.message)}</span>`}}
function renderMaPlayers(){maPlayers.innerHTML=MA_PLAYERS.map(p=>{const id=String(p.player_id||p.playerId||p.id||''),name=p.display_name||p.name||id,state=p.state||p.playback_state||'unknown',vol=p.volume_level??p.volumeLevel??'',available=p.available!==false,muted=!!(p.volume_muted??p.muted),arg=inlineJsArg(id);return `<div class="card" style="box-shadow:none;margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:10px"><label><input type="radio" name="maPlayer" value="${esc(id)}" ${MA_SELECTED_PLAYER===id?'checked':''} onchange="MA_SELECTED_PLAYER=this.value;bgmPlayer.value=this.value"> <b>${esc(name)}</b><div class="muted">${esc(state)} • ${available?'available':'unavailable'}</div></label><div class="toolbar"><button onclick="maPlayerCmd(${arg},'players/cmd/play_pause')">Play/Pause</button><button onclick="maPlayerCmd(${arg},'players/cmd/stop')">Stop</button><button onclick="maMute(${arg},${muted?'false':'true'})">${muted?'Unmute':'Mute'}</button><label class="muted">Volume <input aria-label="Volume for ${esc(name)}" type="number" min="0" max="100" value="${esc(vol)}" style="width:74px" onchange="maSetVolume(${arg},this.value)"></label></div></div></div>`}).join('')||'<div class="muted">No Music Assistant players found. Attach the TV audio bridge or configure another player in Music Assistant.</div>';enforceCapabilityControls(maPlayers)}
async function saveBackgroundMusicSchedule(){try{const body={enabled:bgmEnabled.value==='1',startTime:bgmStart.value,endTime:bgmEnd.value,days:[...document.querySelectorAll('.bgmDay:checked')].map(x=>Number(x.value)),schoolDaysOnly:bgmSchoolDays.checked,playerId:bgmPlayer.value,favoriteId:bgmFavorite.value,volume:Number(bgmVolume.value),pauseForPriorityAudio:bgmPausePriority.checked};await api('/api/v1/music-assistant/background/schedule',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});bgmSaveMsg.textContent='Saved';setTimeout(()=>bgmSaveMsg.textContent='',1800);await loadMusicAssistant()}catch(e){bgmSaveMsg.textContent=e.message}}
async function bgmControl(action){try{await api('/api/v1/music-assistant/background/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,playerId:bgmPlayer.value,favoriteId:bgmFavorite.value})});setTimeout(loadMusicAssistant,500)}catch(e){alert(e.message)}}
async function bgmPlayFavorite(id){bgmFavorite.value=id;try{await api('/api/v1/music-assistant/background/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'play',playerId:bgmPlayer.value||BGM_SCHEDULE.playerId,favoriteId:id})});setTimeout(loadMusicAssistant,700)}catch(e){alert(e.message)}}
function bgmUseFavorite(id){bgmFavorite.value=id;BGM_SCHEDULE.favoriteId=id;renderBgmFavorites()}
async function deleteBgmFavorite(id){if(!confirm('Remove this Background Music favorite?'))return;try{await api('/api/v1/music-assistant/background/favorites/'+encodeURIComponent(id),{method:'DELETE'});await loadMusicAssistant()}catch(e){alert(e.message)}}
async function saveBgmFavorite(uri,name,detail){try{await api('/api/v1/music-assistant/background/favorites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uri,name,detail})});await loadMusicAssistant()}catch(e){alert(e.message)}}
async function saveMusicAssistantConfig(){try{await api('/api/v1/music-assistant/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:maUrl.value.trim(),token:maToken.value||undefined,tvBridgeEnabled:true})});maToken.value='';await loadMusicAssistant()}catch(e){alert(e.message)}}
function openMusicAssistantUi(){try{const u=new URL((maUrl.value||'http://127.0.0.1:8095').trim());if(!['http:','https:'].includes(u.protocol))throw Error('HTTP(S) URL required');if(['127.0.0.1','localhost','host.docker.internal','0.0.0.0','[::1]'].includes(u.hostname))u.hostname=location.hostname;window.open(u.href,'_blank','noopener,noreferrer')}catch(e){notify(e.message,'error')}}
async function musicAssistantTvBridge(action){const targets=[...document.querySelectorAll('.maTvTarget:checked')].map(x=>x.value);if(!targets.length)return alert('Select at least one online TV/display.');try{const j=await api('/api/v1/music-assistant/tv-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,targets})});alert(`${action==='attach'?'Attached':'Detached'} ${j.deliveries?.length||targets.length} display(s).`);setTimeout(loadMusicAssistant,2500)}catch(e){alert(e.message)}}
async function maPlayerCmd(playerId,command){try{await maApi(command,{player_id:playerId});setTimeout(loadMusicAssistant,700)}catch(e){alert(e.message)}}
async function maMute(playerId,muted){try{await maApi('players/cmd/volume_mute',{player_id:playerId,muted:!!muted});setTimeout(loadMusicAssistant,400)}catch(e){alert(e.message)}}
async function maSetVolume(playerId,value){try{await maApi('players/cmd/volume_set',{player_id:playerId,volume_level:Math.max(0,Math.min(100,Number(value)||0))});setTimeout(loadMusicAssistant,400)}catch(e){alert(e.message)}}
async function searchMusicAssistant(){const q=maSearch.value.trim();if(q.length<2)return;maSearchResults.textContent='Searching…';try{const r=await maApi('music/search',{search_query:q,media_types:['track','album','artist','playlist','radio'],limit:12});const rows=[];for(const [kind,list] of Object.entries(r||{})){if(!Array.isArray(list))continue;for(const x of list.slice(0,12)){const uri=x.uri||'',name=x.name||x.sort_name||uri;if(!uri)continue;const artist=Array.isArray(x.artists)?x.artists.map(a=>a.name).filter(Boolean).join(', '):(x.artist?.name||''),album=x.album?.name||'',detail=[kind.replace(/s$/,''),artist,album].filter(Boolean).join(' • ');rows.push(`<div class="card" style="box-shadow:none;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:12px"><div><b>${esc(name)}</b><div class="muted">${esc(detail)}</div><div class="muted" style="font-size:11px">${esc(uri)}</div></div><div class="toolbar"><button data-bgm-play="${esc(uri)}">Play</button><button class="primary" data-bgm-save="${esc(uri)}" data-bgm-name="${esc(name)}" data-bgm-detail="${esc(detail)}">Save Favorite</button></div></div>`)}}maSearchResults.innerHTML=rows.join('')||'<div class="muted">No results.</div>';maSearchResults.querySelectorAll('[data-bgm-play]').forEach(b=>b.addEventListener('click',()=>playMaUri(b.dataset.bgmPlay)));maSearchResults.querySelectorAll('[data-bgm-save]').forEach(b=>b.addEventListener('click',()=>saveBgmFavorite(b.dataset.bgmSave,b.dataset.bgmName,b.dataset.bgmDetail)))}catch(e){maSearchResults.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
async function playMaUri(uri){const pid=bgmPlayer.value||MA_SELECTED_PLAYER;if(!pid)return alert('Select a Music Assistant player first.');try{await maApi('player_queues/play_media',{queue_id:pid,media:uri});setTimeout(loadMusicAssistant,900)}catch(e){alert(e.message)}}
maSearch?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchMusicAssistant()}});
const MODULE_FIELDS={
  mosquitto:[
    {key:'port',label:'MQTT Port',type:'number',default:'1883',help:'TCP port published on the RoomGoblin host.'},
    {key:'username',label:'MQTT Username',type:'text',default:'classroom-hub'},
    {key:'password',label:'MQTT Password',type:'password',default:'',secret:true,help:'Required; at least 16 characters. Stored encrypted in the database.'}
  ],
  govee2mqtt:[
    {key:'apiKey',label:'Govee API Key',type:'password',default:'',secret:true},
    {key:'email',label:'Account Email (optional)',type:'text',default:''},
    {key:'password',label:'Account Password (optional)',type:'password',default:'',secret:true,help:'Leave blank/masked to keep the existing encrypted value.'},
    {key:'mqttHost',label:'MQTT Host',type:'text',default:'127.0.0.1'},
    {key:'mqttPort',label:'MQTT Port',type:'number',default:'1883'},
    {key:'mqttUsername',label:'MQTT Username',type:'text',default:'classroom-hub'},
    {key:'mqttPassword',label:'MQTT Password',type:'password',default:'',secret:true},
    {key:'lanBroadcast',label:'LAN Discovery',type:'checkbox',default:true},
    {key:'temperatureScale',label:'Temperature Scale',type:'select',options:['F','C'],default:'F'},
    {key:'timezone',label:'Timezone',type:'text',default:'America/New_York'}
  ],
  nodered:[
    {key:'port',label:'Web Port',type:'number',default:'1880'},
    {key:'credentialSecret',label:'Credential Secret',type:'password',default:'',secret:true},
    {key:'timezone',label:'Timezone',type:'text',default:'America/New_York'}
  ]
};
function moduleFieldHtml(id,f,cfg){
  let v=(cfg?.[f.key]!==undefined?cfg[f.key]:f.default);
  const name=`module-${id}-${f.key}`;
  if(f.type==='checkbox')return `<label style="display:flex;gap:8px;align-items:center"><input id="${name}" data-module-field="${esc(f.key)}" type="checkbox" ${v!==false&&String(v)!=='false'?'checked':''}> <span><b>${esc(f.label)}</b>${f.help?`<div class="muted">${esc(f.help)}</div>`:''}</span></label>`;
  if(f.type==='select')return `<label><b>${esc(f.label)}</b><select id="${name}" data-module-field="${esc(f.key)}" style="width:100%;margin-top:4px">${(f.options||[]).map(o=>`<option ${String(o)===String(v)?'selected':''}>${esc(o)}</option>`).join('')}</select>${f.help?`<div class="muted">${esc(f.help)}</div>`:''}</label>`;
  return `<label><b>${esc(f.label)}</b><input id="${name}" data-module-field="${esc(f.key)}" type="${f.type||'text'}" value="${esc(v??'')}" placeholder="${esc(f.default??'')}" style="width:100%;margin-top:4px">${f.help?`<div class="muted">${esc(f.help)}</div>`:''}</label>`;
}
function collectManagedModuleSettings(id){const box=document.getElementById(`module-editor-${id}`),out={};for(const el of box?.querySelectorAll('[data-module-field]')||[]){const k=el.dataset.moduleField;out[k]=el.type==='checkbox'?el.checked:el.value}return out}
async function loadManagedModules(){
  try{
    const j=await maintApi('/modules');
    const modules=j.modules||[];
    const configs={};
    await Promise.all(modules.map(async m=>{try{configs[m.id]=(await maintApi(`/modules/${encodeURIComponent(m.id)}/config`)).config||{}}catch{configs[m.id]={}}}));
    managedModules.innerHTML=modules.map(m=>{
      const fields=MODULE_FIELDS[m.id]||[],cfg=configs[m.id]||{};
      const label={managed:'Managed',adopted:'Adopted Existing',external:'External', 'not-installed':'Not Installed'}[m.management]||m.management;
      const actions=m.state==='not-installed'?(m.canDeploy?`<button class="primary" onclick="deployManagedModule('${esc(m.id)}',false)">Install</button>`:''):(m.externalOnly?`<span class="pill">Monitor Only</span>`:`<button class="primary" onclick="deployManagedModule('${esc(m.id)}',true)">Save & Recreate</button>${m.configured?'':`<button onclick="adoptManagedModule('${esc(m.id)}')">Adopt</button>`}<button class="danger" onclick="removeManagedModule('${esc(m.id)}')">Remove</button>`);
      return `<div class="card" style="box-shadow:none;margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start"><div><b>${esc(m.name)}</b><div class="muted">${esc(m.description||'')}</div><div class="muted">Container: ${esc(m.container)} • Image: ${esc(m.image)}</div><div style="margin-top:6px"><span class="pill ${m.state==='running'?'ok':''}">${esc(m.state)}</span> <span class="pill">${esc(label)}</span>${m.networkMode?` <span class="pill">Network: ${esc(m.networkMode)}</span>`:''}${m.composeProject?` <span class="pill">Compose: ${esc(m.composeProject)}</span>`:''}${m.networkMigrationRequired?'<div class="muted">Host-network migration required. Adoption does not change networking. Back up settings and verify persistent mounts before Save &amp; Recreate; externally owned Compose files must also be updated.</div>':''}</div></div><div class="toolbar">${actions}</div></div>${m.externalOnly?'':`<details style="margin-top:10px" ${m.configured?'open':''}><summary>Configuration</summary><div id="module-editor-${esc(m.id)}" class="grid2" style="margin-top:10px">${fields.map(f=>moduleFieldHtml(m.id,f,cfg)).join('')||'<div class="muted">No configurable settings.</div>'}</div><div class="muted" style="margin-top:8px">Secret fields are encrypted in the RoomGoblin database. A masked value is preserved unless replaced.</div></details>`}</div>`
    }).join('')||'<div class="muted">No managed integrations available.</div>';
  }catch(e){managedModules.innerHTML=`<div class="bad">${esc(e.message)}</div>`}
}
async function deployManagedModule(id,recreate=true){if(recreate&&!confirm('Recreate this integration using host networking? This interrupts the service. Verify its persistent mounts, saved configuration, and host ports first.'))return;try{const settings=collectManagedModuleSettings(id);const j=await maintApi(`/modules/${encodeURIComponent(id)}/deploy`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings,recreate})});alert(j.message||`${id} deployment completed.`);await Promise.all([loadManagedModules(),loadManagedContainers()])}catch(e){alert(e.message)}}
async function adoptManagedModule(id){try{const settings=collectManagedModuleSettings(id);const j=await maintApi(`/modules/${encodeURIComponent(id)}/deploy`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings,recreate:false})});alert(j.message||`${id} adopted.`);await loadManagedModules()}catch(e){alert(e.message)}}
async function removeManagedModule(id){if(!confirm(`Remove the ${id} container? Persistent data directories are not deleted.`))return;try{await maintApi(`/modules/${encodeURIComponent(id)}/remove`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await Promise.all([loadManagedModules(),loadManagedContainers()])}catch(e){alert(e.message)}}
async function loadManagedEnv(){try{const j=await maintApi(`/env?root=${encodeURIComponent(envRoot.value)}`);managedEnv.innerHTML=`<table><thead><tr><th style="text-align:left">Variable</th><th style="text-align:left">Value</th></tr></thead><tbody>${(j.variables||[]).map((x,i)=>`<tr><td style="text-align:left"><input class="envKey" value="${esc(x.key)}" style="width:100%"></td><td style="text-align:left"><input class="envValue" value="${esc(x.value)}" data-secret="${x.secret?'1':'0'}" style="width:100%" ${x.secret?'type="password"':'type="text"'}></td></tr>`).join('')}<tr><td><input id="newEnvKey" placeholder="NEW_VARIABLE" style="width:100%"></td><td><input id="newEnvValue" placeholder="value" style="width:100%"></td></tr></tbody></table>`}catch(e){managedEnv.innerHTML=`<div class="bad">${esc(e.message)}</div>`}}
async function saveManagedEnv(){try{const variables=[...managedEnv.querySelectorAll('tbody tr')].map(tr=>({key:tr.querySelector('.envKey')?.value||'',value:tr.querySelector('.envValue')?.value||''})).filter(x=>x.key);if(window.newEnvKey?.value)variables.push({key:newEnvKey.value,value:newEnvValue.value});await maintApi('/env',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({root:envRoot.value,variables})});alert('Environment variables saved. Restart affected services to apply changes.');await loadManagedEnv()}catch(e){alert(e.message)}}

async function loadDiagnosticInfrastructure(){
  try{
    const [h,sys,dc]=await Promise.all([maintApi('/health'),maintApi('/system'),maintApi('/docker/containers')]);
    const rows=(dc.containers||[]).map(c=>`<tr><td>${esc(c.Names||c.Name||'')}</td><td>${esc(c.Image||'')}</td><td>${esc(c.Status||c.State||'')}</td><td>${esc(c.Networks||'unknown')}</td><td>${esc(c.Ports||(c.Networks==='host'?'Host listeners (no port mappings)':''))}</td></tr>`).join('');
    diagInfrastructure.innerHTML=`<div class="grid" style="margin-bottom:12px"><div class="card"><div class="muted">Maintenance Agent</div><div class="kpi ${h.ok?'ok':'bad'}">${h.ok?'READY':'ISSUE'}</div></div><div class="card"><div class="muted">Docker Engine</div><div class="kpi ${h.docker?'ok':'bad'}">${h.docker?'READY':'ISSUE'}</div></div><div class="card"><div class="muted">Advanced Shell</div><div class="kpi">${h.shellEnabled?'ON':'OFF'}</div></div></div><div class="scroll"><table><thead><tr><th>Container</th><th>Image</th><th>Status</th><th>Network</th><th>Ports / listeners</th></tr></thead><tbody>${rows}</tbody></table></div><details style="margin-top:12px"><summary>Host Runtime Details</summary><pre class="raw">${esc(JSON.stringify(sys,null,2))}</pre></details>`;
  }catch(e){diagInfrastructure.innerHTML=`<div class="bad">Managed infrastructure diagnostics unavailable: ${esc(e.message)}</div>`}
}

for(const control of [window.appUpdateChannel,window.appUpdateAutomatic,window.appUpdateInterval,window.appUpdateStart,window.appUpdateEnd])control?.addEventListener('change',clearSelectedAppRelease);
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(accountModal?.style.display==='flex')closeAccountModal()});
bootstrapController();
