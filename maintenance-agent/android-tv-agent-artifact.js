"use strict";

const express=require("express");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {execFile,execFileSync}=require("child_process");
const {promisify}=require("util");
const execFileAsync=promisify(execFile);
const {STORE}=require("./android-tv-extension");
const {configure}=require("./android-tv-agent-v2");
const {cleanPackage}=require("./android-tv-lib");

const ROOT=path.resolve(process.env.ANDROID_TV_DATA_ROOT||"/managed/classroom-hub/data/android-tv");
const APK=path.join(ROOT,"ClassroomHub-Display-Agent.apk");
const META=path.join(ROOT,"ClassroomHub-Display-Agent.json");
const BUNDLE_APK=path.resolve(process.env.ANDROID_AGENT_BUNDLE_APK||"/app/android-agent/agent-release-unsigned.apk");
const BUNDLE_META=path.resolve(process.env.ANDROID_AGENT_BUNDLE_META||"/app/android-agent/agent-build.json");
const SIGNING_ROOT=path.resolve(process.env.ANDROID_AGENT_SIGNING_ROOT||"/signing/android-agent");
const KEYSTORE=path.join(SIGNING_ROOT,"ClassroomHub-Display-Agent.keystore");
const PASSWORD_FILE=path.join(SIGNING_ROOT,"password");
const KEY_ALIAS="classroom-hub";
const ADB=String(process.env.ADB_BIN||"adb");
const originalListen=express.application.listen;
let installed=false;

