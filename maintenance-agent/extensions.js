"use strict";

// Alpha.71 extension layer. It wraps the established maintenance module routes
// without replacing backup/restore/update code in server.js.
const express=require("express");
const http=require("http");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const TOKEN=String(process.env.MAINTENANCE_TOKEN||"");
const HOST_AGENT_SOCKET=String(process.env.HOST_AGENT_SOCKET||"/run/classroom-control-hub/host-agent.sock");
const MAIN_APP_URL=String(process.env.MAIN_APP_URL||"http://classroom-hub:3000").replace(/\/$/,"");
const SERVICES_ROOT=path.resolve(process.env.MANAGED_SERVICES_ROOT||"/managed/services");

// Supported optional services appear in both Setup and Infrastructure & Recovery.
// Existing containers can be adopted without recreation. Recreate/deploy uses
// these reviewed repositories while persistent state stays beneath SERVICES_ROOT.
const ADDONS={
  mosquitto:{id:"mosquitto",name:"MQTT Broker",container:"mosquitto",image:"eclipse-mosquitto:latest",dataRoot:"mosquitto",description:"MQTT broker used by Classroom Control Hub integrations."},
  govee2mqtt:{id:"govee2mqtt",name:"Govee Lighting",container:"govee2mqtt",image:"ghcr.io/wez/govee2mqtt:latest",dataRoot:"govee2mqtt",description:"Govee discovery and LAN/cloud control through MQTT."},
  musicassistant:{id:"musicassistant",name:"Music Assistant",container:"music-assistant-server",image:"ghcr.io/music-assistant/server:latest",dataRoot:"music-assistant",description:"Optional Classroom Hub-managed audio and media service."},
  veyonwebapi:{id:"veyonwebapi",name:"Veyon WebAPI",container:"veyon-webapi",image:"veyon/webapi-proxy:latest",dataRoot:"veyon-webapi",description:"Optional Veyon WebAPI proxy for classroom workstation control."}
};

function hostAgentRequest(args,timeoutMs=180000){return new Promise((resolve,reject)=>{const raw=Buffer.from(JSON.stringify({args,cwd:""}));const req=http.request({socketPath:HOST_AGENT_SOCKET,path:"/docker/exec",method:"POST",headers:{"x-maintenance-token":TOKEN,"content-type":"application/json","content-length":raw.length}},res=>{const chunks=[];res.on("data",c=>chunks.push(c));res.on("end",()=>{const text=Buffer.concat(chunks).toString("utf8");let body;try{body=JSON.parse(text||"{}")}catch{body={error:text}}if((res.statusCode||500)>=400||body.ok===false)return reject(Error(body.error||`Host Agent HTTP ${res.statusCode}`));resolve(body)})});req.on("error",reject);req.setTimeout(timeoutMs,()=>req.destroy(Error("Host Agent Docker request timed out")));req.write(raw);req.end()})}
async function containerExists(name){try{await hostAgentRequest(["inspect",name],10000);return true}catch{return false}}
async function mainAppPut(id,settings){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const response=await fetch(`${MAIN_APP_URL}/api/v1/internal/maintenance/integrations/${encodeURIComponent(id)}`,{method:"PUT",headers:{"x-maintenance-token":TOKEN,"content-type":"application/json"},body:JSON.stringify({settings:settings||{}}),signal:controller.signal});const text=await response.text();let body;try{body=JSON.parse(text||"{}")}catch{body={}};if(!response.ok)throw Error(body.error||`Application HTTP ${response.status}`);return body}finally{clearTimeout(timer)}}
function cleanPort(value,fallback){const n=Number(value||fallback);if(!Number.isInteger(n)||n<1||n>65535)throw Error("Port must be between 1 and 65535");return n}
function managedPath(name){const value=path.join(SERVICES_ROOT,name);fs.mkdirSync(value,{recursive:true,mode:0o750});return value}

