"use strict";

const express=require("express");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {execFile}=require("child_process");
const {promisify}=require("util");
const execFileAsync=promisify(execFile);
const {STORE}=require("./android-tv-extension");
const {configure}=require("./android-tv-agent-v2");
const {cleanPackage}=require("./android-tv-lib");

const ROOT=path.resolve(process.env.ANDROID_TV_DATA_ROOT||"/managed/classroom-hub/data/android-tv");
const APK=path.join(ROOT,"ClassroomHub-Display-Agent.apk");
const META=path.join(ROOT,"ClassroomHub-Display-Agent.json");
const ADB=String(process.env.ADB_BIN||"adb");
const originalListen=express.application.listen;
let installed=false;

function adbEnv(){return {...process.env,HOME:ROOT,ANDROID_USER_HOME:ROOT}}
async function adb(args,timeout=180000){
  try{return await execFileAsync(ADB,args,{timeout,maxBuffer:8*1024*1024,env:adbEnv()})}
  catch(error){const e=Error(String(error.stderr||error.stdout||error.message||"ADB command failed").trim());e.code=error.code;throw e}
}
function sha256(file){const h=crypto.createHash("sha256");h.update(fs.readFileSync(file));return h.digest("hex")}
function artifact(){
  if(!fs.existsSync(APK)||!fs.existsSync(META))return {available:false,readable:false,error:"Current Android agent artifact has not been staged"};
  try{
    fs.accessSync(APK,fs.constants.R_OK);
    const meta=JSON.parse(fs.readFileSync(META,"utf8"));
    const actualSha=sha256(APK);
    const valid=meta.package==="org.classroomhub.display"&&typeof meta.versionName==="string"&&meta.versionName&&Number.isInteger(Number(meta.versionCode))&&meta.sha256===actualSha&&/^[0-9a-f]{64}$/i.test(String(meta.signerSha256||""));
    return {
      available:valid,
      readable:true,
      package:meta.package||null,
      versionName:meta.versionName||null,
      versionCode:Number(meta.versionCode)||null,
      sha256:actualSha,
      signerSha256:meta.signerSha256||null,
      signingMode:meta.signingMode||null,
      sourceDigest:meta.sourceDigest||null,
      source:meta.source||null,
      stagedAt:meta.stagedAt||null,
      verified:valid,
      error:valid?null:"Staged Android agent metadata does not match the APK"
    };
  }catch(error){return {available:false,readable:false,verified:false,error:error.message}}
}
function device(id){const d=STORE.getDevice(id);if(!d){const e=Error("Managed Android display not found");e.status=404;throw e}return d}
function signatureMismatch(error){return /INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures? do not match|previously installed version has a different signature/i.test(String(error?.message||""))}
async function restoreAgentConfiguration(d){
  const pkg=cleanPackage(d.agentPackage||"org.classroomhub.display");
  if(d.agentV2?.token){
    await configure(d,{});
  }else if(/^https?:\/\//i.test(String(d.displayUrl||""))){
    await adb(["-s",d.serial,"shell","am","broadcast","-a","org.classroomhub.display.CONFIGURE","-p",pkg,"--es","display_url",String(d.displayUrl)],20000);
  }
  try{await adb(["-s",d.serial,"shell","am","start","-W","-n",`${pkg}/.MainActivity`],20000)}catch{}
}
async function installCurrent(d,{replaceExisting=false}={}){
  const info=artifact();
  if(!info.available){const e=Error(info.error||"Current Android agent artifact is unavailable");e.status=503;throw e}
  const pkg=cleanPackage(d.agentPackage||info.package||"org.classroomhub.display");
  let replacedExisting=false;
  try{
    await adb(["-s",d.serial,"install","-r","-g",APK]);
  }catch(error){
    if(!signatureMismatch(error))throw error;
    if(!replaceExisting){
      const e=Error("The installed Classroom Hub agent uses a different signing identity. One-time replacement is required to adopt the appliance-managed signing key.");
      e.status=409;e.code="signature_transition_required";throw e;
    }
    await adb(["-s",d.serial,"uninstall",pkg],60000);
    await adb(["-s",d.serial,"install","-g",APK]);
    replacedExisting=true;
  }
  await restoreAgentConfiguration(d);
  return {installed:true,replacedExisting,artifact:info,message:`Installed Classroom Hub Display Agent ${info.versionName}${replacedExisting?" using the new persistent appliance signing identity":""}.`};
}
function route(fn){return (req,res)=>Promise.resolve(fn(req,res)).catch(error=>res.status(error.status||500).json({ok:false,code:error.code||undefined,error:error.message}))}
function installRoutes(app){
  if(installed)return;installed=true;
  app.get("/android/agent/artifact",(_req,res)=>{const info=artifact();res.status(info.available?200:503).json({ok:info.available,artifact:info,error:info.error||undefined})});
  app.post("/android/devices/:id/agent/artifact/install",route(async(req,res)=>{
    const result=await installCurrent(device(req.params.id),{replaceExisting:req.body?.replaceExisting===true});
    res.json({ok:true,deviceId:req.params.id,...result});
  }));
}
express.application.listen=function(...args){installRoutes(this);return originalListen.apply(this,args)};
module.exports={artifact,installCurrent,installRoutes};
