"use strict";

const express=require("express");
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
async function adb(args,timeout=30000){
  try{return await execFileAsync(ADB,args,{timeout,maxBuffer:8*1024*1024,env:env()})}
  catch(error){const message=String(error.stderr||error.stdout||error.message||"ADB command failed").trim();const e=Error(message);e.code=error.code;throw e}
}
function route(fn){return (req,res)=>Promise.resolve(fn(req,res)).catch(error=>res.status(error.status||500).json({ok:false,error:error.message}))}
function device(id){const d=STORE.getDevice(id);if(!d){const e=Error("Managed Android display not found");e.status=404;throw e}return d}
async function requireOnline(d){
  try{await adb(["-s",d.serial,"get-state"],5000);return d}
  catch{try{await adb(["connect",d.serial],12000);await adb(["-s",d.serial,"get-state"],5000);return d}catch{const e=Error("Device must be online once to bootstrap persistent wireless debugging.");e.status=503;throw e}}
}
async function broadcastPolicy(d,enabled,targetPort){
  const pkg=cleanPackage(d.agentPackage||"org.classroomhub.display");
  await adb(["-s",d.serial,"shell","am","broadcast","-a","org.classroomhub.display.CONFIGURE","-p",pkg,"--ez","persistent_adb",enabled?"true":"false","--ei","target_adb_port",String(targetPort)],15000);
}
async function bootstrap(d,targetPort){
  d=await requireOnline(d);
  const pkg=cleanPackage(d.agentPackage||"org.classroomhub.display");
  const packages=(await adb(["-s",d.serial,"shell","pm","path",pkg],10000)).stdout||"";
  if(!packages.includes("package:")){const e=Error("Classroom Hub Display Agent must be installed before persistent ADB can be enabled.");e.status=409;throw e}

  await adb(["-s",d.serial,"shell","pm","grant",pkg,"android.permission.WRITE_SECURE_SETTINGS"],15000);
  await adb(["-s",d.serial,"shell","settings","put","global","development_settings_enabled","1"],10000);
  await adb(["-s",d.serial,"shell","settings","put","global","adb_wifi_enabled","1"],10000);
  await broadcastPolicy(d,true,targetPort);

  let tcpipMessage="";
  try{const r=await adb(["-s",d.serial,"tcpip",String(targetPort)],15000);tcpipMessage=String(r.stdout||r.stderr||"").trim()}catch(error){tcpipMessage=error.message}
  await new Promise(resolve=>setTimeout(resolve,2500));
  const fixedSerial=`${d.host}:${targetPort}`;
  await adb(["connect",fixedSerial],15000);
  await adb(["-s",fixedSerial,"get-state"],7000);
  const updated=STORE.upsertDevice({...d,port:targetPort,serial:fixedSerial,persistentAdb:{enabled:true,targetPort,bootRestore:true,bootstrapAt:new Date().toISOString()},lastStatus:{online:true,source:"persistent-adb-bootstrap",checkedAt:new Date().toISOString()}});
  return {device:updated,tcpipMessage};
}

function installRoutes(app){if(installed)return;installed=true;
  app.post("/android/devices/:id/persistent-adb/bootstrap",route(async(req,res)=>{
    const targetPort=cleanPort(req.body?.targetPort||5555);
    const result=await bootstrap(device(req.params.id),targetPort);
    res.json({ok:true,targetPort,message:"Persistent wireless debugging boot policy enabled and fixed ADB endpoint configured.",...result});
  }));
  app.post("/android/devices/:id/persistent-adb/disable",route(async(req,res)=>{
    let d=await requireOnline(device(req.params.id));
    const targetPort=cleanPort(d.persistentAdb?.targetPort||d.port||5555);
    await broadcastPolicy(d,false,targetPort);
    d=STORE.upsertDevice({...d,persistentAdb:{enabled:false,targetPort,bootRestore:false,disabledAt:new Date().toISOString()}});
    res.json({ok:true,device:d,message:"Persistent ADB boot restoration disabled. Current ADB session was left connected intentionally."});
  }));
}

express.application.listen=function(...args){installRoutes(this);return originalListen.apply(this,args)};
module.exports={installRoutes,bootstrap};