async function deployAddon(id,settings={},recreate=false){
  const addon=ADDONS[id];if(!addon)throw Error("Unknown optional integration");
  const exists=await containerExists(addon.container);
  let resolved=settings||{};
  try{const saved=await mainAppPut(id,settings);resolved=saved.resolved||resolved}catch(error){if(id!=="veyonwebapi")throw error}
  if(exists&&!recreate)return {ok:true,id,adopted:true,managed:true,container:addon.container,image:addon.image,message:"Existing container adopted by Classroom Control Hub without recreation."};
  if(exists)await hostAgentRequest(["rm","-f",addon.container],30000);
  let args=["run","-d","--name",addon.container,"--restart","unless-stopped"];
  if(id==="mosquitto"){
    const username=String(resolved.username||settings.username||"classroom-hub").replace(/[^A-Za-z0-9._-]/g,"");
    const password=String(resolved.password||settings.password||"");
    if(!username||password.length<16)throw Error("Mosquitto deployment requires a username and password of at least 16 characters.");
    const base=managedPath("mosquitto"),config=path.join(base,"config"),data=path.join(base,"data"),log=path.join(base,"log");for(const dir of [config,data,log])fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const salt=crypto.randomBytes(12),hash=crypto.pbkdf2Sync(password,salt,101,64,"sha512");
    fs.writeFileSync(path.join(config,"passwords"),`${username}:$7$101$${salt.toString("base64").replace(/=+$/g,"")}$${hash.toString("base64").replace(/=+$/g,"")}\n`,{mode:0o600});
    fs.writeFileSync(path.join(config,"mosquitto.conf"),"persistence true\npersistence_location /mosquitto/data/\nlog_dest stdout\nlistener 1883\nallow_anonymous false\npassword_file /mosquitto/config/passwords\n",{mode:0o600});
    args.push("-p",`${cleanPort(resolved.port||settings.port,1883)}:1883`,`-v`,`${config}:/mosquitto/config`,`-v`,`${data}:/mosquitto/data`,`-v`,`${log}:/mosquitto/log`);
  }else if(id==="govee2mqtt"){
    args.push("--network","host","-e",`GOVEE_MQTT_HOST=${resolved.mqttHost||settings.mqttHost||"127.0.0.1"}`,"-e",`GOVEE_MQTT_PORT=${cleanPort(resolved.mqttPort||settings.mqttPort,1883)}`,"-e",`TZ=${resolved.timezone||settings.timezone||process.env.TZ||"UTC"}`);
    for(const [env,key] of [["GOVEE_MQTT_USER","mqttUsername"],["GOVEE_MQTT_PASSWORD","mqttPassword"],["GOVEE_API_KEY","apiKey"],["GOVEE_EMAIL","email"],["GOVEE_PASSWORD","password"]]){const value=resolved[key]||settings[key];if(value)args.push("-e",`${env}=${value}`)}
  }else if(id==="musicassistant"){
    // Music Assistant requires host networking for supported mDNS/uPnP player
    // discovery. Keep its database under the managed services root.
    const base=managedPath("music-assistant");args.push("--network","host","-v",`${base}:/data`,`-e`,`LOG_LEVEL=${String(settings.logLevel||"info")}`);
  }else if(id==="veyonwebapi"){
    // Official Veyon WebAPI proxy container. Host networking keeps classroom
    // Veyon server endpoints reachable without publishing a broad port range.
    const base=managedPath("veyon-webapi");args.push("--network","host","-v",`${base}:/data`);
  }
  args.push(addon.image);
  const result=await hostAgentRequest(args,180000);
  return {ok:true,id,managed:true,container:addon.container,image:addon.image,output:result.stdout||"",message:"Optional integration deployed and placed under Classroom Control Hub management."};
}

async function removeAddon(id){
  const addon=ADDONS[id];if(!addon)throw Error("Unknown optional integration");
  const exists=await containerExists(addon.container);
  if(exists)await hostAgentRequest(["rm","-f",addon.container],30000);
  return {ok:true,id,removed:exists,container:addon.container,dataPreserved:true,dataRoot:path.join(SERVICES_ROOT,addon.dataRoot),message:"Container removed; persistent integration data was preserved for redeploy or rollback."};
}

// Wrap the established route registrations as server.js loads. This keeps the
// mature backup/restore/update surface untouched while extending modules only.
const originalGet=express.application.get;
express.application.get=function(route,...handlers){
  if(route==="/modules"&&handlers.length){const original=handlers[handlers.length-1];handlers[handlers.length-1]=async function(req,res,next){const send=res.json.bind(res);res.json=body=>{if(body&&Array.isArray(body.modules)){const byId=new Map(body.modules.map(x=>[x.id,x]));for(const addon of Object.values(ADDONS)){const current=byId.get(addon.id);if(current)Object.assign(current,{image:addon.image,externalOnly:false,canDeploy:true,canRemove:true,ownership:"integration"});else body.modules.push({...addon,state:"not-installed",health:"",configured:false,management:"not-installed",externalOnly:false,canDeploy:true,canRemove:true,ownership:"integration"})}}return send(body)};return original(req,res,next)};}return originalGet.call(this,route,...handlers)};

const originalPost=express.application.post;
express.application.post=function(route,...handlers){
  if(route==="/modules/:id/deploy"&&handlers.length){const original=handlers[handlers.length-1];handlers[handlers.length-1]=async function(req,res,next){const id=String(req.params.id||"");if(!ADDONS[id])return original(req,res,next);try{return res.json(await deployAddon(id,req.body?.settings||{},req.body?.recreate===true))}catch(error){return res.status(500).json({ok:false,error:error.message})}};}
  if(route==="/modules/:id/remove"&&handlers.length){const original=handlers[handlers.length-1];handlers[handlers.length-1]=async function(req,res,next){const id=String(req.params.id||"");if(!ADDONS[id])return original(req,res,next);try{return res.json(await removeAddon(id))}catch(error){return res.status(500).json({ok:false,error:error.message})}};}
  return originalPost.call(this,route,...handlers)
};
