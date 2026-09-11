"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");

const DEVICE_ID_RE=/^[a-zA-Z0-9._-]{1,96}$/;
const HOST_RE=/^[a-zA-Z0-9._:-]{1,255}$/;
const PACKAGE_RE=/^[A-Za-z][A-Za-z0-9_.]{1,199}$/;
const AGENT_TOKEN_RE=/^[a-f0-9]{64}$/i;
const KEYEVENTS={
  power:"KEYCODE_POWER",wake:"KEYCODE_WAKEUP",sleep:"KEYCODE_SLEEP",home:"KEYCODE_HOME",back:"KEYCODE_BACK",
  up:"KEYCODE_DPAD_UP",down:"KEYCODE_DPAD_DOWN",left:"KEYCODE_DPAD_LEFT",right:"KEYCODE_DPAD_RIGHT",select:"KEYCODE_DPAD_CENTER",
  volume_up:"KEYCODE_VOLUME_UP",volume_down:"KEYCODE_VOLUME_DOWN",mute:"KEYCODE_VOLUME_MUTE",play_pause:"KEYCODE_MEDIA_PLAY_PAUSE"
};
const DEFAULT_PROFILE={
  id:"classroom-standard",name:"Standard Classroom Display",launchOnBoot:true,kiosk:true,keepAwake:true,
  wakeTime:"00:00",sleepTime:"00:00",timezone:"America/New_York",defaultVolume:35,
  recovery:{restartDisplay:true,reconnectAdb:true,rebootAfterFailures:5},
  permissions:{remoteShell:"administrator",screenshots:true,appInstall:true}
};

