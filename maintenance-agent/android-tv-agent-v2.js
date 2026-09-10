"use strict";

const express=require("express");
const crypto=require("crypto");
const {execFile}=require("child_process");
const {promisify}=require("util");
const execFileAsync=promisify(execFile);
const {STORE}=require("./android-tv-extension");
const {cleanPackage,cleanPort}=require("./android-tv-lib");

const ROOT=process.env.ANDROID_TV_DATA_ROOT||"/managed/classroom-hub/data/android-tv";
const ADB=String(process.env.ADB_BIN||"adb");
const originalListen=express.application.listen;
let installed=false;

function env(){return {...process.env,HOME:ROOT,ANDROID_USER_HOME:ROOT}}
async function adb(args,timeout=30000){try{return await execFileAsync(ADB,args,{timeout,maxBuffer:8*1024*1024,env:env()})}catch(error){const e=Error(String(error.stderr||error.stdout||error.message||"ADB command failed").trim());e.code=error.code;throw e}}
function route(fn){return (req,res)=>Promise.resolve(fn(req,res)).catch(error=>res.status(error.status||500).json({ok:false,error:error.message}))}
function device(id){const d=STORE.getDevice(id);if(!d){const e=Error("Managed Android display not found");e.status=404;throw e}return d}
function token(){return crypto.randomBytes(32).toString("hex")}
function agentSettings(d){return d.agentV2&&d.agentV2.token?d.agentV2:null}
async function agentFetch(d,pathName,opt={}){
  const cfg=agentSettings(d);if(!cfg){const e=Error("Device Agent v2 is not configured for this display");e.status=409;throw e}
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(Number(opt.timeout||8000),30000)));
  try{
    const r=await fetch(`http://${d.host}:${cleanPort(cfg.port||8765)}${pathName}`,{method:opt.method||"GET",headers:{"x-classroom-hub-agent-token":cfg.token,"content-type":"application/json"},body:opt.body===undefined?undefined:JSON.stringify(opt.body),signal:controller.signal});
    const text=await r.text();let json={};try{json=JSON.parse(text)}catch{json={ok:false,error:text||`Agent HTTP ${r.status}`}}
    if(!r.ok||json.ok===false){const e=Error(json.error||`Agent HTTP ${r.status}`);e.status=r.status||502;throw e}return json;
  }catch(error){if(error.name==="AbortError"){const e=Error("Device Agent v2 request timed out");e.status=504;throw e}throw error}finally{clearTimeout(timer)}
}
async function configure(d,body={}){
  const pkg=cleanPackage(body.package||d.agentPackage||"org.classroomhub.display");
  const port=cleanPort(body.port||d.agentV2?.port||8765);
  const agentToken=body.rotateToken||!d.agentV2?.token?token():d.agentV2.token;
  const url=String(body.displayUrl||d.displayUrl||"").trim();if(!/^https?:\/\//i.test(url)){const e=Error("A valid HTTP(S) display URL is required");e.status=400;throw e}
  await adb(["-s",d.serial,"shell","am","broadcast","-a","org.classroomhub.display.CONFIGURE","-p",pkg,"--es","display_url",url,"--ez","agent_enabled","true","--ei","agent_port",String(port),"--es","agent_token",agentToken],20000);
  const updated=STORE.upsertDevice({...d,displayUrl:url,agentPackage:pkg,agentV2:{enabled:true,port,token:agentToken,configuredAt:new Date().toISOString()}});
  return updated;
}

function installRoutes(app){if(installed)return;installed=true;
  app.post("/android/devices/:id/agent/v2/configure",route(async(req,res)=>{const updated=await configure(device(req.params.id),req.body||{});res.json({ok:true,device:{...updated,agentV2:{...updated.agentV2,token:"configured"}},message:"Device Agent v2 configured. The token remains server-side."})}));
  app.get("/android/devices/:id/agent/v2/status",route(async(req,res)=>{const d=device(req.params.id);const status=await agentFetch(d,"/v1/status",{timeout:8000});res.json({ok:true,transport:"agent-http",deviceId:d.id,status})}));
  app.get("/android/devices/:id/agent/v2/capabilities",route(async(req,res)=>{const d=device(req.params.id);const capabilities=await agentFetch(d,"/v1/capabilities",{timeout:8000});res.json({ok:true,transport:"agent-http",deviceId:d.id,capabilities})}));
  app.post("/android/devices/:id/agent/v2/action",route(async(req,res)=>{const d=device(req.params.id);const result=await agentFetch(d,"/v1/action",{method:"POST",body:req.body||{},timeout:Number(req.body?.timeoutMs||10000)});res.json({ok:true,transport:"agent-http",deviceId:d.id,result})}));
  app.get("/android/devices/:id/agent/v2/health",route(async(req,res)=>{const d=device(req.params.id);try{const status=await agentFetch(d,"/v1/status",{timeout:3000});res.json({ok:true,reachable:true,transport:"agent-http",status})}catch(error){res.status(503).json({ok:false,reachable:false,error:error.message})}}));
}

express.application.listen=function(...args){installRoutes(this);return originalListen.apply(this,args)};
module.exports={installRoutes,configure,agentFetch};
