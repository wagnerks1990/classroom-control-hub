"use strict";

const express=require("express");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const ROOT=path.resolve(process.env.ANDROID_TV_DATA_ROOT||"/managed/classroom-hub/data/android-tv");
const APK=path.join(ROOT,"ClassroomHub-Display-Agent.apk");
const META=path.join(ROOT,"ClassroomHub-Display-Agent.json");
const originalListen=express.application.listen;
let installed=false;

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
function installRoutes(app){
  if(installed)return;installed=true;
  app.get("/android/agent/artifact",(_req,res)=>{const info=artifact();res.status(info.available?200:503).json({ok:info.available,artifact:info,error:info.error||undefined})});
}
express.application.listen=function(...args){installRoutes(this);return originalListen.apply(this,args)};
module.exports={artifact,installRoutes};
