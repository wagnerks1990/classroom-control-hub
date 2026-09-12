"use strict";

const express=require("express");
const fs=require("fs");
const path=require("path");
const dns=require("dns").promises;
const {execFile,spawn}=require("child_process");
const {promisify}=require("util");
const execFileAsync=promisify(execFile);
const {JsonStore,DEFAULT_PROFILE,publicDevice,cleanId,cleanHost,cleanPort,cleanSerial,cleanPackage,cleanShell,cleanText,makeId,adbArgsForAction}=require("./android-tv-lib");

const ROOT=path.resolve(process.env.ANDROID_TV_DATA_ROOT||"/managed/classroom-hub/data/android-tv");
const STORE=new JsonStore(ROOT);
const ADB=String(process.env.ADB_BIN||"adb");
const MAX_OUTPUT=8*1024*1024;
const originalListen=express.application.listen;
const POLICY_INTERVAL_MS=Math.max(15000,Math.min(300000,Number(process.env.ANDROID_TV_POLICY_INTERVAL_MS||60000)));
const policyState=new Map();
let installed=false,policyTimer=null;

function adbEnv(){return {...process.env,HOME:ROOT,ANDROID_USER_HOME:ROOT}}
async function adb(args,opts={}){
  const timeout=Math.max(1000,Math.min(Number(opts.timeout||30000),180000));
  try{const r=await execFileAsync(ADB,args,{timeout,maxBuffer:MAX_OUTPUT,env:adbEnv()});return {ok:true,stdout:r.stdout||"",stderr:r.stderr||""}}
  catch(error){const message=String(error.stderr||error.stdout||error.message||"ADB command failed").trim();const e=Error(message);e.code=error.code;e.stdout=error.stdout||"";e.stderr=error.stderr||"";throw e}
}
function asyncRoute(fn){return (req,res)=>Promise.resolve(fn(req,res)).catch(error=>res.status(error.status||500).json({ok:false,error:error.message}))}
function findDevice(id){const d=STORE.getDevice(id);if(!d){const e=Error("Managed Android display not found");e.status=404;throw e}return d}
function getProp(text,name){const m=String(text||"").match(new RegExp(`\\[${name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\]: \\[([^\\]]*)\\]`));return m?m[1]:""}
async function probe(serial){const [props,state,androidIdResult]=await Promise.all([adb(["-s",serial,"shell","getprop"]),adb(["-s",serial,"get-state"]),adb(["-s",serial,"shell","settings","get","secure","android_id"],{timeout:5000}).catch(()=>({stdout:""}))]);const p=props.stdout,androidId=String(androidIdResult.stdout||"").trim();return {online:String(state.stdout).trim()==="device",serial,manufacturer:getProp(p,"ro.product.manufacturer"),model:getProp(p,"ro.product.model"),androidVersion:getProp(p,"ro.build.version.release"),sdk:getProp(p,"ro.build.version.sdk"),build:getProp(p,"ro.build.display.id"),fingerprint:getProp(p,"ro.build.fingerprint"),product:getProp(p,"ro.product.name"),androidId:/^[a-fA-F0-9]{16}$/.test(androidId)?androidId.toLowerCase():null,lastSeenAt:new Date().toISOString()}}
async function connect(serial){const target=cleanSerial(serial);const r=await adb(["connect",target],{timeout:20000});await adb(["-s",target,"get-state"],{timeout:5000});return {ok:true,message:(r.stdout||r.stderr).trim(),serial:target}}
async function pair(host,port,code){const target=`${cleanHost(host)}:${cleanPort(port)}`;const c=String(code||"").trim();if(!/^\d{6}$/.test(c)){const e=Error("A six-digit Android wireless-debugging pairing code is required");e.status=400;throw e}const r=await adb(["pair",target,c],{timeout:30000});return {ok:true,target,message:(r.stdout||r.stderr).trim()}}
function parseMdnsConnectEndpoints(text){
  const endpoints=[];
  for(const line of String(text||"").split(/\r?\n/)){
    if(!line.includes("_adb-tls-connect._tcp"))continue;
    const m=line.match(/((?:\d{1,3}\.){3}\d{1,3}):(\d{1,5})\s*$/);
    if(!m)continue;
    const port=cleanPort(m[2]);
    endpoints.push({host:m[1],port,serial:`${m[1]}:${port}`,service:String(line.trim().split(/\s+/)[0]||""),raw:line.trim()});
  }
  return endpoints;
}
function parseMdnsConnect(text,host){
  const targetHost=String(host||"").trim();
  return parseMdnsConnectEndpoints(text).find(endpoint=>endpoint.host===targetHost)||null;
}
async function resolvedHostAddresses(host){
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host))return new Set([host]);
  try{return new Set((await dns.lookup(host,{all:true,family:4})).map(item=>item.address))}catch{return new Set()}
}
async function discoverConnectEndpoint(host,attempts=6){
  const clean=cleanHost(host);
  const addresses=await resolvedHostAddresses(clean);
  for(let i=0;i<attempts;i++){
    try{const r=await adb(["mdns","services"],{timeout:7000});const found=parseMdnsConnectEndpoints(r.stdout).find(endpoint=>addresses.has(endpoint.host));if(found)return found}catch{}
    if(i+1<attempts)await new Promise(resolve=>setTimeout(resolve,2500));
  }
  return null;
}
async function discoverConnectEndpointByIdentity(device,attempts=6){
  if(!/^[a-f0-9]{16}$/i.test(String(device.androidId||"")))return null;
  for(let i=0;i<attempts;i++){
    let endpoints=[];
    try{const r=await adb(["mdns","services"],{timeout:7000});endpoints=parseMdnsConnectEndpoints(r.stdout)}catch{}
    for(const endpoint of endpoints){
      try{
        await connect(endpoint.serial);
        const status=await probe(endpoint.serial);
        if(sameAndroidIdentity(device,status))return {endpoint,status};
        try{await adb(["disconnect",endpoint.serial],{timeout:5000})}catch{}
      }catch{}
    }
    if(i+1<attempts)await new Promise(resolve=>setTimeout(resolve,2500));
  }
  return null;
}
function sameAndroidIdentity(device,status){
  const saved=String(device?.androidId||"").toLowerCase(),observed=String(status?.androidId||"").toLowerCase();
  return /^[a-f0-9]{16}$/.test(saved)&&saved===observed;
}
async function ensureDevice(device,opts={}){
  let d=device;
  try{const status=await probe(d.serial);if(!d.androidId||sameAndroidIdentity(d,status))return {device:d,status,recovered:false};try{await adb(["disconnect",d.serial],{timeout:5000})}catch{}}catch{}
  try{await connect(d.serial);const status=await probe(d.serial);if(!d.androidId||sameAndroidIdentity(d,status))return {device:d,status,recovered:true};try{await adb(["disconnect",d.serial],{timeout:5000})}catch{}}catch{}
  let endpoint=await discoverConnectEndpoint(d.host,Number(opts.mdnsAttempts||6)),status=null;
  if(endpoint){await connect(endpoint.serial);status=await probe(endpoint.serial);if(d.androidId&&!sameAndroidIdentity(d,status)){try{await adb(["disconnect",endpoint.serial],{timeout:5000})}catch{};endpoint=null;status=null}}
  if(!endpoint){const matched=await discoverConnectEndpointByIdentity(d,Number(opts.mdnsAttempts||6));endpoint=matched?.endpoint||null;status=matched?.status||null}
  if(!endpoint){const e=Error(`Unable to reconnect ${d.name||d.id}. No authorized wireless ADB endpoint matched its saved device identity.`);e.status=503;throw e}
  d=STORE.upsertDevice({...d,host:endpoint.host,port:endpoint.port,serial:endpoint.serial,...status,lastStatus:{...status,source:"adb-mdns-recovery",checkedAt:new Date().toISOString()}});
  return {device:d,status,recovered:true,endpoint};
}
async function rebootDevice(serial){
  const target=cleanSerial(serial);
  await adb(["-s",target,"get-state"],{timeout:5000});
  return new Promise((resolve,reject)=>{
    const child=spawn(ADB,["-s",target,"reboot"],{env:adbEnv(),stdio:"ignore"});
    child.once("error",reject);
    child.once("spawn",()=>{child.unref?.();resolve({ok:true,accepted:true,message:"Reboot command launched; the Android device is expected to disconnect while restarting."})});
  });
}
async function enrollOne(body={}){
  const host=cleanHost(body.host);if(body.pairingCode)await pair(host,body.pairingPort,body.pairingCode);
  let connectPort=body.connectPort||body.port?cleanPort(body.connectPort||body.port):null;
  let serial=body.serial?cleanSerial(body.serial):null;
  if(!serial&&connectPort){serial=cleanSerial(`${host}:${connectPort}`);try{await connect(serial)}catch{serial=null}}
  if(!serial){const endpoint=await discoverConnectEndpoint(host,8);if(!endpoint){const e=Error("Pairing succeeded but the secure ADB connection endpoint could not be discovered. Keep Wireless debugging enabled and retry enrollment.");e.status=503;throw e}serial=endpoint.serial;connectPort=endpoint.port;await connect(serial)}
  const info=await probe(serial);
  const device=STORE.upsertDevice({id:body.id||makeId("display"),name:body.name||`${info.manufacturer} ${info.model}`.trim()||serial,host,port:connectPort||Number(serial.split(":").pop()),serial,organization:body.organization,school:body.school,building:body.building,room:body.room,profileId:body.profileId||DEFAULT_PROFILE.id,displayUrl:body.displayUrl,agentPackage:body.agentPackage||"org.roomgoblin.display",...info,lastStatus:{online:true,source:"adb-enrollment",checkedAt:new Date().toISOString()}});
  return {device,probe:info};
}
function localClock(timeZone){const parts=Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date()).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));return {date:`${parts.year}-${parts.month}-${parts.day}`,clock:`${parts.hour}:${parts.minute}`,minutes:Number(parts.hour)*60+Number(parts.minute)}}
function hhmmMinutes(v){const [h,m]=String(v).split(":").map(Number);return h*60+m}
function desiredAwake(profile,minutes){const wake=hhmmMinutes(profile.wakeTime),sleep=hhmmMinutes(profile.sleepTime);return wake===sleep?true:wake<sleep?(minutes>=wake&&minutes<sleep):(minutes>=wake||minutes<sleep)}
async function applyDevicePolicy(device,profile,force=false){const clock=localClock(profile.timezone||"UTC"),awake=desiredAwake(profile,clock.minutes),key=`${clock.date}:${awake?"awake":"sleep"}`;if(!force&&policyState.get(device.id)===key)return {deviceId:device.id,changed:false,desiredAwake:awake,clock};const managed=(await ensureDevice(device,{mdnsAttempts:2})).device;if(awake){await adb(adbArgsForAction(managed,"wake"));if(profile.launchOnBoot)await adb(adbArgsForAction(managed,"launch"),{timeout:30000})}else await adb(adbArgsForAction(managed,"sleep"));policyState.set(managed.id,key);return {deviceId:managed.id,changed:true,desiredAwake:awake,clock}}
async function applyPolicies(force=false){const data=STORE.list(),profiles=new Map(data.profiles.map(x=>[x.id,x])),results=[];for(const device of data.devices.filter(x=>x.enabled!==false)){const profile=profiles.get(device.profileId)||DEFAULT_PROFILE;try{results.push(await applyDevicePolicy(device,profile,force))}catch(error){results.push({deviceId:device.id,changed:false,error:error.message})}}return {ok:true,checkedAt:new Date().toISOString(),results}}
function startPolicyLoop(){if(policyTimer)return;setTimeout(()=>applyPolicies(false).catch(()=>{}),5000);policyTimer=setInterval(()=>applyPolicies(false).catch(()=>{}),POLICY_INTERVAL_MS);policyTimer.unref?.()}