function adbEnv(){return {...process.env,HOME:ROOT,ANDROID_USER_HOME:ROOT}}
async function adb(args,timeout=180000){
  try{return await execFileAsync(ADB,args,{timeout,maxBuffer:8*1024*1024,env:adbEnv()})}
  catch(error){const e=Error(String(error.stderr||error.stdout||error.message||"ADB command failed").trim());e.code=error.code;throw e}
}
function command(file,args,opts={}){return execFileSync(file,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"],maxBuffer:8*1024*1024,...opts})}
function sha256(file){const h=crypto.createHash("sha256");h.update(fs.readFileSync(file));return h.digest("hex")}
function json(file,label){try{return JSON.parse(fs.readFileSync(file,"utf8"))}catch(error){throw Error(`${label} metadata is invalid: ${error.message}`)}}
function safeWriteSecret(file,value){fs.writeFileSync(file,value,{encoding:"utf8",mode:0o600,flag:"wx"});fs.chmodSync(file,0o600)}
function signerDigest(apk){
  const output=command("apksigner",["verify","--verbose","--print-certs",apk]);
  const match=String(output).match(/Signer #1 certificate SHA-256 digest:\s*([0-9a-f]{64})/i);
  if(!match)throw Error("Unable to verify Android agent signing certificate digest");
  return match[1].toLowerCase();
}
function ensureSigningIdentity(){
  fs.mkdirSync(SIGNING_ROOT,{recursive:true,mode:0o700});
  fs.chmodSync(SIGNING_ROOT,0o700);
  if(fs.existsSync(KEYSTORE)!==fs.existsSync(PASSWORD_FILE))throw Error("Android agent signing identity is incomplete; restore the signing directory instead of generating over partial state");
  if(!fs.existsSync(KEYSTORE)){
    const password=crypto.randomBytes(24).toString("hex");
    safeWriteSecret(PASSWORD_FILE,`${password}\n`);
    try{
      command("keytool",["-genkeypair","-keystore",KEYSTORE,"-storepass",password,"-keypass",password,"-alias",KEY_ALIAS,"-keyalg","RSA","-keysize","3072","-validity","10000","-dname","CN=Classroom Control Hub Android Agent,O=Classroom Control Hub"]);
      fs.chmodSync(KEYSTORE,0o600);
    }catch(error){try{fs.rmSync(PASSWORD_FILE,{force:true})}catch{};try{fs.rmSync(KEYSTORE,{force:true})}catch{};throw error}
    console.warn("Created persistent appliance Android agent signing identity.");
  }
  fs.chmodSync(KEYSTORE,0o600);fs.chmodSync(PASSWORD_FILE,0o600);
  const password=fs.readFileSync(PASSWORD_FILE,"utf8").trim();
  if(password.length<32)throw Error("Android agent signing password is invalid");
  return password;
}
function signApk(unsignedCopy,signedTemp,password){
  // apksigner treats each file: password source as a consumable stream. Reusing
  // one single-line password file for both --ks-pass and --key-pass causes the
  // second read to hit EOF. Use two ephemeral environment-backed sources instead;
  // this also keeps the password out of argv and avoids weakening file permissions.
  const env={...process.env,CLASSROOM_HUB_APK_KS_PASS:password,CLASSROOM_HUB_APK_KEY_PASS:password};
  command("apksigner",["sign","--ks",KEYSTORE,"--ks-key-alias",KEY_ALIAS,"--ks-pass","env:CLASSROOM_HUB_APK_KS_PASS","--key-pass","env:CLASSROOM_HUB_APK_KEY_PASS","--out",signedTemp,unsignedCopy],{env});
}
function ensureCurrentArtifact(){
  if(!fs.existsSync(BUNDLE_APK)||!fs.existsSync(BUNDLE_META))throw Error("Maintenance image does not contain the current Android agent build artifact");
  const bundle=json(BUNDLE_META,"Bundled Android agent");
  const bundleSha=sha256(BUNDLE_APK);
  if(bundle.package!=="org.classroomhub.display"||!bundle.versionName||!Number.isInteger(Number(bundle.versionCode))||bundle.unsignedSha256!==bundleSha)throw Error("Bundled Android agent metadata does not match the current maintenance-image APK");
  fs.mkdirSync(ROOT,{recursive:true,mode:0o770});
  const password=ensureSigningIdentity();

  if(fs.existsSync(APK)&&fs.existsSync(META)){
    try{
      const current=json(META,"Staged Android agent");
      const currentSha=sha256(APK);
      const currentSigner=signerDigest(APK);
      if(current.package===bundle.package&&current.versionName===bundle.versionName&&Number(current.versionCode)===Number(bundle.versionCode)&&current.bundleSha256===bundleSha&&current.sha256===currentSha&&current.signerSha256===currentSigner&&current.signingMode==="persistent-per-appliance"){
        try{fs.chmodSync(APK,0o660);fs.chmodSync(META,0o660)}catch{}
        return;
      }
    }catch(error){console.warn(`Restaging Android agent artifact: ${error.message}`)}
  }

  const unsignedCopy=path.join(ROOT,`.ClassroomHub-Display-Agent.unsigned.${process.pid}.apk`);
  const signedTemp=path.join(ROOT,`.ClassroomHub-Display-Agent.signed.${process.pid}.apk`);
  try{
    fs.copyFileSync(BUNDLE_APK,unsignedCopy);fs.chmodSync(unsignedCopy,0o600);
    signApk(unsignedCopy,signedTemp,password);
    command("apksigner",["verify","--verbose",signedTemp]);
    const signedSha=sha256(signedTemp),signerSha=signerDigest(signedTemp);
    fs.chmodSync(signedTemp,0o660);
    try{fs.chownSync(signedTemp,0,10001)}catch(error){if(error.code!=="EPERM")throw error}
    fs.renameSync(signedTemp,APK);
    const metadata={package:bundle.package,versionName:bundle.versionName,versionCode:Number(bundle.versionCode),bundleSha256:bundleSha,sha256:signedSha,signerSha256:signerSha,signingMode:"persistent-per-appliance",source:"maintenance-image-current-android-source",stagedAt:new Date().toISOString()};
    const metaTemp=`${META}.${process.pid}.tmp`;
    fs.writeFileSync(metaTemp,`${JSON.stringify(metadata,null,2)}\n`,{mode:0o660});
    try{fs.chownSync(metaTemp,0,10001)}catch(error){if(error.code!=="EPERM")throw error}
    fs.renameSync(metaTemp,META);
    fs.chmodSync(APK,0o660);fs.chmodSync(META,0o660);
    console.warn(`Staged current Android Display Agent ${bundle.versionName} from the maintenance image.`);
  }finally{
    try{fs.rmSync(unsignedCopy,{force:true})}catch{}
    try{fs.rmSync(signedTemp,{force:true})}catch{}
  }
}
function artifact(){
  if(!fs.existsSync(APK)||!fs.existsSync(META))return {available:false,readable:false,error:"Current Android agent artifact has not been staged"};
  try{
    fs.accessSync(APK,fs.constants.R_OK);
    const meta=json(META,"Staged Android agent");
    const actualSha=sha256(APK);
    const bundle=fs.existsSync(BUNDLE_META)?json(BUNDLE_META,"Bundled Android agent"):null;
    const bundleSha=fs.existsSync(BUNDLE_APK)?sha256(BUNDLE_APK):null;
    const valid=meta.package==="org.classroomhub.display"&&typeof meta.versionName==="string"&&meta.versionName&&Number.isInteger(Number(meta.versionCode))&&meta.sha256===actualSha&&/^[0-9a-f]{64}$/i.test(String(meta.signerSha256||""))&&!!bundle&&meta.versionName===bundle.versionName&&Number(meta.versionCode)===Number(bundle.versionCode)&&meta.bundleSha256===bundleSha;
    return {available:valid,readable:true,package:meta.package||null,versionName:meta.versionName||null,versionCode:Number(meta.versionCode)||null,sha256:actualSha,signerSha256:meta.signerSha256||null,signingMode:meta.signingMode||null,bundleSha256:meta.bundleSha256||null,source:meta.source||null,stagedAt:meta.stagedAt||null,verified:valid,error:valid?null:"Staged Android agent does not match the current maintenance-image build"};
  }catch(error){return {available:false,readable:false,verified:false,error:error.message}}
}
function device(id){const d=STORE.getDevice(id);if(!d){const e=Error("Managed Android display not found");e.status=404;throw e}return d}
function signatureMismatch(error){return /INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures? do not match|previously installed version has a different signature/i.test(String(error?.message||""))}
async function restoreTrustedGrants(d,pkg){
  const result={writeSecureSettings:false};
  if(d.persistentAdb?.enabled===true){
    try{await adb(["-s",d.serial,"shell","pm","grant",pkg,"android.permission.WRITE_SECURE_SETTINGS"],15000);result.writeSecureSettings=true}catch(error){result.writeSecureSettingsError=error.message}
  }
  return result;
}
async function restoreAgentConfiguration(d){
  const pkg=cleanPackage(d.agentPackage||"org.classroomhub.display");
  const grants=await restoreTrustedGrants(d,pkg);
  if(d.agentV2?.token)await configure(d,{});
  else if(/^https?:\/\//i.test(String(d.displayUrl||"")))await adb(["-s",d.serial,"shell","am","broadcast","-a","org.classroomhub.display.CONFIGURE","-p",pkg,"--es","display_url",String(d.displayUrl)],20000);
  try{await adb(["-s",d.serial,"shell","am","start","-W","-n",`${pkg}/.MainActivity`],20000)}catch{}
  return grants;
}
async function installCurrent(d,{replaceExisting=false}={}){
  const info=artifact();if(!info.available){const e=Error(info.error||"Current Android agent artifact is unavailable");e.status=503;throw e}
  const pkg=cleanPackage(d.agentPackage||info.package||"org.classroomhub.display");let replacedExisting=false;
  try{await adb(["-s",d.serial,"install","-r","-g",APK])}
  catch(error){
    if(!signatureMismatch(error))throw error;
    if(!replaceExisting){const e=Error("The installed Classroom Hub agent uses a different signing identity. One-time replacement is required to adopt the appliance-managed signing key.");e.status=409;e.code="signature_transition_required";throw e}
    await adb(["-s",d.serial,"uninstall",pkg],60000);await adb(["-s",d.serial,"install","-g",APK]);replacedExisting=true;
  }
  const grants=await restoreAgentConfiguration(d);
  return {installed:true,replacedExisting,grants,artifact:info,message:`Installed Classroom Hub Display Agent ${info.versionName}${replacedExisting?" using the new persistent appliance signing identity":""}.`};
}
function route(fn){return (req,res)=>Promise.resolve(fn(req,res)).catch(error=>res.status(error.status||500).json({ok:false,code:error.code||undefined,error:error.message}))}

// Fail maintenance startup instead of serving an old/missing APK as current.
ensureCurrentArtifact();

function installRoutes(app){
  if(installed)return;installed=true;
  app.get("/android/agent/artifact",(_req,res)=>{const info=artifact();res.status(info.available?200:503).json({ok:info.available,artifact:info,error:info.error||undefined})});
  app.post("/android/devices/:id/agent/artifact/install",route(async(req,res)=>{const result=await installCurrent(device(req.params.id),{replaceExisting:req.body?.replaceExisting===true});res.json({ok:true,deviceId:req.params.id,...result})}));
}
express.application.listen=function(...args){installRoutes(this);return originalListen.apply(this,args)};
module.exports={artifact,installCurrent,installRoutes,ensureCurrentArtifact};