function boundedInt(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback}
function cleanId(value){const v=String(value||"").trim();if(!DEVICE_ID_RE.test(v))throw Error("Invalid device id");return v}
function cleanHost(value){const v=String(value||"").trim();if(!HOST_RE.test(v)||v.includes(".."))throw Error("Invalid device host");return v}
function cleanPort(value,fallback=5555){return boundedInt(value,fallback,1,65535)}
function cleanSerial(value){const v=String(value||"").trim();if(!/^[A-Za-z0-9._:-]{1,300}$/.test(v))throw Error("Invalid ADB serial");return v}
function cleanPackage(value){const v=String(value||"").trim();if(!PACKAGE_RE.test(v))throw Error("Invalid Android package name");return v}
function cleanText(value,max=160){return String(value||"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max)}
function cleanShell(value){const v=String(value||"");if(!v.trim())throw Error("Shell command is required");if(v.length>8000||v.includes("\0"))throw Error("Shell command is too large or invalid");return v}
function makeId(prefix="display"){return `${prefix}_${crypto.randomBytes(8).toString("hex")}`}
function now(){return new Date().toISOString()}

function normalizeProfile(input={}){
  const base={...DEFAULT_PROFILE,...input};
  const id=cleanId(base.id||DEFAULT_PROFILE.id);
  const standard=id===DEFAULT_PROFILE.id;
  return {id,name:cleanText(base.name||id,120),launchOnBoot:base.launchOnBoot!==false,kiosk:base.kiosk!==false,keepAwake:base.keepAwake!==false,
    wakeTime:standard?"00:00":(/^([01]\d|2[0-3]):[0-5]\d$/.test(String(base.wakeTime||""))?String(base.wakeTime):"07:00"),
    sleepTime:standard?"00:00":(/^([01]\d|2[0-3]):[0-5]\d$/.test(String(base.sleepTime||""))?String(base.sleepTime):"16:00"),
    timezone:cleanText(base.timezone||"America/New_York",80),defaultVolume:boundedInt(base.defaultVolume,35,0,100),
    recovery:{restartDisplay:base.recovery?.restartDisplay!==false,reconnectAdb:base.recovery?.reconnectAdb!==false,rebootAfterFailures:boundedInt(base.recovery?.rebootAfterFailures,5,1,20)},
    permissions:{remoteShell:cleanText(base.permissions?.remoteShell||"administrator",40),screenshots:base.permissions?.screenshots!==false,appInstall:base.permissions?.appInstall!==false}};
}

function normalizePersistentAdb(input,devicePort){
  if(!input||typeof input!=="object")return {enabled:false,targetPort:cleanPort(devicePort,5555),bootRestore:false,bootstrapAt:null,disabledAt:null};
  return {enabled:input.enabled===true,targetPort:cleanPort(input.targetPort,cleanPort(devicePort,5555)),bootRestore:input.bootRestore===true,bootstrapAt:input.bootstrapAt?cleanText(input.bootstrapAt,80):null,disabledAt:input.disabledAt?cleanText(input.disabledAt,80):null};
}

function normalizeAgentV2(input){
  if(!input||typeof input!=="object")return null;
  const rawToken=String(input.token||"").trim();
  if(!AGENT_TOKEN_RE.test(rawToken))return null;
  return {enabled:input.enabled!==false,port:cleanPort(input.port,8765),token:rawToken.toLowerCase(),configuredAt:input.configuredAt?cleanText(input.configuredAt,80):null};
}

function normalizeDevice(input={}){
  const id=cleanId(input.id||makeId());const host=cleanHost(input.host);const port=cleanPort(input.port,5555);const serial=cleanSerial(input.serial||`${host}:${port}`);
  return {id,name:cleanText(input.name||id,120),host,port,serial,organization:cleanText(input.organization,120),school:cleanText(input.school,120),building:cleanText(input.building,120),room:cleanText(input.room,80),
    profileId:cleanId(input.profileId||DEFAULT_PROFILE.id),platform:"android-tv",provider:cleanText(input.provider||"android-adb",60),model:cleanText(input.model,160),manufacturer:cleanText(input.manufacturer,120),androidVersion:cleanText(input.androidVersion,60),sdk:cleanText(input.sdk,20),build:cleanText(input.build,160),agentPackage:cleanPackage(input.agentPackage||"org.roomgoblin.display"),agentVersion:cleanText(input.agentVersion,40),displayUrl:cleanText(input.displayUrl,500),
    persistentAdb:normalizePersistentAdb(input.persistentAdb,port),agentV2:normalizeAgentV2(input.agentV2),enabled:input.enabled!==false,createdAt:String(input.createdAt||now()),updatedAt:now(),lastSeenAt:input.lastSeenAt||null,lastStatus:input.lastStatus||null};
}

// Device Agent v2 credentials are appliance-internal control credentials. Keep
// them in the persistent inventory for outbound requests, but never serialize
// the raw token into an HTTP response consumed by the administrator browser.
function publicDevice(device){
  if(!device||typeof device!=="object")return device;
  const out={...device};
  if(device.agentV2&&typeof device.agentV2==="object"){
    const {token,...agentV2}=device.agentV2;
    out.agentV2={...agentV2,tokenConfigured:Boolean(token)};
  }
  return out;
}

class JsonStore{
  constructor(root){this.root=path.resolve(root);this.file=path.join(this.root,"devices.json");}
  load(){
    fs.mkdirSync(this.root,{recursive:true,mode:0o2770});
    let data={version:1,devices:[],profiles:[DEFAULT_PROFILE]};
    if(fs.existsSync(this.file)){
      try{data=JSON.parse(fs.readFileSync(this.file,"utf8"))}
      catch(error){const e=Error(`Managed display inventory is unreadable: ${error.message}`);e.code=error.code;throw e}
    }
    const profiles=(Array.isArray(data.profiles)?data.profiles:[]).map(normalizeProfile);if(!profiles.some(x=>x.id===DEFAULT_PROFILE.id))profiles.unshift(normalizeProfile(DEFAULT_PROFILE));
    const devices=[];for(const raw of Array.isArray(data.devices)?data.devices:[]){try{devices.push(normalizeDevice(raw))}catch{}}
    return {version:1,devices,profiles};
  }
  save(data){
    fs.mkdirSync(this.root,{recursive:true,mode:0o2770});
    const tmp=`${this.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp,JSON.stringify(data,null,2)+"\n",{mode:0o660});
    fs.renameSync(tmp,this.file);
    fs.chmodSync(this.file,0o660);
    return data;
  }
  list(){return this.load()}
  upsertDevice(device){const data=this.load(),normalized=normalizeDevice(device),i=data.devices.findIndex(x=>x.id===normalized.id);if(i>=0)data.devices[i]={...data.devices[i],...normalized,createdAt:data.devices[i].createdAt};else data.devices.push(normalized);this.save(data);return normalized;}
  deleteDevice(id){id=cleanId(id);const data=this.load(),before=data.devices.length;data.devices=data.devices.filter(x=>x.id!==id);this.save(data);return before!==data.devices.length;}
  getDevice(id){id=cleanId(id);return this.load().devices.find(x=>x.id===id)||null;}
  upsertProfile(profile){const data=this.load(),p=normalizeProfile(profile),i=data.profiles.findIndex(x=>x.id===p.id);if(i>=0)data.profiles[i]=p;else data.profiles.push(p);this.save(data);return p;}
}

function adbArgsForAction(device,action,payload={}){
  const serial=cleanSerial(device.serial);const key=KEYEVENTS[action];if(key)return ["-s",serial,"shell","input","keyevent",key];
  if(action==="reboot")return ["-s",serial,"reboot"];
  if(action==="screenshot")return ["-s",serial,"exec-out","screencap","-p"];
  if(action==="launch")return ["-s",serial,"shell","monkey","-p",cleanPackage(payload.package||device.agentPackage),"-c","android.intent.category.LAUNCHER","1"];
  if(action==="stop")return ["-s",serial,"shell","am","force-stop",cleanPackage(payload.package||device.agentPackage)];
  if(action==="url")return ["-s",serial,"shell","am","start","-a","android.intent.action.VIEW","-d",String(payload.url||"").slice(0,1500)];
  throw Error(`Unsupported Android action: ${action}`);
}

module.exports={DEFAULT_PROFILE,KEYEVENTS,JsonStore,normalizeProfile,normalizePersistentAdb,normalizeAgentV2,normalizeDevice,publicDevice,cleanId,cleanHost,cleanPort,cleanSerial,cleanPackage,cleanShell,cleanText,makeId,adbArgsForAction};
