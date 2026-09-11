"use strict";

// Alpha.71+ extension layer. It wraps the established maintenance module routes
// without replacing backup/restore/update code in server.js.
const express=require("express");
const {mainAppUrl, serviceHost, validPort} = require("./network");
const http=require("http");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const TOKEN=String(process.env.MAINTENANCE_TOKEN||"");
const HOST_AGENT_SOCKET=String(process.env.HOST_AGENT_SOCKET||"/run/classroom-control-hub/host-agent.sock");
const MAIN_APP_URL=mainAppUrl();
const SERVICES_ROOT=path.resolve(process.env.MANAGED_SERVICES_ROOT||"/managed/services");
const NATIVE_VEYON_URL="http://127.0.0.1:11080";
const MUSIC_ASSISTANT_URL="http://127.0.0.1:8095";

const ADDONS={
  mosquitto:{id:"mosquitto",name:"MQTT Broker",container:"mosquitto",image:"eclipse-mosquitto:2.0.22",dataRoot:"mosquitto",description:"MQTT broker used by RoomGoblin integrations."},
  govee2mqtt:{id:"govee2mqtt",name:"Govee Lighting",container:"govee2mqtt",image:"ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72",dataRoot:"govee2mqtt",description:"Govee discovery and LAN/cloud control through MQTT."},
  musicassistant:{id:"musicassistant",name:"Music Assistant",container:"music-assistant-server",image:"ghcr.io/music-assistant/server:2.9.13",dataRoot:"music-assistant",description:"Classroom audio and media service. A valid long-lived Music Assistant access token is required before RoomGoblin marks this integration ready."},
  veyonwebapi:{id:"veyonwebapi",name:"Veyon WebAPI",container:"veyon-webapi",image:null,dataRoot:"veyon-webapi",description:"Native Veyon WebAPI service discovered on the appliance host. Service lifecycle remains host-managed while RoomGoblin manages Veyon application configuration."}
};

function hostAgentJson(method,pathName,body=null,timeoutMs=15000){return new Promise((resolve,reject)=>{const raw=body==null?null:Buffer.from(JSON.stringify(body));const req=http.request({socketPath:HOST_AGENT_SOCKET,path:pathName,method,headers:{"x-maintenance-token":TOKEN,...(raw?{"content-type":"application/json","content-length":raw.length}:{})}},res=>{const chunks=[];res.on("data",c=>chunks.push(c));res.on("end",()=>{const text=Buffer.concat(chunks).toString("utf8");let value;try{value=JSON.parse(text||"{}")}catch{value={error:text}}if((res.statusCode||500)>=400||value.ok===false)return reject(Error(value.error||`Host Agent HTTP ${res.statusCode}`));resolve(value)})});req.on("error",reject);req.setTimeout(timeoutMs,()=>req.destroy(Error("Host Agent request timed out")));if(raw)req.write(raw);req.end()})}
function hostAgentRequest(args,timeoutMs=180000){return hostAgentJson("POST","/docker/exec",{args,cwd:""},timeoutMs)}
async function containerExists(name){try{await hostAgentRequest(["inspect",name],10000);return true}catch{return false}}
async function hostServices(){try{const body=await hostAgentJson("GET","/services",null,10000);return Array.isArray(body.items)?body.items:Array.isArray(body.services)?body.services:[]}catch{return []}}
async function nativeVeyon(){const services=await hostServices(),webapi=services.find(x=>x&&x.name==="veyon-webapi.service"),service=services.find(x=>x&&x.name==="veyon.service");const installed=!!webapi&&webapi.active!=="inactive"&&webapi.active!=="not-found";return {installed,webapi:webapi||null,service:service||null,url:NATIVE_VEYON_URL}}

async function mainAppJson(method,pathName,body=null,timeoutMs=20000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(`${MAIN_APP_URL}${pathName}`,{method,headers:{"x-maintenance-token":TOKEN,...(body==null?{}:{"content-type":"application/json"})},body:body==null?undefined:JSON.stringify(body),signal:controller.signal});const text=await response.text();let value;try{value=JSON.parse(text||"{}")}catch{value={}}if(!response.ok)throw Error(value.error||`Application HTTP ${response.status}`);return value}finally{clearTimeout(timer)}}
async function mainAppPut(id,settings){return mainAppJson("PUT",`/api/v1/internal/maintenance/integrations/${encodeURIComponent(id)}`,{settings:settings||{}})}
async function mainAppManaged(){try{return await mainAppJson("GET","/api/v1/internal/maintenance/integrations",null,10000)}catch{return {integrations:{modules:{}}}}}
async function musicStatus(){try{return await mainAppJson("GET","/api/v1/internal/maintenance/music-assistant/status",null,20000)}catch(error){return {ok:false,configured:false,online:false,error:error.message,url:MUSIC_ASSISTANT_URL}}}
async function veyonComputers(){try{return await mainAppJson("GET","/api/v1/internal/maintenance/veyon/computers?info=1",null,30000)}catch(error){return {ok:false,error:error.message,computers:[],summary:{total:0,online:0,authenticated:0}}}}