function installRoutes(app){if(installed)return;installed=true;
  app.get("/android/status",asyncRoute(async(_req,res)=>{let version=null,error=null;try{version=(await adb(["version"],{timeout:5000})).stdout.trim()}catch(e){error=e.message}const data=STORE.list();res.status(version?200:503).json({ok:!!version,adbAvailable:!!version,adbVersion:version,error,root:ROOT,policyIntervalMs:POLICY_INTERVAL_MS,devices:data.devices.map(publicDevice),profiles:data.profiles,defaultProfile:DEFAULT_PROFILE})}));
  app.get("/android/devices",asyncRoute(async(_req,res)=>{const data=STORE.list();res.json({ok:true,devices:data.devices.map(publicDevice),profiles:data.profiles})}));
  app.get("/android/adb/devices",asyncRoute(async(_req,res)=>{const r=await adb(["devices","-l"],{timeout:10000});const devices=r.stdout.split(/\r?\n/).slice(1).filter(Boolean).map(line=>({raw:line,serial:line.trim().split(/\s+/)[0],state:line.trim().split(/\s+/)[1]||"unknown"}));res.json({ok:true,devices})}));
  app.get("/android/adb/mdns",asyncRoute(async(_req,res)=>{const r=await adb(["mdns","services"],{timeout:10000});res.json({ok:true,raw:r.stdout})}));
  app.post("/android/pair",asyncRoute(async(req,res)=>res.json(await pair(req.body?.host,req.body?.port,req.body?.code))));
  app.post("/android/connect",asyncRoute(async(req,res)=>{const serial=req.body?.serial||`${cleanHost(req.body?.host)}:${cleanPort(req.body?.port)}`;res.json(await connect(serial))}));
  app.post("/android/enroll",asyncRoute(async(req,res)=>{const result=await enrollOne(req.body||{});res.status(201).json({ok:true,...result})}));
  app.post("/android/enroll/bulk",asyncRoute(async(req,res)=>{const items=Array.isArray(req.body?.devices)?req.body.devices:[];if(!items.length||items.length>100){const e=Error("Bulk enrollment requires 1-100 devices");e.status=400;throw e}const results=[];for(const item of items){try{const r=await enrollOne(item);results.push({ok:true,id:r.device.id,name:r.device.name})}catch(error){results.push({ok:false,name:cleanText(item?.name||item?.host,120),error:error.message})}}res.status(results.some(x=>!x.ok)?207:201).json({ok:results.every(x=>x.ok),results})}));
  app.get("/android/policies/status",asyncRoute(async(_req,res)=>res.json({ok:true,intervalMs:POLICY_INTERVAL_MS,state:Object.fromEntries(policyState)})));
  app.post("/android/policies/apply",asyncRoute(async(_req,res)=>res.json(await applyPolicies(true))));
  app.get("/android/devices/:id/status",asyncRoute(async(req,res)=>{const d=findDevice(req.params.id);try{const result=await ensureDevice(d,{mdnsAttempts:8});const updated=STORE.upsertDevice({...result.device,...result.status,lastStatus:{...result.status,source:result.endpoint?"adb-mdns-recovery":"adb-status",checkedAt:new Date().toISOString()}});res.json({ok:true,device:publicDevice(updated),status:result.status,recovered:result.recovered,endpoint:result.endpoint||null})}catch(error){const updated=STORE.upsertDevice({...d,lastStatus:{online:false,error:error.message,checkedAt:new Date().toISOString()}});res.status(503).json({ok:false,error:error.message,device:publicDevice(updated)})}}));
  app.post("/android/devices/:id/action",asyncRoute(async(req,res)=>{let d=findDevice(req.params.id);const action=cleanText(req.body?.action,40);if(action==="screenshot"){const e=Error("Use the screenshot endpoint");e.status=400;throw e}d=(await ensureDevice(d,{mdnsAttempts:4})).device;if(action==="reboot"){const result=await rebootDevice(d.serial);policyState.delete(d.id);STORE.upsertDevice({...d,lastStatus:{online:false,rebooting:true,checkedAt:new Date().toISOString()}});res.status(202).json({ok:true,deviceId:d.id,action,...result});return}const result=await adb(adbArgsForAction(d,action,req.body||{}),{timeout:30000});res.json({ok:true,deviceId:d.id,action,stdout:result.stdout,stderr:result.stderr})}));
  app.post("/android/devices/:id/shell",asyncRoute(async(req,res)=>{let d=findDevice(req.params.id);d=(await ensureDevice(d,{mdnsAttempts:4})).device;const command=cleanShell(req.body?.command);const result=await adb(["-s",d.serial,"shell","sh","-c",command],{timeout:Number(req.body?.timeoutMs||30000)});res.json({ok:true,deviceId:d.id,command,stdout:result.stdout,stderr:result.stderr})}));
  app.get("/android/devices/:id/screenshot",asyncRoute(async(req,res)=>{let d=findDevice(req.params.id);d=(await ensureDevice(d,{mdnsAttempts:4})).device;const {stdout}=await execFileAsync(ADB,["-s",d.serial,"exec-out","screencap","-p"],{encoding:"buffer",timeout:30000,maxBuffer:16*1024*1024,env:adbEnv()});res.json({ok:true,deviceId:d.id,contentType:"image/png",base64:Buffer.from(stdout).toString("base64")})}));
  app.post("/android/devices/:id/agent/install",asyncRoute(async(req,res)=>{let d=findDevice(req.params.id);d=(await ensureDevice(d,{mdnsAttempts:4})).device;const apk=path.resolve(String(req.body?.apkPath||path.join(ROOT,"RoomGoblin-Display-Agent.apk")));if(!(apk===ROOT||apk.startsWith(ROOT+path.sep))||!fs.existsSync(apk)){const e=Error(`Agent APK not found in ${ROOT}. Build/download the signed APK before installation.`);e.status=400;throw e}let removedLegacy=false;try{const probe=await adb(["-s",d.serial,"shell","pm","path","org.classroomhub.display"],{timeout:15000});if(/^package:/m.test(String(probe.stdout||""))){await adb(["-s",d.serial,"uninstall","org.classroomhub.display"],{timeout:60000});removedLegacy=true}}catch(error){if(!/Unknown package|not installed|DELETE_FAILED_INTERNAL_ERROR/i.test(String(error.message||"")))throw error}const r=await adb(["-s",d.serial,"install","-r","-g",apk],{timeout:180000});STORE.upsertDevice({...d,agentPackage:"org.roomgoblin.display"});res.json({ok:true,deviceId:d.id,message:`${removedLegacy?"Old Android app uninstalled. ":""}${String(r.stdout||r.stderr).trim()}`})}));
  app.post("/android/devices/:id/agent/configure",asyncRoute(async(req,res)=>{let d=findDevice(req.params.id);d=(await ensureDevice(d,{mdnsAttempts:4})).device;const pkg=cleanPackage(req.body?.package||d.agentPackage),url=String(req.body?.displayUrl||d.displayUrl||"").trim();if(!/^https?:\/\//i.test(url)){const e=Error("A valid HTTP(S) display URL is required");e.status=400;throw e}await adb(["-s",d.serial,"shell","am","broadcast","-a","org.roomgoblin.display.CONFIGURE","-p",pkg,"--es","display_url",url],{timeout:20000});const updated=STORE.upsertDevice({...d,displayUrl:url,agentPackage:pkg});res.json({ok:true,device:publicDevice(updated)})}));
  app.put("/android/devices/:id",asyncRoute(async(req,res)=>{const d=findDevice(req.params.id);res.json({ok:true,device:publicDevice(STORE.upsertDevice({...d,...req.body,id:d.id,host:req.body?.host||d.host,serial:req.body?.serial||d.serial}))})}));
  app.delete("/android/devices/:id",asyncRoute(async(req,res)=>{const d=findDevice(req.params.id);try{await adb(["disconnect",d.serial],{timeout:10000})}catch{}policyState.delete(d.id);res.json({ok:true,removed:STORE.deleteDevice(d.id),deviceId:d.id})}));
  app.put("/android/profiles/:id",asyncRoute(async(req,res)=>res.json({ok:true,profile:STORE.upsertProfile({...req.body,id:cleanId(req.params.id)})})));
  startPolicyLoop();
}

express.application.listen=function(...args){installRoutes(this);return originalListen.apply(this,args)};
module.exports={installRoutes,probe,pair,connect,parseMdnsConnect,parseMdnsConnectEndpoints,discoverConnectEndpoint,discoverConnectEndpointByIdentity,sameAndroidIdentity,ensureDevice,rebootDevice,enrollOne,applyPolicies,desiredAwake,localClock,STORE};