function cleanPort(value,fallback){const n=Number(value||fallback);if(!Number.isInteger(n)||n<1||n>65535)throw Error("Port must be between 1 and 65535");return n}
function bounded(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback}
function managedPath(name){const value=path.join(SERVICES_ROOT,name);fs.mkdirSync(value,{recursive:true,mode:0o750});return value}
function cleanUrl(value,fallback){const raw=String(value||fallback).trim().replace(/\/$/,"");let u;try{u=new URL(raw)}catch{throw Error("Service URL must be a valid HTTP or HTTPS URL")}if(!["http:","https:"].includes(u.protocol)||u.username||u.password)throw Error("Service URL must use HTTP(S) without embedded credentials");return raw}

async function saveMusicAssistantSettings(settings={}){
  const url=cleanUrl(settings.url,MUSIC_ASSISTANT_URL),body={url,tvBridgeEnabled:true};
  const suppliedToken=String(settings.token||"").trim();if(suppliedToken&&suppliedToken!=="••••••••")body.token=suppliedToken;
  await mainAppJson("PUT","/api/v1/internal/maintenance/music-assistant/config",body,20000);
  const managed={...settings,url};delete managed.token;await mainAppPut("musicassistant",managed);
  const status=await musicStatus();
  if(!status.configured)throw Error("Music Assistant access token is required. Open Music Assistant, create a long-lived token under Settings → Profile, then save it here.");
  if(!status.online)throw Error(`Music Assistant token was saved but API authentication failed: ${status.error||"Music Assistant did not accept the token"}`);
  return status;
}

async function saveVeyonSettings(settings={}){
  const url=cleanUrl(settings.url,NATIVE_VEYON_URL),keyName=String(settings.keyName||"LAB").trim();if(!keyName)throw Error("Veyon authentication key name is required");
  const veyon={url,keyName,scanSubnet:String(settings.scanSubnet||"").trim().replace(/\.$/,""),scanStart:bounded(settings.scanStart,1,1,254),scanEnd:bounded(settings.scanEnd,254,1,254),poolMax:bounded(settings.poolMax,24,4,128),authRetries:bounded(settings.authRetries,2,0,5),thumbnailConcurrency:bounded(settings.thumbnailConcurrency,8,2,24)};
  if(veyon.scanEnd<veyon.scanStart)throw Error("Veyon scan end must be greater than or equal to scan start");
  const privateKey=String(settings.privateKey||"").trim();if(privateKey&&privateKey!=="••••••••")veyon.privateKey=privateKey;
  await mainAppJson("PUT","/api/v1/internal/maintenance/integration-connections",{veyon},20000);
  // Keep endpoint deployment metadata in managed integration storage. Keys whose
  // names include "credential" are encrypted by the main application.
  const managed={...settings,url,keyName};delete managed.privateKey;
  await mainAppPut("veyonwebapi",managed);
  return veyonComputers();
}

async function adoptNativeVeyon(settings={}){const native=await nativeVeyon();if(!native.installed)return null;const status=await saveVeyonSettings(settings),summary=status.summary||{};const detail=status.ok?`${summary.total||0} database computer(s), ${summary.online||0} online, ${summary.authenticated||0} authenticated.`:`Computer control test unavailable: ${status.error||"unknown error"}`;return {ok:true,id:"veyonwebapi",adopted:true,managed:true,management:"host-managed",hostManaged:true,nativeService:"veyon-webapi.service",companionService:native.service?.name||null,url:settings.url||NATIVE_VEYON_URL,veyonSummary:summary,message:`Native Veyon WebAPI configuration saved. ${detail}`}}

async function deployAddon(id,settings={},recreate=false){
  const addon=ADDONS[id];if(!addon)throw Error("Unknown optional integration");
  if(id==="veyonwebapi"){
    const adopted=await adoptNativeVeyon(settings);if(adopted)return adopted;
    throw Error("Native veyon-webapi.service was not found. Install/configure native Veyon on the appliance host before enabling this integration.");
  }
  const exists=await containerExists(addon.container);
  if(id==="musicassistant"&&exists){const status=await saveMusicAssistantSettings(settings);if(!recreate)return {ok:true,id,adopted:true,managed:true,container:addon.container,image:addon.image,message:`Existing Music Assistant adopted and authenticated successfully (${status.players?.length||0} player(s) discovered).`}}
  let resolved=settings||{};
  if(id!=="musicassistant"){const saved=await mainAppPut(id,settings);resolved=saved.resolved||resolved}
  if(exists&&!recreate)return {ok:true,id,adopted:true,managed:true,container:addon.container,image:addon.image,message:"Existing container adopted by RoomGoblin without recreation."};
  let args=["run","-d","--network","host","--name",addon.container,"--restart","unless-stopped"];
  if(id==="mosquitto"){
    const username=String(resolved.username||settings.username||"classroom-hub").replace(/[^A-Za-z0-9._-]/g,"");
    const password=String(resolved.password||settings.password||"");
    if(!username||password.length<16)throw Error("Mosquitto deployment requires a username and password of at least 16 characters.");
    const port=validPort(resolved.port??settings.port,1883);
    const base=managedPath("mosquitto"),config=path.join(base,"config"),data=path.join(base,"data"),log=path.join(base,"log");for(const dir of [config,data,log])fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const salt=crypto.randomBytes(12),hash=crypto.pbkdf2Sync(password,salt,101,64,"sha512");
    fs.writeFileSync(path.join(config,"passwords"),`${username}:$7$101$${salt.toString("base64").replace(/=+$/g,"")}$${hash.toString("base64").replace(/=+$/g,"")}\n`,{mode:0o600});
    fs.writeFileSync(path.join(config,"mosquitto.conf"),`persistence true\npersistence_location /mosquitto/data/\nlog_dest stdout\nlistener ${port}\nallow_anonymous false\npassword_file /mosquitto/config/passwords\n`,{mode:0o600});
    args.push(`-v`,`${config}:/mosquitto/config`,`-v`,`${data}:/mosquitto/data`,`-v`,`${log}:/mosquitto/log`);
  }else if(id==="govee2mqtt"){
    args.push("-e",`GOVEE_MQTT_HOST=${serviceHost(resolved.mqttHost||settings.mqttHost||"127.0.0.1",["mosquitto"],"host")}`,"-e",`GOVEE_MQTT_PORT=${cleanPort(resolved.mqttPort||settings.mqttPort,1883)}`,"-e",`TZ=${resolved.timezone||settings.timezone||process.env.TZ||"UTC"}`);
    for(const [env,key] of [["GOVEE_MQTT_USER","mqttUsername"],["GOVEE_MQTT_PASSWORD","mqttPassword"],["GOVEE_API_KEY","apiKey"],["GOVEE_EMAIL","email"],["GOVEE_PASSWORD","password"]]){const value=resolved[key]||settings[key];if(value)args.push("-e",`${env}=${value}`)}
  }else if(id==="musicassistant"){
    const base=managedPath("music-assistant");args.push("-v",`${base}:/data`,`-e`,`LOG_LEVEL=${String(settings.logLevel||"info")}`);
  }
  args.push(addon.image);
  if(exists)await hostAgentRequest(["rm","-f",addon.container],30000);
  const result=await hostAgentRequest(args,180000);
  if(id==="musicassistant"){
    await mainAppPut("musicassistant",{url:cleanUrl(settings.url,MUSIC_ASSISTANT_URL),logLevel:String(settings.logLevel||"info")});
    const suppliedToken=String(settings.token||"").trim();
    if(suppliedToken){await new Promise(r=>setTimeout(r,2500));await saveMusicAssistantSettings(settings);return {ok:true,id,managed:true,container:addon.container,image:addon.image,output:result.stdout||"",message:"Music Assistant deployed and authenticated successfully."}}
    return {ok:true,id,managed:true,container:addon.container,image:addon.image,setupRequired:true,output:result.stdout||"",message:"Music Assistant server deployed. Open Music Assistant, complete its first-run setup, create a long-lived token under Settings → Profile, then return here and save the token. RoomGoblin will remain setup-required until authentication succeeds."};
  }
  return {ok:true,id,managed:true,container:addon.container,image:addon.image,output:result.stdout||"",message:"Optional integration deployed and placed under RoomGoblin management."};
}

async function removeAddon(id){
  const addon=ADDONS[id];if(!addon)throw Error("Unknown optional integration");
  if(id==="veyonwebapi"){const native=await nativeVeyon();if(native.installed)return {ok:false,id,hostManaged:true,removed:false,dataPreserved:true,message:"Native Veyon services are host-managed and are not removed by RoomGoblin."}}
  const exists=await containerExists(addon.container);if(exists)await hostAgentRequest(["rm","-f",addon.container],30000);
  return {ok:true,id,removed:exists,container:addon.container,dataPreserved:true,dataRoot:path.join(SERVICES_ROOT,addon.dataRoot),message:"Container removed; persistent integration data was preserved for redeploy or rollback."};
}

async function augmentModules(body){
  if(!body||!Array.isArray(body.modules))return body;
  const byId=new Map(body.modules.map(x=>[x.id,x]));
  for(const addon of Object.values(ADDONS)){
    const current=byId.get(addon.id);
    if(current)Object.assign(current,{image:addon.image,externalOnly:false,canDeploy:true,canRemove:true,ownership:"integration"});
    else{const added={...addon,state:"not-installed",health:"",configured:false,management:"not-installed",externalOnly:false,canDeploy:true,canRemove:true,ownership:"integration"};body.modules.push(added);byId.set(addon.id,added)}
  }
  const [native,ma,managed]=await Promise.all([nativeVeyon(),musicStatus(),mainAppManaged()]);
  const maCurrent=byId.get("musicassistant");
  if(maCurrent&&maCurrent.state!=="not-installed")Object.assign(maCurrent,{configured:ma.configured===true&&ma.online===true,setupRequired:ma.configured!==true||ma.online!==true,health:ma.online?"authenticated":"authentication-required",uiUrl:ma.url||MUSIC_ASSISTANT_URL,configurationMessage:ma.online?`Music Assistant authenticated; ${ma.players?.length||0} player(s) discovered.`:(ma.configured?`Authentication failed: ${ma.error||"token rejected"}`:"Long-lived access token required before this integration is usable.")});
  if(native.installed){
    const current=byId.get("veyonwebapi"),stored=managed.integrations?.modules?.veyonwebapi||{},probe=await veyonComputers(),summary=probe.summary||{};
    Object.assign(current,{state:native.webapi?.active==="active"?"running":"installed",health:probe.ok?(summary.authenticated>0?"ready":"reachable-needs-authentication"):(native.webapi?.active||"installed"),configured:true,management:"host-managed",hostManaged:true,nativeService:"veyon-webapi.service",companionService:native.service?.name||null,networkMode:"native-host",networkMigrationRequired:false,endpoint:stored.url||NATIVE_VEYON_URL,externalOnly:false,canDeploy:true,canRemove:false,image:null,veyonSummary:summary,description:"Native Veyon WebAPI service discovered on the appliance host. Configure Veyon authentication, computer discovery and optional endpoint deployment credentials here; the host service itself is not recreated or removed."});
  }
  return body;
}

const originalGet=express.application.get;
express.application.get=function(route,...handlers){
  if(route==="/modules"&&handlers.length){const original=handlers[handlers.length-1];handlers[handlers.length-1]=async function(req,res,next){const send=res.json.bind(res);res.json=body=>{augmentModules(body).then(send).catch(()=>send(body));return res};return original(req,res,next)};}
  return originalGet.call(this,route,...handlers)
};

const originalPost=express.application.post;
express.application.post=function(route,...handlers){
  if(route==="/modules/:id/deploy"&&handlers.length){const original=handlers[handlers.length-1];handlers[handlers.length-1]=async function(req,res,next){const id=String(req.params.id||"");if(!ADDONS[id])return original(req,res,next);try{return res.json(await deployAddon(id,req.body?.settings||{},req.body?.recreate===true))}catch(error){return res.status(500).json({ok:false,error:error.message})}};}
  if(route==="/modules/:id/remove"&&handlers.length){const original=handlers[handlers.length-1];handlers[handlers.length-1]=async function(req,res,next){const id=String(req.params.id||"");if(!ADDONS[id])return original(req,res,next);try{const result=await removeAddon(id);return res.status(result.ok===false?409:200).json(result)}catch(error){return res.status(500).json({ok:false,error:error.message})}};}
  return originalPost.call(this,route,...handlers)
};
