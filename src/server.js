"use strict";

const express = require("express");
const {serviceUrl, serviceHost, validPort, localHttpUrl} = require("./network");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const dgram = require("dgram");
const net = require("net");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const scryptAsync = promisify(crypto.scrypt);
const multer = require("multer");
const mqtt = require("mqtt");
const { WebSocketServer, WebSocket } = require("ws");
const {rateLimit}=require("express-rate-limit");
const {sendspinEndpoint, relaySendspin} = require("./music-assistant-sendspin");
const {parseAllowedHosts:parseDisplayGatewayAllowedHosts}=require("./display-gateway");
const AdmZip = require("adm-zip");
const {ClassroomHubStorage,keyForFile} = require("./storage");
const {applicationVersion}=require("./version");
const {secureTokenEqual,capabilitiesFor,hasCapability:profileHasCapability}=require("./security");
const {defaultSchoolScheduleProfile,legacySchoolScheduleProfile,normalizeSchoolScheduleProfile,effectiveTimesForRule,groupForCycleDay,validTime}=require("./school-schedule");

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const PORT = validPort(process.env.PORT, 3000);
const BIND_ADDRESS = String(process.env.BIND_ADDRESS || "0.0.0.0").replace(/^\[|\]$/g, "");
localHttpUrl(PORT, BIND_ADDRESS); // Validate before opening listeners.
let SCHEDULER_TIMEZONE = String(process.env.SCHEDULER_TIMEZONE || process.env.TZ || "America/New_York").trim() || "America/New_York";
const SCHEDULER_CATCHUP_MINUTES = Math.max(0, Math.min(60, Number(process.env.SCHEDULER_CATCHUP_MINUTES || 5)));
process.env.TZ = SCHEDULER_TIMEZONE;
const ROOM_NAME = String(process.env.ROOM_NAME || "Classroom");
const APPLICATION_VERSION = applicationVersion();

let MQTT_URL = serviceUrl(process.env.MQTT_URL || "", ["mosquitto"]).trim();
let MQTT_USERNAME = String(process.env.MQTT_USERNAME || "");
let MQTT_PASSWORD = String(process.env.MQTT_PASSWORD || "");
let MQTT_LEGACY_BRIDGE =
  String(process.env.MQTT_LEGACY_BRIDGE || "true").toLowerCase() === "true";
let MQTT_JSON_BRIDGE =
  String(process.env.MQTT_JSON_BRIDGE || "true").toLowerCase() === "true";

// v0.8 direct hardware integrations. Node-RED is no longer required.
const HARDWARE_CONFIG_FILE = path.join(path.resolve(__dirname, ".."), "config", "hardware.json");
let PLUTO_URL = String(process.env.PLUTO_URL || "").trim();
let PLUTO_TIMEOUT_MS = Number(process.env.PLUTO_TIMEOUT_MS || 4000);
let PLUTO_READ_RETRIES = Number(process.env.PLUTO_READ_RETRIES || 4);

const CONTROL_TOKEN = String(process.env.CONTROL_TOKEN || "");
const SETUP_TOKEN = String(process.env.SETUP_TOKEN || "");
const MAINTENANCE_PROXY_ENABLED = String(process.env.MAINTENANCE_PROXY_ENABLED || "false").toLowerCase() === "true";
const CORS_ALLOWED_ORIGINS = new Set(String(process.env.CORS_ALLOWED_ORIGINS || "").split(",").map(x=>x.trim()).filter(Boolean));
const WS_MAX_PAYLOAD_BYTES = Math.max(1024*1024,Math.min(16*1024*1024,Number(process.env.WS_MAX_PAYLOAD_MB||12)*1024*1024));
const MAINTENANCE_URL = serviceUrl(process.env.MAINTENANCE_URL || "http://127.0.0.1:3010", ["maintenance-agent", "classroom-control-hub-maintenance"]).replace(/\/$/,"");
const MAINTENANCE_TOKEN = String(process.env.MAINTENANCE_TOKEN || "");
const TRUST_PROXY_HOPS = Math.max(0, Math.min(5, Number(process.env.TRUST_PROXY_HOPS || 0)));
const DISPLAY_GATEWAY_HOSTS=[...parseDisplayGatewayAllowedHosts()].sort();
const LOGIN_MAX_ATTEMPTS = Math.max(3, Math.min(20, Number(process.env.LOGIN_MAX_ATTEMPTS || 5)));
const LOGIN_WINDOW_MS = Math.max(60000, Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000));
const LOGIN_LOCK_MS = Math.max(60000, Number(process.env.LOGIN_LOCK_MS || 15 * 60 * 1000));

// Veyon becomes the lab-computer control plane in v0.20.0.
let VEYON_WEBAPI_URL = serviceUrl(process.env.VEYON_WEBAPI_URL || "http://127.0.0.1:11080", ["veyon-webapi"]).replace(/\/$/,"");
let VEYON_KEY_NAME = String(process.env.VEYON_KEY_NAME || "ClassroomControlHub");
const VEYON_PRIVATE_KEY_FILE = String(process.env.VEYON_PRIVATE_KEY_FILE || "/run/secrets/veyon-private-key");
let VEYON_SCAN_SUBNET = String(process.env.VEYON_SCAN_SUBNET || "").replace(/\.$/,"");
let VEYON_SCAN_START = Math.max(1,Math.min(254,Number(process.env.VEYON_SCAN_START||1)));
let VEYON_SCAN_END = Math.max(VEYON_SCAN_START,Math.min(254,Number(process.env.VEYON_SCAN_END||254)));
let VEYON_POOL_MAX = Math.max(4,Math.min(128,Number(process.env.VEYON_POOL_MAX||24)));
let VEYON_AUTH_RETRIES = Math.max(0,Math.min(5,Number(process.env.VEYON_AUTH_RETRIES||2)));
let VEYON_THUMBNAIL_CONCURRENCY = Math.max(2,Math.min(24,Number(process.env.VEYON_THUMBNAIL_CONCURRENCY||8)));
const VEYON_AUTHKEYS_UUID = "0c69b301-81b4-42d6-8fae-128cdd113314";
const VEYON_FEATURES = Object.freeze({
  screenLock:"ccb535a2-1d24-4cc1-a709-8b47d2b2ac79",
  inputLock:"e4a77879-e544-4fec-bc18-e534f33b934c",
  userLogin:"7310707d-3918-460d-a949-65bd152cb958",
  userLogoff:"7311d43d-ab53-439e-a03a-8cb25f7ed526",
  reboot:"4f7d98f0-395a-4fff-b968-e49b8d0f748c",
  powerDown:"6f5a27a0-0e2f-496e-afcc-7aae62eede10",
  demoServer:"e4b6e743-1f5b-491d-9364-e091086200f4",
  fullScreenDemoClient:"7b6231bd-eb89-45d3-af32-f70663b2f878",
  windowDemoClient:"ae45c3db-dc2e-4204-ae8b-374cdab8c62c",
  startApp:"da9ca56a-b2ad-4fff-8f8a-929b2927b442",
  openWebsite:"8a11a75d-b3db-48b6-b9cb-f8422ddd5b0c",
  textMessage:"e75ae9c8-ac17-4d00-8f0d-019348346208"
});

const VEYON_COMMAND_POLICY = Object.freeze({
  reboot:{requiresUser:false}, powerDown:{requiresUser:false}, userLogin:{requiresUser:false},
  userLogoff:{requiresUser:true}, textMessage:{requiresUser:true}, openWebsite:{requiresUser:true},
  startApp:{requiresUser:true}, screenLock:{requiresUser:true}, inputLock:{requiresUser:true},
  demoServer:{requiresUser:true}, fullScreenDemoClient:{requiresUser:true}, windowDemoClient:{requiresUser:true}
});
function veyonPolicyFor(feature,active=true){
  if(active===false&&["screenLock","inputLock","demoServer","fullScreenDemoClient","windowDemoClient"].includes(feature))
    return {requiresUser:false,recovery:true};
  return VEYON_COMMAND_POLICY[feature]||{requiresUser:true};
}
async function veyonCommandEligibility(rec,feature,active=true){
  const online=await veyonTcpProbe(rec.ip);
  if(!online)return {eligible:false,reason:"offline"};
  const policy=veyonPolicyFor(feature,active);
  if(!policy.requiresUser)return {eligible:true};
  try{
    const info=await veyonComputerInfo(rec.ip);
    if(!String(info?.user?.login||"").trim())return {eligible:false,reason:"no-user-session"};
    return {eligible:true,user:info.user};
  }catch(err){return {eligible:false,reason:"status-check-failed",error:err.message}}
}

const LAB_AGENT_TOKEN = String(process.env.LAB_AGENT_TOKEN || "");
let LAB_HISTORY_RETENTION_HOURS = Math.max(0, Math.min(24*365, Number(process.env.LAB_HISTORY_RETENTION_HOURS || 0)));
let LAB_SCREENSHOT_RETENTION_DAYS = Math.max(1, Math.min(365, Number(process.env.LAB_SCREENSHOT_RETENTION_DAYS || 7)));
const LAB_AI_MONITOR_ENABLED = String(process.env.LAB_AI_MONITOR_ENABLED || "true").toLowerCase() !== "false";
const LAB_AI_ALERT_COOLDOWN_MINUTES = Math.max(1, Math.min(1440, Number(process.env.LAB_AI_ALERT_COOLDOWN_MINUTES || 10)));
const DISPLAY_TOKEN = String(process.env.DISPLAY_TOKEN || "");
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 500);
const DEVICE_OFFLINE_SECONDS = Number(process.env.DEVICE_OFFLINE_SECONDS || 45);

const APP_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(APP_DIR, "data"));
const MEDIA_DIR = path.join(DATA_DIR, "media");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit.jsonl");
const DEVICE_CONFIG_FILE = path.join(APP_DIR, "config", "devices.json");
const SCENES_FILE = path.join(DATA_DIR, "scenes.json");
const RUNTIME_CONFIG_FILE = path.join(DATA_DIR, "runtime-config.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const PLUTO_SCHEDULES_FILE = path.join(DATA_DIR, "pluto-schedules.json");
const AV_LABELS_FILE = path.join(DATA_DIR, "av-labels.json");
const MEDIA_LIBRARY_FILE = path.join(DATA_DIR, "media-library.json");
const AUTOMATIONS_FILE = path.join(DATA_DIR, "automations.json");
const SCHEDULER_CALENDAR_FILE = path.join(DATA_DIR, "scheduler-calendar.json");
const MORNING_ANNOUNCEMENTS_FILE = path.join(DATA_DIR, "morning-announcements.json");
const GOVEE_DISCOVERY_FILE = path.join(DATA_DIR, "govee-discovery.json");
const GOVEE_RECONCILE_GRACE_MS = 10 * 60 * 1000;
const PRESENTATIONS_DIR = path.join(DATA_DIR, "presentations");
const PRESENTATION_UPLOAD_TMP = path.join(DATA_DIR, "presentation-upload-tmp");
const PRESENTATION_LIBRARY_FILE = path.join(DATA_DIR, "presentation-library.json");
const PRESENTATION_STATE_FILE = path.join(DATA_DIR, "presentation-state.json");
const VEYON_COMPUTERS_FILE = path.join(DATA_DIR, "veyon-computers.json");
const CLASS_SCHEDULES_FILE = path.join(DATA_DIR, "class-schedules.json");
const LAB_COMPUTERS_FILE = path.join(DATA_DIR, "lab-computers.json");
const LAB_HISTORY_FILE = path.join(DATA_DIR, "lab-history.json");
const LAB_SCREENSHOT_DIR = path.join(DATA_DIR, "lab-screenshots");
const LAB_UPDATE_DIR = path.join(DATA_DIR, "lab-updates");
const LAB_AI_ALERTS_FILE = path.join(DATA_DIR, "lab-ai-alerts.json");
const LAB_AI_RULES_FILE = path.join(DATA_DIR, "lab-ai-rules.json");
fs.mkdirSync(LAB_SCREENSHOT_DIR,{recursive:true});
fs.mkdirSync(LAB_UPDATE_DIR,{recursive:true});
const SESSION_EFFECT_INTERVAL_MS = Number(process.env.SESSION_EFFECT_INTERVAL_MS || 4500);
// The retired participation experience contains classroom-specific targets.
// Keep it quarantined until it is replaced by database-backed session templates.
const SESSION_MAX_QUEUE = Number(process.env.SESSION_MAX_QUEUE || 80);
const SESSION_EFFECT_DURATION_MS = Number(process.env.SESSION_EFFECT_DURATION_MS || 7000);
const SESSION_CLEAR_GAP_MS = Number(process.env.SESSION_CLEAR_GAP_MS || 1200);
const SESSION_SPOTLIGHT_ROTATE_MS = Number(process.env.SESSION_SPOTLIGHT_ROTATE_MS || 9000);

fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(PRESENTATIONS_DIR, { recursive: true });
fs.mkdirSync(PRESENTATION_UPLOAD_TMP, { recursive: true });

const DATABASE_FILE = String(process.env.DATABASE_FILE || path.join(DATA_DIR,"classroom-control-hub.db"));
const MASTER_KEY_FILE = String(process.env.MASTER_KEY_FILE || "/run/secrets/classroom-control-hub-master-key");
const LEGACY_JSON_MIRROR = String(process.env.LEGACY_JSON_MIRROR || "false").toLowerCase()==="true";
const dbStore = new ClassroomHubStorage({dataDir:DATA_DIR,dbFile:DATABASE_FILE,masterKeyFile:MASTER_KEY_FILE,legacyMirror:LEGACY_JSON_MIRROR});
function normalizedTimezone(value){
  const timezone=String(value||"").trim();
  try{new Intl.DateTimeFormat("en-US",{timeZone:timezone}).format(new Date())}catch{throw Error("Timezone must be a valid IANA timezone, for example America/New_York")}
  return timezone;
}
try{
  const storedTimezone=dbStore.getSetting("site.profile",{})?.timezone;
  if(storedTimezone)SCHEDULER_TIMEZONE=normalizedTimezone(storedTimezone);
  process.env.TZ=SCHEDULER_TIMEZONE;
}catch(error){console.warn(`Stored scheduler timezone ignored: ${error.message}`)}
function privacyRetentionPolicy(){const p=dbStore.getPreference("privacy.retention",{})||{},rawHistory=p.browserHistoryHours===undefined?LAB_HISTORY_RETENTION_HOURS:Number(p.browserHistoryHours);return {browserHistoryEnabled:p.browserHistoryEnabled===true,browserHistoryHours:Number.isFinite(rawHistory)?Math.max(0,Math.min(24*365,rawHistory)):0,screenshotDays:Math.max(1,Math.min(365,Number(p.screenshotDays)||LAB_SCREENSHOT_RETENTION_DAYS)),alertDays:Math.max(1,Math.min(365,Number(p.alertDays)||30)),auditDays:Math.max(7,Math.min(3650,Number(p.auditDays)||180))}}
function applyPrivacyRetentionPolicy(){const p=privacyRetentionPolicy();LAB_HISTORY_RETENTION_HOURS=p.browserHistoryHours;LAB_SCREENSHOT_RETENTION_DAYS=p.screenshotDays;return p}
applyPrivacyRetentionPolicy();
try{if(MQTT_PASSWORD&&!dbStore.hasSecret("integration.mqtt.password"))dbStore.putSecret("integration.mqtt.password",MQTT_PASSWORD,{type:"integration-password",integration:"mqtt",migratedFrom:"environment"})}catch(err){console.warn(`MQTT password database migration skipped: ${err.message}`)}

function boundedNumber(value,fallback,min,max){const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):fallback}
function validHttpEndpoint(value,label,{allowBlank=true}={}){
  value=String(value||"").trim().replace(/\/$/,"");
  if(!value&&allowBlank)return "";
  let url;try{url=new URL(value)}catch{throw Error(`${label} must be a valid HTTP or HTTPS URL`)}
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw Error(`${label} must be an HTTP(S) URL without embedded credentials`);
  return value;
}
function validMqttEndpoint(value){
  value=String(value||"").trim();if(!value)return "";
  let url;try{url=new URL(value)}catch{throw Error("MQTT broker must be a valid mqtt, mqtts, ws, or wss URL")}
  if(!["mqtt:","mqtts:","ws:","wss:"].includes(url.protocol)||url.username||url.password)throw Error("MQTT broker must use mqtt, mqtts, ws, or wss without embedded credentials");
  return value;
}
function normalizedIntegrationConnections(value={},fallback={}){
  const mqttValue=value.mqtt||{},mqttFallback=fallback.mqtt||{};
  const plutoValue=value.pluto||{},plutoFallback=fallback.pluto||{};
  const veyonValue=value.veyon||{},veyonFallback=fallback.veyon||{};
  const scanSubnet=String(veyonValue.scanSubnet??veyonFallback.scanSubnet??"").trim().replace(/\.$/,"");
  const subnetParts=scanSubnet.split(".");
  if(scanSubnet&&(subnetParts.length!==3||subnetParts.some(x=>!/^\d{1,3}$/.test(x)||Number(x)>255)))throw Error("Veyon scan subnet must contain the first three IPv4 octets, for example 192.168.40");
  const scanStart=boundedNumber(veyonValue.scanStart,Number(veyonFallback.scanStart)||1,1,254);
  return {
    mqtt:{url:validMqttEndpoint(serviceUrl(mqttValue.url??mqttFallback.url??"", ["mosquitto"])),username:String(mqttValue.username??mqttFallback.username??"").trim(),jsonBridge:mqttValue.jsonBridge??mqttFallback.jsonBridge??true,legacyBridge:mqttValue.legacyBridge??mqttFallback.legacyBridge??true},
    pluto:{url:validHttpEndpoint(plutoValue.url??plutoFallback.url??"","Pluto endpoint"),timeoutMs:boundedNumber(plutoValue.timeoutMs,Number(plutoFallback.timeoutMs)||4000,500,30000),readRetries:boundedNumber(plutoValue.readRetries,Number(plutoFallback.readRetries)||4,0,10)},
    veyon:{url:validHttpEndpoint(serviceUrl(veyonValue.url??veyonFallback.url??"http://127.0.0.1:11080", ["veyon-webapi"]),"Veyon WebAPI endpoint",{allowBlank:false}),keyName:String(veyonValue.keyName??veyonFallback.keyName??"ClassroomControlHub").trim()||"ClassroomControlHub",scanSubnet,scanStart,scanEnd:boundedNumber(veyonValue.scanEnd,Number(veyonFallback.scanEnd)||254,scanStart,254),poolMax:boundedNumber(veyonValue.poolMax,Number(veyonFallback.poolMax)||24,4,128),authRetries:boundedNumber(veyonValue.authRetries,Number(veyonFallback.authRetries)||2,0,5),thumbnailConcurrency:boundedNumber(veyonValue.thumbnailConcurrency,Number(veyonFallback.thumbnailConcurrency)||8,2,24)}
  };
}
function currentIntegrationConnections(){return {mqtt:{url:MQTT_URL,username:MQTT_USERNAME,jsonBridge:MQTT_JSON_BRIDGE,legacyBridge:MQTT_LEGACY_BRIDGE},pluto:{url:PLUTO_URL,timeoutMs:PLUTO_TIMEOUT_MS,readRetries:PLUTO_READ_RETRIES},veyon:{url:VEYON_WEBAPI_URL,keyName:VEYON_KEY_NAME,scanSubnet:VEYON_SCAN_SUBNET,scanStart:VEYON_SCAN_START,scanEnd:VEYON_SCAN_END,poolMax:VEYON_POOL_MAX,authRetries:VEYON_AUTH_RETRIES,thumbnailConcurrency:VEYON_THUMBNAIL_CONCURRENCY}}}
function applyIntegrationConnections(value){
  MQTT_URL=value.mqtt.url;MQTT_USERNAME=value.mqtt.username;MQTT_JSON_BRIDGE=value.mqtt.jsonBridge!==false;MQTT_LEGACY_BRIDGE=value.mqtt.legacyBridge!==false;
  PLUTO_URL=value.pluto.url;PLUTO_TIMEOUT_MS=value.pluto.timeoutMs;PLUTO_READ_RETRIES=value.pluto.readRetries;
  VEYON_WEBAPI_URL=value.veyon.url;VEYON_KEY_NAME=value.veyon.keyName;VEYON_SCAN_SUBNET=value.veyon.scanSubnet;VEYON_SCAN_START=value.veyon.scanStart;VEYON_SCAN_END=value.veyon.scanEnd;VEYON_POOL_MAX=value.veyon.poolMax;VEYON_AUTH_RETRIES=value.veyon.authRetries;VEYON_THUMBNAIL_CONCURRENCY=value.veyon.thumbnailConcurrency;
  try{if(dbStore.hasSecret("integration.mqtt.password"))MQTT_PASSWORD=String(dbStore.getSecret("integration.mqtt.password")||"")}catch{}
}
function integrationConnectionsView(){return {...currentIntegrationConnections(),mqtt:{...currentIntegrationConnections().mqtt,passwordConfigured:dbStore.hasSecret("integration.mqtt.password")||Boolean(MQTT_PASSWORD)},veyon:{...currentIntegrationConnections().veyon,privateKeyConfigured:dbStore.hasSecret("veyon.private-key")||fs.existsSync(VEYON_PRIVATE_KEY_FILE)}}}
const storedIntegrationConnections=dbStore.getPreference("integrations.connections",null);
if(storedIntegrationConnections)applyIntegrationConnections(normalizedIntegrationConnections(storedIntegrationConnections,currentIntegrationConnections()));
else try{if(dbStore.hasSecret("integration.mqtt.password"))MQTT_PASSWORD=String(dbStore.getSecret("integration.mqtt.password")||"")}catch{}

function databaseBackedFile(file){
  const resolved=path.resolve(file);
  return resolved.startsWith(path.resolve(DATA_DIR)+path.sep) || resolved===path.resolve(DEVICE_CONFIG_FILE) || resolved===path.resolve(HARDWARE_CONFIG_FILE);
}
function readJson(file, fallback) {
  if(databaseBackedFile(file))return dbStore.readJson(file,fallback,{namespace:keyForFile(file)});
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`Could not read ${file}: ${err.message}`);
    return fallback;
  }
}
function persistJson(file,value){
  if(databaseBackedFile(file))return dbStore.writeJson(file,value,{namespace:keyForFile(file)});
  fs.writeFileSync(file,JSON.stringify(value,null,2));
}

const hardwareConfig = readJson(HARDWARE_CONFIG_FILE, {pluto:{},govee:{devices:{},groups:{},sceneFallback:{}}});
const goveeDevices = hardwareConfig.govee?.devices || {};
const goveeGroups = hardwareConfig.govee?.groups || {};
const goveeSceneFallback = hardwareConfig.govee?.sceneFallback || {};
const goveeStates = {};
const goveeLiveConfigs = {};
const goveePresence = {};

let goveeDiscovery = readJson(GOVEE_DISCOVERY_FILE,{version:1,autoAdd:true,devices:{},lastDiscoveryAt:null});
if(!goveeDiscovery || typeof goveeDiscovery!=="object")goveeDiscovery={version:1,autoAdd:true,devices:{},lastDiscoveryAt:null};
if(!goveeDiscovery.devices || typeof goveeDiscovery.devices!=="object")goveeDiscovery.devices={};
if(goveeDiscovery.autoAdd===undefined)goveeDiscovery.autoAdd=true;

function persistGoveeDiscovery(){
  persistJson(GOVEE_DISCOVERY_FILE,goveeDiscovery);
}
function goveeAliasForId(deviceId){
  const id=normalizeGoveePhysicalId(deviceId);
  const existing=Object.values(goveeDiscovery.devices).find(x=>normalizeGoveePhysicalId(x?.id)===id);
  if(existing?.alias)return cleanId(existing.alias);
  const base=`govee-${id.replace(/[^a-z0-9]/gi,"").slice(-6).toLowerCase()||"device"}`;
  let alias=cleanId(base),n=2;
  while(goveeDevices[alias] && goveeDevices[alias].id!==id)alias=cleanId(`${base}-${n++}`);
  return alias;
}
function goveeConfiguredAliasById(deviceId){
  const needle=normalizeGoveePhysicalId(deviceId);
  return Object.entries(goveeDevices).find(([,d])=>normalizeGoveePhysicalId(d?.id)===needle)?.[0]||null;
}
function goveeExtractMeta(deviceId,cfg={}){
  const device=cfg?.device&&typeof cfg.device==="object"?cfg.device:{};
  const name=String(cfg?.name||device?.name||device?.friendly_name||`Govee ${String(deviceId).slice(-6)}`).trim();
  const sku=String(cfg?.model||device?.model||device?.model_id||cfg?.device_class||"").trim();
  const ip=String(cfg?.ip||device?.ip||device?.ip_address||"").trim();
  return {name:name||`Govee ${String(deviceId).slice(-6)}`,sku,ip};
}
function goveeMetaFromStatusAttributes(deviceId,attrs={}){
  const overall=attrs?.overall&&typeof attrs.overall==="object"?attrs.overall:{};
  const lan=attrs?.lan&&typeof attrs.lan==="object"?attrs.lan:{};
  const platform=attrs?.platform_metadata&&typeof attrs.platform_metadata==="object"?attrs.platform_metadata:{};
  const name=String(
    attrs?.name||
    attrs?.friendly_name||
    platform?.name||
    platform?.device_name||
    `Govee ${String(deviceId).slice(-6)}`
  ).trim();
  const sku=String(
    attrs?.sku||
    attrs?.model||
    platform?.sku||
    platform?.model||
    ""
  ).trim();
  const ip=String(
    attrs?.ip||
    attrs?.ip_address||
    lan?.ip||
    lan?.ip_address||
    platform?.ip||
    ""
  ).trim();
  return {name:name||`Govee ${String(deviceId).slice(-6)}`,sku,ip,overall,lan};
}
function normalizeGoveePhysicalId(raw){
  return String(raw||"").replace(/:/g,"").trim().toUpperCase();
}
function isPhysicalGoveeId(raw){
  return /^[0-9A-F]{16}$/.test(normalizeGoveePhysicalId(raw));
}
function isSyntheticGoveeEntity(deviceId,cfg={}){
  const raw=String(deviceId||"");
  const name=String(cfg?.name||cfg?.friendly_name||"");
  if(/-\d+$/.test(raw))return true;
  if(/^segment\s+\d+/i.test(name))return true;
  if(/^\d{6,12}$/.test(raw))return true;
  if(!isPhysicalGoveeId(raw))return true;
  return false;
}
function purgeGoveeAlias(alias){
  const d=goveeDevices[alias];
  if(d?.id)delete goveePresence[String(d.id)];
  if(d?.id)delete goveeStates[d.id];
  delete goveeDevices[alias];
  for(const [gid,members] of Object.entries(goveeGroups)){
    if(Array.isArray(members)){
      goveeGroups[gid]=members.filter(x=>x!==alias);
      if(gid!=="all" && goveeGroups[gid].length===0)delete goveeGroups[gid];
    }
  }
  for(const [key,entry] of Object.entries(goveeDiscovery.devices)){
    if(key===alias || entry?.alias===alias)delete goveeDiscovery.devices[key];
  }
}
function migrateGoveeDiscoveryRegistry(){
  let removed=0;
  for(const [key,entry] of Object.entries({...goveeDiscovery.devices})){
    const id=String(entry?.id||"");
    if(entry?.discovered && isSyntheticGoveeEntity(id,entry)){
      purgeGoveeAlias(cleanId(entry.alias||key)); removed++;
    }
  }
  if(removed){persistGoveeDiscovery();audit({kind:"govee.discovery.migrate",removedSynthetic:removed});}
  return removed;
}
function reconcileGoveeDiscovery(nowMs=Date.now(),options={}){
  const force=!!options.force;
  let removed=0,offline=0;
  for(const [key,entry] of Object.entries({...goveeDiscovery.devices})){
    if(!entry?.discovered)continue;
    const alias=cleanId(entry.alias||key);
    const id=String(entry.id||"");
    if(isSyntheticGoveeEntity(id,entry)){purgeGoveeAlias(alias);removed++;continue;}
    const seen=Date.parse(goveePresence[id]?.lastSeen||entry.lastSeen||0);
    if(!Number.isFinite(seen)||seen<=0)continue;
    const age=nowMs-seen;
    if((force&&age>60000)||(!force&&age>GOVEE_RECONCILE_GRACE_MS)){purgeGoveeAlias(alias);removed++;}
    else if(age>60000){goveePresence[id]={status:"offline",lastSeen:new Date(seen).toISOString()};offline++;}
  }
  if(removed){persistGoveeDiscovery();audit({kind:"govee.discovery.reconcile",removed,offline,force});broadcastControllers({type:"govee.inventory",reason:force?"manual-reconcile":"reconcile",removed});}
  return {removed,offline,force};
}
function applyGoveeRegistryEntry(entry){
  if(!entry?.id||!entry?.alias)return;
  const alias=cleanId(entry.alias);
  const current=goveeDevices[alias]||{};
  goveeDevices[alias]={
    ...current,
    name:entry.name||current.name||`Govee ${String(entry.id).slice(-6)}`,
    sku:entry.sku||current.sku||"",
    id:String(entry.id),
    ...(entry.ip?{ip:entry.ip}:{}),
    discovered:entry.discovered!==false,
    firstSeen:entry.firstSeen||current.firstSeen||null,
    lastSeen:entry.lastSeen||current.lastSeen||null
  };
  if(!Array.isArray(goveeGroups.all))goveeGroups.all=[];
  if(!goveeGroups.all.includes(alias))goveeGroups.all.push(alias);
  for(const group of Array.isArray(entry.groups)?entry.groups:[]){
    const gid=cleanId(group);
    if(!gid||gid==="all")continue;
    if(!Array.isArray(goveeGroups[gid]))goveeGroups[gid]=[];
    if(!goveeGroups[gid].includes(alias))goveeGroups[gid].push(alias);
  }
}
function bootstrapGoveeDiscovery(){
  for(const [alias,d] of Object.entries(goveeDevices)){
    if(!d?.id)continue;
    const existing=Object.values(goveeDiscovery.devices).find(x=>x?.id===String(d.id));
    if(existing){
      existing.alias=cleanId(existing.alias||alias);
      if(existing.name) d.name=existing.name;
      if(existing.sku) d.sku=existing.sku;
      if(existing.ip) d.ip=existing.ip;
    }
  }
  for(const entry of Object.values(goveeDiscovery.devices))applyGoveeRegistryEntry(entry);
}
bootstrapGoveeDiscovery();
migrateGoveeDiscoveryRegistry();

function enrollGoveeDevice(deviceId,cfg={},source="mqtt"){
  const id=normalizeGoveePhysicalId(deviceId);
  if(!id || isSyntheticGoveeEntity(deviceId,cfg))return null;
  const now=new Date().toISOString();
  const meta=goveeExtractMeta(id,cfg);
  let alias=goveeConfiguredAliasById(id)||goveeAliasForId(id);
  let entry=Object.values(goveeDiscovery.devices).find(x=>x?.id===id);

  // Existing hardware.json devices are known already; create a registry overlay only
  // when we need discovery metadata or user-editable overrides.
  if(!entry){
    entry={
      id,alias,
      name:goveeDevices[alias]?.name||meta.name,
      sku:goveeDevices[alias]?.sku||meta.sku,
      ip:goveeDevices[alias]?.ip||meta.ip||"",
      groups:[],
      discovered:!goveeConfiguredAliasById(id),
      firstSeen:now,lastSeen:now,source
    };
    goveeDiscovery.devices[alias]=entry;
  }else{
    alias=cleanId(entry.alias||alias);
    entry.alias=alias;
    entry.lastSeen=now;
    entry.source=source||entry.source;
    if((!entry.name || /^Govee\s+[0-9a-f]{6}$/i.test(entry.name)) && meta.name)entry.name=meta.name;
    if(!entry.sku&&meta.sku)entry.sku=meta.sku;
    if(!entry.ip&&meta.ip)entry.ip=meta.ip;
  }

  if(goveeDiscovery.autoAdd!==false){
    applyGoveeRegistryEntry(entry);
    goveeDiscovery.lastDiscoveryAt=now;
    persistGoveeDiscovery();
    audit({kind:"govee.discovery",deviceId:id,alias,name:entry.name,source,newDevice:!goveeConfiguredAliasById(id)});
    broadcastControllers({type:"govee.discovery",deviceId:id,alias,device:goveeDevices[alias]});
  }
  return alias;
}
function touchGoveePresence(deviceId,status="online"){
  const id=String(deviceId||"");
  if(!id)return;
  const now=new Date().toISOString();
  goveePresence[id]={status:String(status||"online").toLowerCase(),lastSeen:now};
  const entry=Object.values(goveeDiscovery.devices).find(x=>x?.id===id);
  if(entry){
    entry.lastSeen=now;
    // Do not persist on every state packet; periodic/stateful UI derives presence in memory.
    const alias=cleanId(entry.alias);
    if(goveeDevices[alias])goveeDevices[alias].lastSeen=now;
  }
}
function goveeDeviceOnline(deviceId){
  const p=goveePresence[String(deviceId||"")];
  if(!p)return null;
  if(["offline","unavailable","false","0"].includes(String(p.status).toLowerCase()))return false;
  return true;
}
function updateGoveeDevice(alias,input={}){
  alias=cleanId(alias);
  const d=goveeDevices[alias];
  if(!d)throw new Error("Unknown Govee device");
  let entry=Object.values(goveeDiscovery.devices).find(x=>x?.id===String(d.id));
  if(!entry){
    entry={id:String(d.id),alias,name:d.name||alias,sku:d.sku||"",ip:d.ip||"",groups:[],discovered:false,firstSeen:new Date().toISOString(),lastSeen:null,source:"configured"};
    goveeDiscovery.devices[alias]=entry;
  }
  if(input.name!==undefined){
    const name=String(input.name||"").trim().slice(0,100);
    if(!name)throw new Error("Name cannot be blank");
    entry.name=name;d.name=name;
  }
  if(Array.isArray(input.groups)){
    const groups=[...new Set(input.groups.map(cleanId).filter(x=>x&&x!=="all"))];
    // Remove the alias from all editable groups, then add requested groups.
    for(const [gid,members] of Object.entries(goveeGroups)){
      if(gid==="all"||!Array.isArray(members))continue;
      goveeGroups[gid]=members.filter(x=>x!==alias);
      if(!goveeGroups[gid].length && !Object.values(goveeDiscovery.devices).some(x=>(x.groups||[]).includes(gid)))delete goveeGroups[gid];
    }
    entry.groups=groups;
    for(const gid of groups){
      if(!Array.isArray(goveeGroups[gid]))goveeGroups[gid]=[];
      if(!goveeGroups[gid].includes(alias))goveeGroups[gid].push(alias);
    }
  }
  applyGoveeRegistryEntry(entry);
  persistGoveeDiscovery();
  return {alias,device:goveeDevices[alias],groups:entry.groups||[]};
}

function makeDefaultPlutoSchedules(){
  const out={};
  for(const type of ["hdmi","hdbt"]){
    for(let index=1;index<=8;index++){
      out[`${type}:${index}`]={type,index,enabled:false,onTime:"07:30",offTime:"16:00",days:[1,2,3,4,5],lastRun:{},lastExec:{}};
    }
  }
  return out;
}
let plutoSchedules=readJson(PLUTO_SCHEDULES_FILE,makeDefaultPlutoSchedules());
function persistPlutoSchedules(){
  persistJson(PLUTO_SCHEDULES_FILE,plutoSchedules);
}

function makeDefaultAvLabels(){
  return {
    outputs:Array.from({length:8},(_,i)=>`TV ${i+1}`),
    inputs:Array.from({length:8},(_,i)=>`Content Source ${i+1}`),
    sourceEndpoints:Array.from({length:8},(_,i)=>`source${i+1}`)
  };
}
function normalizeAvLabels(value){
  const d=makeDefaultAvLabels(),v=value&&typeof value==="object"?value:{};
  const clean=(arr,defaults)=>Array.from({length:8},(_,i)=>{
    const text=String(Array.isArray(arr)?arr[i]||"":"").trim().slice(0,60);
    return text||defaults[i];
  });
  return {outputs:clean(v.outputs,d.outputs),inputs:clean(v.inputs,d.inputs),sourceEndpoints:clean(v.sourceEndpoints,d.sourceEndpoints)};
}
let avLabels=normalizeAvLabels(readJson(AV_LABELS_FILE,makeDefaultAvLabels()));
function persistAvLabels(){persistJson(AV_LABELS_FILE,avLabels)}

let mediaLibrary=readJson(MEDIA_LIBRARY_FILE,{files:{}});
if(!mediaLibrary || typeof mediaLibrary!=="object")mediaLibrary={files:{}};
if(!mediaLibrary.files || typeof mediaLibrary.files!=="object")mediaLibrary.files={};

function persistMediaLibrary(){
  persistJson(MEDIA_LIBRARY_FILE,mediaLibrary);
}

let classroomAutomations=readJson(AUTOMATIONS_FILE,{version:1,events:[]});
if(!classroomAutomations || typeof classroomAutomations!=="object") classroomAutomations={version:1,events:[]};
if(!Array.isArray(classroomAutomations.events)) classroomAutomations.events=[];

function persistAutomations(){
  persistJson(AUTOMATIONS_FILE,classroomAutomations);
}
function commitAutomations(next){persistJson(AUTOMATIONS_FILE,next);classroomAutomations=next;return next}

function validDateKey(v){
  const text=String(v||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;
  const [year,month,day]=text.split("-").map(Number),parsed=new Date(Date.UTC(year,month-1,day));
  return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day;
}
function uniqueDateKeys(values){
  return [...new Set((Array.isArray(values)?values:[])
    .map(v=>String(v||"").trim()).filter(validDateKey))].sort();
}
function localDateKey(d=new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function schedulerLocalTimestamp(d=new Date()){
  return new Intl.DateTimeFormat("en-US",{
    timeZone:SCHEDULER_TIMEZONE,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZoneName:"short"
  }).format(d);
}
function schedulerStatus(){
  const now=new Date();
  return {
    timezone:SCHEDULER_TIMEZONE,
    catchupMinutes:SCHEDULER_CATCHUP_MINUTES,
    utcTime:now.toISOString(),
    localTime:schedulerLocalTimestamp(now),
    hostTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone||null
  };
}
function dateFromKey(key){
  if(!validDateKey(key))return null;
  const [y,m,d]=key.split("-").map(Number);
  const out=new Date(y,m-1,d,12,0,0,0);
  return out.getFullYear()===y&&out.getMonth()===m-1&&out.getDate()===d?out:null;
}
const DISTRICT_NO_SCHOOL_DATES_2026_2027 = Object.freeze([]);

const DISTRICT_HALF_DAY_DATES_2026_2027 = Object.freeze([]);

function normalizeSchedulerCalendar(input={},existing={}){
  const noSchoolRequested=input.noSchoolDates??input.excludedDates??existing.noSchoolDates??existing.excludedDates;
  const noSchoolDates=uniqueDateKeys([
    ...DISTRICT_NO_SCHOOL_DATES_2026_2027,
    ...(Array.isArray(noSchoolRequested)?noSchoolRequested:[])
  ]);
  const remoteDates=uniqueDateKeys(input.remoteDates===undefined?existing.remoteDates:input.remoteDates).filter(x=>!noSchoolDates.includes(x));
  const halfRequested=input.halfDayDates===undefined?existing.halfDayDates:input.halfDayDates;
  const halfDayDates=uniqueDateKeys([...DISTRICT_HALF_DAY_DATES_2026_2027,...(Array.isArray(halfRequested)?halfRequested:[])]).filter(x=>!noSchoolDates.includes(x)&&!remoteDates.includes(x));
  const twoHourDelayDates=uniqueDateKeys(input.twoHourDelayDates===undefined?existing.twoHourDelayDates:input.twoHourDelayDates).filter(x=>!noSchoolDates.includes(x)&&!remoteDates.includes(x)&&!halfDayDates.includes(x));
  const oneHourDelayDates=uniqueDateKeys(input.oneHourDelayDates===undefined?existing.oneHourDelayDates:input.oneHourDelayDates).filter(x=>!noSchoolDates.includes(x)&&!remoteDates.includes(x)&&!halfDayDates.includes(x)&&!twoHourDelayDates.includes(x));
  const anchorDate=String(input.anchorDate||existing.anchorDate||localDateKey(new Date()));
  if(!validDateKey(anchorDate))throw Error("School-cycle anchor must be a valid YYYY-MM-DD date");
  return {
    noSchoolDates,
    excludedDates:noSchoolDates, // backward-compatible alias
    halfDayDates,
    oneHourDelayDates,
    twoHourDelayDates,
    remoteDates,
    anchorDate,
    anchorCycleDay:String(input.anchorCycleDay||existing.anchorCycleDay||'A'),
    anchorDayColor:String(input.anchorDayColor||existing.anchorDayColor||'Day A'),
    updatedAt:new Date().toISOString()
  };
}
let schedulerCalendar=normalizeSchedulerCalendar(
  readJson(SCHEDULER_CALENDAR_FILE,{excludedDates:[]}),
  {excludedDates:[],halfDayDates:[],oneHourDelayDates:[],twoHourDelayDates:[],remoteDates:[]}
);
function persistSchedulerCalendar(){
  persistJson(SCHEDULER_CALENDAR_FILE,schedulerCalendar);
}
// Persist once at startup so existing installations migrate away from the old
// federal-holiday toggle and receive the district closure dates automatically.
persistSchedulerCalendar();

// The active cycle and exception-day behavior is school-configurable. Existing
// secured appliances receive a compatibility profile once; fresh installations
// start with a generic two-day school cycle instead of site-specific defaults.
const storedSchoolScheduleProfile=dbStore.getPreference("school.schedule.profile",null);
let schoolScheduleProfile=normalizeSchoolScheduleProfile(
  storedSchoolScheduleProfile||{},
  storedSchoolScheduleProfile
    ? defaultSchoolScheduleProfile({anchorDate:schedulerCalendar.anchorDate})
    : (dbStore.userCount()>0?legacySchoolScheduleProfile(schedulerCalendar):defaultSchoolScheduleProfile({anchorDate:schedulerCalendar.anchorDate}))
);
if(!storedSchoolScheduleProfile){schoolScheduleProfile.updatedAt=new Date().toISOString();dbStore.setPreference("school.schedule.profile",schoolScheduleProfile)}
function setSchoolScheduleProfile(value){schoolScheduleProfile=normalizeSchoolScheduleProfile(value,schoolScheduleProfile);schoolScheduleProfile.updatedAt=new Date().toISOString();dbStore.setPreference("school.schedule.profile",schoolScheduleProfile);return schoolScheduleProfile}

const DEFAULT_MORNING_ANNOUNCEMENTS_URL = String(process.env.MORNING_ANNOUNCEMENTS_URL||"").trim();
function normalizeMorningAnnouncements(input={},existing={}){
  const streamUrl=String(input.streamUrl??existing.streamUrl??DEFAULT_MORNING_ANNOUNCEMENTS_URL).trim()||DEFAULT_MORNING_ANNOUNCEMENTS_URL;
  const startCandidate=String(input.startTime??existing.startTime??"07:00"),endCandidate=String(input.endTime??existing.endTime??"08:30");
  if(!validTime(startCandidate)||!validTime(endCandidate))throw Error("Morning Announcement times must be valid HH:MM values");
  const startTime=startCandidate,endTime=endCandidate;
  const finite=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback};
  return {
    enabled:input.enabled===undefined?(existing.enabled!==false):!!input.enabled,
    streamUrl, startTime, endTime,
    volumePercent:finite(input.volumePercent??existing.volumePercent,100,0,100),
    targets:Array.isArray(input.targets)&&input.targets.length?[...new Set(input.targets.map(cleanId).filter(Boolean))]:(Array.isArray(existing.targets)&&existing.targets.length?existing.targets:["all"]),
    checkIntervalSeconds:finite(input.checkIntervalSeconds??existing.checkIntervalSeconds,15,10,120),
    offlineConfirmations:finite(input.offlineConfirmations??existing.offlineConfirmations,2,1,8),
    updatedAt:new Date().toISOString()
  };
}
let morningAnnouncements=normalizeMorningAnnouncements(readJson(MORNING_ANNOUNCEMENTS_FILE,{}),{});
function persistMorningAnnouncements(){persistJson(MORNING_ANNOUNCEMENTS_FILE,morningAnnouncements)}
const morningAnnouncementsRuntime={live:false,active:false,mode:null,targets:[],lastCheck:null,lastWatcherTick:null,lastLiveAt:null,lastEndedAt:null,lastError:null,probe:null,probeStatus:null,probeDurationMs:null,offlineCount:0,lastAssertAt:0};
let morningAnnouncementsTimer=null;
function restartMorningAnnouncementsWatcher(){
  if(morningAnnouncementsTimer)clearTimeout(morningAnnouncementsTimer);
  const run=async()=>{try{await morningAnnouncementsTick()}finally{morningAnnouncementsTimer=setTimeout(run,Math.max(10000,Number(morningAnnouncements.checkIntervalSeconds||15)*1000));morningAnnouncementsTimer.unref()}};
  morningAnnouncementsTimer=setTimeout(run,2500);morningAnnouncementsTimer.unref();
}
const deferredAnnouncementAutomations=new Map();
function announcementsPlaybackUrl(raw=morningAnnouncements.streamUrl){
  try{const u=new URL(raw);u.searchParams.set("autoplay","true");u.searchParams.set("mute","false");if(!u.searchParams.get("playOrder"))u.searchParams.set("playOrder","webrtc,hls");return u.toString()}catch{return raw}
}
function announcementsCoordinates(raw=morningAnnouncements.streamUrl){
  try{
    const u=new URL(raw),parts=u.pathname.split("/").filter(Boolean);
    const app=parts[0]||"LiveApp",id=u.searchParams.get("id")||"stream";
    return {
      origin:u.origin,app,id,hostname:u.hostname,port:u.port||null,protocol:u.protocol,
      token:u.searchParams.get("token")||null,subscriberId:u.searchParams.get("subscriberId")||null,subscriberCode:u.searchParams.get("subscriberCode")||null
    };
  }catch{return null}
}
function announcementsWebSocketUrls(c){
  const proto=c.protocol==="https:"?"wss:":"ws:";
  const urls=[`${proto}//${c.hostname}${c.port?`:${c.port}`:""}/${c.app}/websocket`];
  // Ant Media commonly exposes secure WebRTC signaling on 5443 even when play.html
  // is fronted by a reverse proxy on 443. Try both without duplicating entries.
  if(proto==="wss:"&&String(c.port||"")!=="5443")urls.push(`wss://${c.hostname}:5443/${c.app}/websocket`);
  return [...new Set(urls)];
}
async function probeMorningAnnouncementsWebRtc(c,timeoutMs=3500){
  const urls=announcementsWebSocketUrls(c),attempts=[];
  for(const url of urls){
    const result=await new Promise(resolve=>{
      let settled=false,ws=null;
      const finish=(value)=>{if(settled)return;settled=true;clearTimeout(timer);try{if(ws&&ws.readyState===WebSocket.OPEN)ws.close()}catch{};resolve(value)};
      const timer=setTimeout(()=>finish({live:null,probe:"webrtc",status:"timeout",url}),timeoutMs);
      try{
        ws=new WebSocket(url,{handshakeTimeout:timeoutMs});
        ws.on("open",()=>{
          const msg={command:"play",streamId:c.id};
          if(c.token)msg.token=c.token;if(c.subscriberId)msg.subscriberId=c.subscriberId;if(c.subscriberCode)msg.subscriberCode=c.subscriberCode;
          try{ws.send(JSON.stringify(msg))}catch(e){finish({live:null,probe:"webrtc",status:"send-error",url,error:e.message})}
        });
        ws.on("message",data=>{
          let j=null;try{j=JSON.parse(Buffer.isBuffer(data)?data.toString("utf8"):String(data))}catch{return}
          const command=String(j?.command||"").toLowerCase(),definition=String(j?.definition||j?.error_definition||"").toLowerCase();
          // A WebRTC offer / play-start notification is definitive evidence that the live stream exists.
          if(command==="takeconfiguration"||definition==="play_started"||definition==="streaming_started")
            return finish({live:true,probe:"webrtc",status:definition||command,url});
          const offlineDefs=["no_stream_exist","stream_not_exist_or_not_streaming","stream_not_exist","not_found"];
          if(command==="error"&&offlineDefs.some(x=>definition.includes(x)))
            return finish({live:false,probe:"webrtc",status:definition||"not-streaming",url});
          if(definition==="webrtc_not_enabled")
            return finish({live:null,probe:"webrtc",status:definition,url});
        });
        ws.on("error",err=>finish({live:null,probe:"webrtc",status:"error",url,error:String(err?.message||err)}));
        ws.on("close",()=>{if(!settled)finish({live:null,probe:"webrtc",status:"closed",url})});
      }catch(err){finish({live:null,probe:"webrtc",status:"error",url,error:String(err?.message||err)})}
    });
    attempts.push(result);
    if(result.live===true||result.live===false)return {...result,attempts};
  }
  return {live:null,probe:"webrtc",status:"unavailable",attempts};
}
async function fetchWithDeadline(url,options={},timeoutMs=3500){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{return await fetch(url,{...options,signal:ctrl.signal,headers:{"cache-control":"no-cache",...(options.headers||{})}})}finally{clearTimeout(timer)}
}
async function probeMorningAnnouncementsLive(){
  const c=announcementsCoordinates();
  if(!c)return {live:false,probe:"hls",status:"invalid-url",error:"Invalid stream URL",durationMs:0,attempts:[]};
  const started=Date.now(),stamp=started,attempts=[];
  const primary=`${c.origin}/${c.app}/streams/${encodeURIComponent(c.id)}.m3u8?_=${stamp}`;
  const adaptive=`${c.origin}/${c.app}/streams/${encodeURIComponent(c.id)}_adaptive.m3u8?_=${stamp}`;
  for(const [index,url] of [primary,adaptive].entries()){
    try{
      const r=await fetchWithDeadline(url,{},3500);
      if(r.status===404){
        attempts.push({probe:index===0?"hls":"hls-adaptive",httpStatus:404,ok:false,url,status:"not-found"});
        // This Ant Media deployment creates the primary manifest while a publisher
        // is live and removes it when publishing stops. Primary 404 is authoritative OFFLINE.
        if(index===0)return {live:false,probe:"hls",status:"404-offline",httpStatus:404,url,durationMs:Date.now()-started,attempts};
        continue;
      }
      if(!r.ok){
        attempts.push({probe:index===0?"hls":"hls-adaptive",httpStatus:r.status,ok:false,url,status:`http-${r.status}`});
        continue;
      }
      const text=await r.text();
      const valid=text.startsWith("#EXTM3U")&&(text.includes("#EXTINF")||text.includes("#EXT-X-STREAM-INF"));
      attempts.push({probe:index===0?"hls":"hls-adaptive",httpStatus:r.status,ok:valid,url,status:valid?"playlist":"invalid-playlist"});
      if(valid){
        const seq=(text.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)||[])[1]||null;
        return {live:true,probe:"hls",status:"playlist",httpStatus:r.status,url,mediaSequence:seq,durationMs:Date.now()-started,attempts};
      }
    }catch(err){
      attempts.push({probe:index===0?"hls":"hls-adaptive",ok:false,url,error:err?.name==='AbortError'?"timeout":String(err?.message||err)});
    }
  }
  // Network/proxy failures are UNKNOWN, not OFFLINE, so they do not consume
  // the two-confirmation stream-ended guard.
  return {live:null,probe:"hls",status:"unavailable",error:"HLS probe unavailable",durationMs:Date.now()-started,attempts};
}

function localMinutesNow(date=new Date()){return date.getHours()*60+date.getMinutes()}
function minutesFromHHMM(v){const [h,m]=String(v||"00:00").split(":").map(Number);return h*60+m}
function withinMorningAnnouncementsWindow(now=new Date()){
  const n=localMinutesNow(now),a=minutesFromHHMM(morningAnnouncements.startTime),b=minutesFromHHMM(morningAnnouncements.endTime);
  return a<=b?(n>=a&&n<=b):(n>=a||n<=b);
}
function morningAnnouncementsSchoolDay(now=new Date()){
  if(isAutomationSuppressed(now).blocked)return false;
  return schoolCycleForDate(now).isStudentSchoolDay;
}
function announcementTargets(){return automationDisplayTargets(morningAnnouncements.targets?.length?morningAnnouncements.targets:["all"])}
function scheduleAnnouncementAudioRetries(targets){
  for(const delay of [1500,4500,10000,20000])setTimeout(()=>{
    if(!morningAnnouncementsRuntime.active)return;
    if(morningAnnouncementsRuntime.mode!=="manual"&&!morningAnnouncementsRuntime.live)return;
    executeCommand({type:"display.web.audio",target:targets,payload:{unmute:Number(morningAnnouncements.volumePercent??100)>0,volume:Math.max(0,Math.min(1,Number(morningAnnouncements.volumePercent??100)/100)),reload:false,contentKind:"morning-announcements"}},"automation").catch(()=>{});
  },delay);
}
function setMorningAnnouncementPriorityTargets(targets,active){
  for(const id of targets||[]){if(active)backgroundMusicPriorityTargets.add(id);else backgroundMusicPriorityTargets.delete(id)}
  backgroundMusicReconcilePriority().catch(()=>{});
}
async function assertMorningAnnouncements({mode="automatic",targetsOverride=null,urlOverride=null}={}){
  const targets=Array.isArray(targetsOverride)&&targetsOverride.length?automationDisplayTargets(targetsOverride):announcementTargets();if(!targets.length)return;
  const url=String(urlOverride||announcementsPlaybackUrl());
  // Treat announcements as an exclusive display takeover. Clear only the target
  // display content; do not invoke the master classroom clear because that would
  // pause lesson/session queues beyond the announcement window.
  await executeCommand({type:"display.clear",target:targets,payload:{reason:"morning-announcements-takeover"}},"automation");
  await executeCommand({type:"display.web",target:targets,payload:{url,fit:"cover",opacity:1,localDirect:true,forceAudio:true,autoplay:true,muted:Number(morningAnnouncements.volumePercent??100)<=0,volume:Math.max(0,Math.min(1,Number(morningAnnouncements.volumePercent??100)/100)),contentKind:"morning-announcements"}},"automation");
  morningAnnouncementsRuntime.active=true;morningAnnouncementsRuntime.mode=mode;morningAnnouncementsRuntime.targets=[...targets];morningAnnouncementsRuntime.lastAssertAt=Date.now();morningAnnouncementsRuntime.lastLiveAt=new Date().toISOString();
  setMorningAnnouncementPriorityTargets(targets,true);
  scheduleAnnouncementAudioRetries(targets);
  audit({kind:"automation.morning-announcements.start",mode,targets,url,clearedFirst:true});
}
function queueAutomationDuringAnnouncements(storedEvent,event,dateKey,scheduledMinuteKey,deltaMinutes){
  const occurrenceKey=event.classId||"manual",key=`${storedEvent.id}:${occurrenceKey}:${scheduledMinuteKey}`;
  if(!deferredAnnouncementAutomations.has(key))deferredAnnouncementAutomations.set(key,{key,storedEventId:storedEvent.id,event:{...event},occurrenceKey,scheduledMinuteKey,dateKey,deltaMinutes,queuedAt:new Date().toISOString()});
  storedEvent.lastRun={at:new Date().toISOString(),scheduledFor:`${dateKey} ${event.time}`,resolvedClassId:event.classId||null,ok:true,deferred:true,message:"Deferred while Morning Announcements have priority"};
  return key;
}
function automationDeferredDisplayTargets(event){
  const out=new Set();
  const collect=(action,targets)=>{
    const a=String(action||"").toLowerCase();
    if(!a.startsWith("display."))return;
    for(const id of automationDisplayTargets(targets||[]))out.add(id);
  };
  collect(event.action,event.targets);
  for(const step of Array.isArray(event.actions)?event.actions:[]){
    const action=step?.action||event.action;
    const stepDomain=automationTargetDomain(action),eventDomain=automationTargetDomain(event.action);
    let targets;
    if(step?.useEventTargets!==false&&stepDomain===eventDomain)targets=event.targets;
    else if(Array.isArray(step?.targets)&&step.targets.length)targets=step.targets;
    else if(stepDomain==="display")targets=["all"];
    else targets=[];
    collect(action,targets);
  }
  const timer=event.timerOverlay&&typeof event.timerOverlay==="object"?event.timerOverlay:null;
  if(timer?.enabled){
    const targets=timer.useEventTargets!==false?event.targets:(Array.isArray(timer.targets)&&timer.targets.length?timer.targets:event.targets);
    for(const id of automationDisplayTargets(targets||[]))out.add(id);
  }
  return out;
}
function automationOccurrenceScheduledMinutes(event){
  const [h,m]=String(event?.time||"00:00").split(":").map(Number);
  return (Number.isFinite(h)?h:0)*60+(Number.isFinite(m)?m:0);
}
function automationOccurrenceIsCurrentlyApplicable(event,now=new Date()){
  if(!event||!automationMatchesDate(event,now).match)return false;
  const scheduled=automationOccurrenceScheduledMinutes(event),current=localMinutesNow(now);
  if(scheduled>current)return false;
  if(event._class){
    const start=Number(event._classStartAt),end=Number(event._classEndAt),stamp=now.getTime();
    if(Number.isFinite(start)&&stamp<start)return false;
    if(Number.isFinite(end)&&stamp>=end)return false;
  }
  return automationDeferredDisplayTargets(event).size>0;
}
function currentAutomationDisplayWinners(now=new Date()){
  const candidates=[];
  for(const storedEvent of classroomAutomations.events){
    if(!storedEvent?.enabled)continue;
    for(const event of resolveAutomationOccurrences(storedEvent,now)){
      if(!automationOccurrenceIsCurrentlyApplicable(event,now))continue;
      const targets=[...automationDeferredDisplayTargets(event)];
      if(!targets.length)continue;
      candidates.push({storedEvent,event,targets,scheduledMinutes:automationOccurrenceScheduledMinutes(event)});
    }
  }
  const winnersByTarget=new Map();
  for(const candidate of candidates){
    for(const id of candidate.targets){
      const prior=winnersByTarget.get(id);
      if(!prior||candidate.scheduledMinutes>prior.scheduledMinutes||
        (candidate.scheduledMinutes===prior.scheduledMinutes&&String(candidate.storedEvent.updatedAt||"")>String(prior.storedEvent.updatedAt||""))){
        winnersByTarget.set(id,candidate);
      }
    }
  }
  const unique=new Map();
  for(const candidate of winnersByTarget.values()){
    const key=`${candidate.storedEvent.id}:${candidate.event.classId||"manual"}:${candidate.event.time}`;
    if(!unique.has(key))unique.set(key,candidate);
  }
  return [...unique.values()].sort((a,b)=>a.scheduledMinutes-b.scheduledMinutes||String(a.storedEvent.id).localeCompare(String(b.storedEvent.id)));
}
function consumeDeferredAnnouncementAutomations(){
  const queued=[...deferredAnnouncementAutomations.values()];
  deferredAnnouncementAutomations.clear();
  for(const item of queued){
    const storedEvent=classroomAutomations.events.find(x=>x.id===item.storedEventId);if(!storedEvent)continue;
    storedEvent.lastExecByClass=storedEvent.lastExecByClass||{};
    storedEvent.lastExecByClass[item.occurrenceKey]=item.scheduledMinuteKey;
    storedEvent.lastExec=item.scheduledMinuteKey;
    storedEvent.lastRun={at:new Date().toISOString(),scheduledFor:`${item.dateKey} ${item.event.time}`,resolvedClassId:item.event.classId||null,ok:true,deferred:true,resynced:true,message:"Consumed by post-announcement scheduler resync"};
    storedEvent.updatedAt=new Date().toISOString();
  }
  if(queued.length)persistAutomations();
  return queued.length;
}
async function resyncCurrentDisplayAutomationsAfterAnnouncements(reason="stream-ended"){
  const now=new Date(),winners=currentAutomationDisplayWinners(now),results=[];
  for(const candidate of winners){
    const occurrenceKey=candidate.event.classId||"manual";
    const scheduledMinuteKey=`${localDateKey(now)} ${candidate.event.time}`;
    try{
      const result=await runClassroomAutomation(candidate.event,{manual:false,bypassAnnouncementPriority:true});
      candidate.storedEvent.lastExecByClass=candidate.storedEvent.lastExecByClass||{};
      candidate.storedEvent.lastExecByClass[occurrenceKey]=scheduledMinuteKey;
      candidate.storedEvent.lastExec=scheduledMinuteKey;
      candidate.storedEvent.lastRun={at:new Date().toISOString(),scheduledFor:scheduledMinuteKey,resolvedClassId:candidate.event.classId||null,ok:result.ok!==false,resync:true,message:"Re-applied after Morning Announcements ended"};
      candidate.storedEvent.updatedAt=new Date().toISOString();
      results.push({automationId:candidate.storedEvent.id,name:candidate.storedEvent.name,classId:candidate.event.classId||null,time:candidate.event.time,targets:candidate.targets,ok:result.ok!==false});
    }catch(err){
      results.push({automationId:candidate.storedEvent.id,name:candidate.storedEvent.name,classId:candidate.event.classId||null,time:candidate.event.time,targets:candidate.targets,ok:false,error:err.message});
      diagnosticError(err,{component:"automation",operation:"announcement-post-resync",data:{automationId:candidate.storedEvent.id,reason}});
    }
  }
  if(winners.length)persistAutomations();
  audit({kind:"automation.morning-announcements.resync",reason,at:now.toISOString(),winnerCount:winners.length,results});
  return {winnerCount:winners.length,results};
}
async function releaseMorningAnnouncements(reason="stream-ended"){
  if(!morningAnnouncementsRuntime.active)return;
  const targets=morningAnnouncementsRuntime.targets?.length?[...morningAnnouncementsRuntime.targets]:announcementTargets();
  if(targets.length)await executeCommand({type:"display.clear",target:targets,payload:{reason:"morning-announcements-release"}},"automation");
  setMorningAnnouncementPriorityTargets(targets,false);
  morningAnnouncementsRuntime.active=false;morningAnnouncementsRuntime.mode=null;morningAnnouncementsRuntime.targets=[];morningAnnouncementsRuntime.lastEndedAt=new Date().toISOString();morningAnnouncementsRuntime.lastAssertAt=0;
  const deferredConsumed=consumeDeferredAnnouncementAutomations();
  const resync=await resyncCurrentDisplayAutomationsAfterAnnouncements(reason);
  backgroundMusicTick().catch(()=>{});
  audit({kind:"automation.morning-announcements.stop",reason,targets,deferredConsumed,resyncWinnerCount:resync.winnerCount,resyncResults:resync.results});
}
let morningAnnouncementsTickBusy=false;
async function morningAnnouncementsTick(){
  if(morningAnnouncementsTickBusy)return;morningAnnouncementsTickBusy=true;
  try{
    const now=new Date();morningAnnouncementsRuntime.lastWatcherTick=now.toISOString();
    // Manual announcements are operator-controlled and remain locked until Stop / Clear.
    if(morningAnnouncementsRuntime.active&&morningAnnouncementsRuntime.mode==="manual")return;
    if(!morningAnnouncements.enabled||!withinMorningAnnouncementsWindow(now)||!morningAnnouncementsSchoolDay(now)){
      morningAnnouncementsRuntime.live=false;morningAnnouncementsRuntime.offlineCount=0;
      if(morningAnnouncementsRuntime.active)await releaseMorningAnnouncements(!morningAnnouncements.enabled?"disabled":"outside-window");
      return;
    }
    const probe=await probeMorningAnnouncementsLive();
    morningAnnouncementsRuntime.lastCheck=new Date().toISOString();morningAnnouncementsRuntime.probe=probe.probe;morningAnnouncementsRuntime.probeStatus=probe.status||null;morningAnnouncementsRuntime.probeDurationMs=probe.durationMs??null;morningAnnouncementsRuntime.lastError=probe.error||null;
    if(probe.live===true){
      morningAnnouncementsRuntime.live=true;morningAnnouncementsRuntime.offlineCount=0;
      if(!morningAnnouncementsRuntime.active||Date.now()-morningAnnouncementsRuntime.lastAssertAt>30000)await assertMorningAnnouncements({mode:"automatic"});
    }else if(probe.live===false){
      morningAnnouncementsRuntime.live=false;morningAnnouncementsRuntime.offlineCount++;
      if(morningAnnouncementsRuntime.active&&morningAnnouncementsRuntime.offlineCount>=morningAnnouncements.offlineConfirmations)await releaseMorningAnnouncements("stream-ended");
    }else{
      morningAnnouncementsRuntime.lastError=probe.error||"HLS probe unavailable";
    }
  }catch(err){morningAnnouncementsRuntime.lastError=err.message;diagnosticError?.(err,{component:"automation",operation:"morning-announcements-watch"})}
  finally{morningAnnouncementsTickBusy=false}
}
function calendarRuleForDate(date=new Date()){
  const key=localDateKey(date);
  if((schedulerCalendar.noSchoolDates||schedulerCalendar.excludedDates||[]).includes(key))return {type:'no-school',date:key,label:'District No-School'};
  if((schedulerCalendar.remoteDates||[]).includes(key))return {type:'remote',date:key,label:'Remote Day'};
  if((schedulerCalendar.halfDayDates||[]).includes(key))return {type:'half-day',date:key,label:'Half Day'};
  if((schedulerCalendar.twoHourDelayDates||[]).includes(key))return {type:'2-hour-delay',date:key,label:'2-Hour Delay'};
  if((schedulerCalendar.oneHourDelayDates||[]).includes(key))return {type:'1-hour-delay',date:key,label:'1-Hour Delay'};
  return {type:'normal',date:key,label:'Normal Schedule'};
}
function isCalendarBlocked(date){
  const rule=calendarRuleForDate(date);
  return rule.type==='no-school'?{blocked:true,reason:'District no-school date',rule}:{blocked:false,reason:null,rule};
}
function isAutomationSuppressed(date){
  const rule=calendarRuleForDate(date);
  if(rule.type==='no-school')return {blocked:true,reason:'District no-school date',rule};
  if(rule.type==='remote')return {blocked:true,reason:'District remote day',rule};
  return {blocked:false,reason:null,rule};
}
function countEligibleSchoolDays(anchorDate,targetDate){
  const a=new Date(anchorDate.getFullYear(),anchorDate.getMonth(),anchorDate.getDate(),12);
  const t=new Date(targetDate.getFullYear(),targetDate.getMonth(),targetDate.getDate(),12);
  if(a.getTime()===t.getTime())return 0;
  const step=t>a?1:-1;
  let count=0;
  const d=new Date(a);
  while(d.getTime()!==t.getTime()){
    d.setDate(d.getDate()+step);
    const dow=d.getDay();
    if(dow===0||dow===6)continue;
    if(isCalendarBlocked(d).blocked)continue;
    count+=step;
  }
  return count;
}

function schoolCycleAnchor(){return schoolScheduleProfile.anchorDate||schedulerCalendar.anchorDate||localDateKey(new Date())}
function schoolCycleLetters(){return [...schoolScheduleProfile.cycleDays]}
function schoolCycleGroup(index){return schoolScheduleProfile.dayGroups[index]||null}
function alternateGroupLabel(phase="A"){return (schoolCycleGroup(String(phase).toUpperCase()==="B"?1:0)?.label)||schoolCycleLetters()[String(phase).toUpperCase()==="B"?1:0]||String(phase).toUpperCase()}
function normalizedDayType(value,fallback="Any"){const allowed=new Set(["Any","Mixed",...(schoolScheduleProfile.dayGroups||[]).map(x=>x.label)]);return allowed.has(String(value))?String(value):(allowed.has(String(fallback))?String(fallback):"Any")}

function schoolCycleForDate(date=new Date()){
  const key=localDateKey(date);
  const dow=date.getDay();
  const blocked=isCalendarBlocked(date);
  const isStudentSchoolDay=dow!==0&&dow!==6&&!blocked.blocked;
  const anchorKey=schoolCycleAnchor(),anchor=dateFromKey(anchorKey);
  if(!anchor)return {date:key,isStudentSchoolDay:false,cycleDay:null,dayColor:null,reason:"Invalid school-cycle anchor"};

  const offset=countEligibleSchoolDays(anchor,date);
  const letters=schoolCycleLetters(),index=((offset%letters.length)+letters.length)%letters.length;
  const projectedCycleDay=letters[index],projectedGroup=groupForCycleDay(schoolScheduleProfile,projectedCycleDay);
  const projectedDayColor=projectedGroup?.label||projectedCycleDay;
  return {
    date:key,
    anchorDate:anchorKey,
    isStudentSchoolDay,
    cycleDay:isStudentSchoolDay?projectedCycleDay:null,
    dayColor:isStudentSchoolDay?projectedDayColor:null,
    projectedCycleDay,
    projectedDayColor,dayGroup:projectedGroup,
    index,
    reason:isStudentSchoolDay?null:(blocked.blocked?blocked.reason:"Weekend")
  };
}
function normalizeCycleDays(value,fallback=[]){
  const src=Array.isArray(value)?value:fallback;
  const allowed=schoolCycleLetters();return [...new Set(src.map(x=>String(x||"").trim()).filter(x=>allowed.includes(x)))];
}
function periodDefaultCycleDays(period){
  const p=String(period||"").trim();
  return [...(schoolScheduleProfile.periodCycleDays[p]||[])];
}
function cycleDaysDayColor(cycleDays){
  const days=normalizeCycleDays(cycleDays);
  for(const group of schoolScheduleProfile.dayGroups||[])if(days.length&&days.every(x=>group.cycleDays.includes(x)))return group.label;
  return days.length?"Mixed":"Any";
}
function schoolCycleMatches({cycleDays=[],dayType="Any"}={},date=new Date()){
  const status=schoolCycleForDate(date);
  if(!status.isStudentSchoolDay)return false;
  const days=normalizeCycleDays(cycleDays);
  if(days.length&&!days.includes(status.cycleDay))return false;
  if(dayType!=="Any"&&dayType!=="Mixed"&&dayType!==status.dayColor)return false;
  return true;
}

function automationMatchesDate(event,date){
  const blocked=isAutomationSuppressed(date);
  if(blocked.blocked)return {match:false,reason:blocked.reason};
  const key=localDateKey(date);
  const mode=String(event.scheduleMode||"weekly");

  if(mode==="dates"){
    return {match:Array.isArray(event.includeDates)&&event.includeDates.includes(key),reason:"Specific dates"};
  }

  if(mode==="schoolcycle"){
    const status=schoolCycleForDate(date);
    if(!status.isStudentSchoolDay)return {match:false,reason:status.reason||"Not a student school day"};
    const cycleDays=normalizeCycleDays(event.cycleDays);
    const dayType=String(event.dayType||"Any");
    const cycleMatch=!cycleDays.length||cycleDays.includes(status.cycleDay);
    const colorMatch=dayType==="Any"||dayType==="Mixed"||dayType===status.dayColor;
    return {match:cycleMatch&&colorMatch,reason:`${status.dayColor} Day • Cycle ${status.cycleDay}`};
  }

  if(mode==="alternating"){
    const status=schoolCycleForDate(date);
    if(!status.isStudentSchoolDay)return {match:false,reason:status.reason||"Not a student school day"};
    const phase=classAlternatingPhaseForDate(event.anchorDate,date);
    return {match:phase===(event.alternatePhase||"A"),reason:`Alternating ${phase} • Cycle ${status.cycleDay}`};
  }

  const days=Array.isArray(event.days)?event.days.map(Number):[];
  return {match:days.includes(date.getDay()),reason:"Weekly"};
}

const AUTOMATION_ACTIONS=new Set([
  "tv.power","display.clear","display.text","display.url","display.media","display.timer.class-end",
  "govee.power","govee.color","govee.brightness","govee.temp","govee.scene"
]);
function normalizeAutomation(input={},existing={}){
  const id=cleanId(input.id||existing.id||`auto-${crypto.randomUUID()}`);
  if(!id)throw new Error("A valid automation ID is required");
  const time=String(input.time||existing.time||"08:00");
  if(!validTime(time))throw new Error("Time must be a valid HH:MM value");
  const days=(Array.isArray(input.days)?input.days:existing.days||[1,2,3,4,5])
    .map(Number).filter(x=>Number.isInteger(x)&&x>=0&&x<=6);
  const action=String(input.action||existing.action||"").trim();
  if(!AUTOMATION_ACTIONS.has(action))throw new Error(`Unsupported automation action: ${action}`);
  const targets=Array.isArray(input.targets)?input.targets.map(cleanId).filter(Boolean):
    (Array.isArray(existing.targets)?existing.targets:["tv1"]);
  const scheduleMode=["weekly","alternating","schoolcycle","dates"].includes(String(input.scheduleMode||existing.scheduleMode||"weekly"))
    ? String(input.scheduleMode||existing.scheduleMode||"weekly") : "weekly";
  const alternatePhase=String(input.alternatePhase||existing.alternatePhase||"A").toUpperCase()==="B"?"B":"A";
  const anchorRaw=input.anchorDate??existing.anchorDate??"";
  if(anchorRaw&&!validDateKey(anchorRaw))throw new Error("Automation anchor must be a valid YYYY-MM-DD date");
  const anchorDate=anchorRaw?String(anchorRaw):"";
  const offsetValue=Number(input.classTimeOffsetMinutes??existing.classTimeOffsetMinutes??0);
  if(!Number.isFinite(offsetValue))throw new Error("Class time offset must be a finite number");
  const includeDates=uniqueDateKeys(input.includeDates===undefined?existing.includeDates:input.includeDates);
  return {
    id,
    name:String(input.name??existing.name??action).trim().slice(0,120),
    enabled:input.enabled===undefined?(existing.enabled!==false):!!input.enabled,
    time,
    days:[...new Set(days)],
    scheduleMode,
    alternatePhase,
    anchorDate,
    includeDates,
    dayType:normalizedDayType(input.dayType??existing.dayType??"Any"),
    cycleDays:normalizeCycleDays(input.cycleDays===undefined?existing.cycleDays:input.cycleDays),
    period:String(input.period??existing.period??"").trim().slice(0,40),
    classIds:[...new Set((Array.isArray(input.classIds)?input.classIds:(Array.isArray(existing.classIds)?existing.classIds:[input.classId??existing.classId].filter(Boolean))).map(String).filter(Boolean))],
    classId:String((Array.isArray(input.classIds)&&input.classIds.length?input.classIds[0]:(input.classId??existing.classId??""))),
    classTimeReference:String(input.classTimeReference??existing.classTimeReference??"start")==="end"?"end":"start",
    classTimeOffsetMinutes:Math.max(-720,Math.min(720,offsetValue)),
    useClassTargets:input.useClassTargets===undefined?(existing.useClassTargets!==false):!!input.useClassTargets,
    action,
    targets:[...new Set(targets)],
    payload:(input.payload&&typeof input.payload==="object")?input.payload:(existing.payload||{}),
    actions:Array.isArray(input.actions)
      ? input.actions.map((item,index)=>{
          const stepAction=String(item?.action||"").trim();
          if(!AUTOMATION_ACTIONS.has(stepAction))throw new Error(`Unsupported automation action: ${stepAction||"(blank)"}`);
          const delaySeconds=Number(item?.delaySeconds??0);
          if(!Number.isFinite(delaySeconds))throw new Error(`Automation step ${index+1} delay must be a finite number`);
          return {
          // Action IDs are globally unique in SQLite. Scope them to the
          // automation instead of reusing generic step-1/step-2 identifiers.
          id:`${id.slice(0,60)}-step-${index+1}`,
          action:stepAction,
          targets:Array.isArray(item?.targets)?[...new Set(item.targets.map(cleanId).filter(Boolean))]:[],
          useEventTargets:item?.useEventTargets!==false,
          payload:(item?.payload&&typeof item.payload==="object")?item.payload:{},
          delaySeconds:Math.max(0,Math.min(3600,delaySeconds)),
          continueOnError:item?.continueOnError!==false
        }})
      : (Array.isArray(existing.actions)?existing.actions:[]),
    timerOverlay:input.timerOverlay===null?null:((input.timerOverlay&&typeof input.timerOverlay==="object")?input.timerOverlay:(existing.timerOverlay||null)),
    lastRun:existing.lastRun||null,
    lastExec:existing.lastExec||null,
    lastExecByClass:(existing.lastExecByClass&&typeof existing.lastExecByClass==="object")?existing.lastExecByClass:{},
    createdAt:existing.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}


function automationTargetDomain(action){
  const a=String(action||"").trim().toLowerCase();

  // Lighting targets are Govee devices/groups.
  if(a.startsWith("govee.") || a.startsWith("lighting.")){
    return "lighting";
  }

  // TV/display/AV actions use classroom display targets.
  if(a==="tv.power" || a.startsWith("display.") || a.startsWith("av.")){
    return "display";
  }

  return "other";
}

function automationDisplayTargets(targets){
  return [...new Set((targets||[]).flatMap(t=>{
    const id=cleanId(t);
    if(id==="all")return Object.keys(devices).filter(k=>devices[k]?.enabled!==false);
    if(Array.isArray(displayGroups[id]))return displayGroups[id];
    if(devices[id]&&devices[id].enabled!==false)return [id];
    return [];
  }))];
}


function automationVariableContext(event,date=new Date()){
  const cls=event._class||activeAutomationClassAt(event,date)||classScheduleById(event.classId)||activeClassAt(date);
  const linkedClasses=automationClassIds(event).map(classScheduleById).filter(Boolean);
  const end=cls?classEndDate(cls,date):null;
  return {
    "%date%":date.toLocaleDateString("en-US",{timeZone:SCHEDULER_TIMEZONE}),
    "%time%":date.toLocaleTimeString("en-US",{timeZone:SCHEDULER_TIMEZONE,hour:"numeric",minute:"2-digit"}),
    "%day%":date.toLocaleDateString("en-US",{timeZone:SCHEDULER_TIMEZONE,weekday:"long"}),
    "%class%":cls?.name||"",
    "%class_short%":cls?.shortName||"",
    "%classes%":linkedClasses.map(c=>c.name).join(", "),
    "%classes_short%":linkedClasses.map(c=>c.shortName||c.name).join(", "),
    "%class_start%":cls?(effectiveClassTimes(cls,date)?.startTime||cls.startTime):"",
    "%class_end%":cls?(effectiveClassTimes(cls,date)?.endTime||cls.endTime):"",
    "%minutes_left%":end?String(Math.max(0,Math.ceil((end-date)/60000))):"",
    "%schedule_day%":schoolCycleForDate(date).dayColor||"",
    "%day_color%":schoolCycleForDate(date).dayColor||"",
    "%cycle_day%":schoolCycleForDate(date).cycleDay||"",
    "%period%":cls?.period||event?.period||"",
    "%room%":deviceConfig?.room||ROOM_NAME||""
  };
}
function expandAutomationVariables(value,event,date=new Date()){
  if(typeof value!=="string")return value;
  let out=value;for(const [k,v] of Object.entries(automationVariableContext(event,date)))out=out.split(k).join(String(v));
  return out;
}
function expandAutomationPayload(value,event,date=new Date()){
  if(Array.isArray(value))return value.map(v=>expandAutomationPayload(v,event,date));
  if(value&&typeof value==="object"){const o={};for(const [k,v] of Object.entries(value))o[k]=expandAutomationPayload(v,event,date);return o}
  return expandAutomationVariables(value,event,date);
}
async function runSingleAutomationAction(event,{manual=false,skipOverlay=false,skipAudit=false}={}){
  const p=expandAutomationPayload(event.payload||{},event,new Date());
  const action=event.action;
  if(!AUTOMATION_ACTIONS.has(action))throw new Error(`Unsupported automation action: ${action||"(blank)"}`);
  const outputs={action,targets:event.targets||[],results:[]};

  if(action==="tv.power"){
    const on=String(p.state||"on").toLowerCase()==="on";
    for(const target of event.targets||[]){
      const id=cleanId(target);
      if(id==="all"){
        outputs.results.push(await directPluto({action:"cecAllOutputs",index:on?0:1}));
      }else if(id==="hdmi-all"){
        outputs.results.push(await directPluto({action:"cecAllHdmi",index:on?0:1}));
      }else if(id==="hdbt-all"){
        outputs.results.push(await directPluto({action:"cecAllHdbt",index:on?0:1}));
      }else{
        const cfg=devices[id];
        const output=Number(p.output||cfg?.avOutput||id.replace(/\D/g,""));
        if(!output||output<1||output>8)throw new Error(`No Pluto output mapped for ${id}`);
        outputs.results.push(await directPluto({
          action:"cecOutput",output,connection:p.connection==="hdmi"?"hdmi":"hdbt",index:on?0:1
        }));
      }
    }
  }else if(action==="display.timer.class-end"){
    const ts=automationDisplayTargets(event.targets),cls=event._class||activeAutomationClassAt(event,new Date())||classScheduleById(event.classId)||activeClassAt(new Date());
    if(!cls)throw new Error("No class schedule is available for the class-end timer");
    const now=new Date();if(!manual&&!classScheduleMatchesDate(cls,now))throw new Error(`${cls.name} is not scheduled today`);
    const chain=timerLinkedClassChain(event,cls,now,{followLinkedClasses:true,followGapMinutes:15});
    const endAt=chain.endAt||resolvedOccurrenceEndDate(event,cls,now),remaining=Math.max(0,Math.floor((endAt-Date.now())/1000));
    if(remaining<=0)throw new Error(`${cls.name} has already ended`);
    const labelClass=chain.finalClass||cls;
    outputs.results.push(await executeCommand({type:"display.timer",target:ts,payload:{
      visible:true,running:true,mode:"countdown",timerInstanceId:commandId(),durationSeconds:remaining,remainingSeconds:remaining,endAt:endAt.getTime(),startedAt:null,
      label:String(p.label||`${cls.shortName||cls.name} • Class Ends`),position:p.position||"bottom",fontSize:Number(p.fontSize||64),
      textColor:p.textColor||"#ffffff",borderColor:p.borderColor||"#ffffff",borderWidth:Number(p.borderWidth??4),borderRadius:Number(p.borderRadius??18),
      background:p.background||"rgba(0,0,0,.35)",linkedClassIds:chain.classes.map(c=>c.id),linkedClassNames:chain.classes.map(c=>c.name),finalClassId:labelClass.id
    }},"automation"));
  }else if(action==="display.clear"){
    const ts=automationDisplayTargets(event.targets);
    outputs.results.push(await executeCommand({type:"display.clear",target:ts,payload:{}},"automation"));
  }else if(action==="display.text"){
    const ts=automationDisplayTargets(event.targets);
    if(p.clearBefore!==false)outputs.results.push(await executeCommand({type:"display.clear",target:ts,payload:{}},"automation"));
    if(p.background)outputs.results.push(await executeCommand({type:"display.background",target:ts,payload:{color:p.background}},"automation"));
    if(p.title)outputs.results.push(await executeCommand({type:"display.title",target:ts,payload:{text:String(p.title),color:p.titleColor||"#ffffff",size:Number(p.titleSize||72)}},"automation"));
    if(p.subtitle)outputs.results.push(await executeCommand({type:"display.subtitle",target:ts,payload:{text:String(p.subtitle),color:p.subtitleColor||"#ffffff",size:Number(p.subtitleSize||40)}},"automation"));
    outputs.results.push(await executeCommand({type:"display.text",target:ts,payload:{
      text:String(p.text||""),color:p.color||"#ffffff",size:Number(p.size||54),position:p.position||"center"
    }},"automation"));
  }else if(action==="display.url"){
    const ts=automationDisplayTargets(event.targets);
    if(p.clearBefore!==false)outputs.results.push(await executeCommand({type:"display.clear",target:ts,payload:{}},"automation"));
    const url=String(p.url||"").trim();
    if(!url)throw new Error("URL is required");
    outputs.results.push(await executeCommand({type:"display.web",target:ts,payload:{url,localDirect:p.localDirect!==false}},"automation"));
  }else if(action==="display.media"){
    const ts=automationDisplayTargets(event.targets);
    if(p.clearBefore!==false)outputs.results.push(await executeCommand({type:"display.clear",target:ts,payload:{}},"automation"));
    const name=resolveAutomationMediaName(p);
    const full=path.join(MEDIA_DIR,name);
    const rec=mediaLibrary.files[name]||{},type=rec.type||classifyMedia(name,rec.mime||"");
    const sourceUrl=automationMediaUrl(name);
    outputs.media={storedName:name,originalName:rec.originalName||name,type,size:fs.statSync(full).size,url:sourceUrl};
    if(type==="image"){
      outputs.results.push(await executeCommand({type:"display.image",target:ts,payload:{url:sourceUrl,fit:p.fit||"contain",retry:true}},"automation"));
    }else if(type==="video"){
      outputs.results.push(await executeCommand({type:"display.video",target:ts,payload:{url:sourceUrl,fit:p.fit||"contain",autoplay:true,muted:!!p.muted,loop:!!p.loop}},"automation"));
    }else if(type==="pdf"){
      outputs.results.push(await executeCommand({type:"display.pdf",target:ts,payload:{url:documentViewerUrl(name,p),sourceUrl:mediaUrl(name)}},"automation"));
    }else if(type==="presentation"||type==="document"){
      if(!rec.generatedPdf||!fs.existsSync(path.join(MEDIA_DIR,rec.generatedPdf)))throw new Error("Document conversion is not ready");
      outputs.results.push(await executeCommand({type:"display.document",target:ts,payload:{
        url:documentViewerUrl(rec.generatedPdf,p),sourceUrl:mediaUrl(name),pdfUrl:mediaUrl(rec.generatedPdf),originalName:rec.originalName||name
      }},"automation"));
    }else throw new Error(`Media type ${type} cannot be displayed`);
  }else if(action.startsWith("govee.")){
    const map={power:null,color:"color",brightness:"brightness",temp:"temp",scene:"scene"};
    const kind=action.split(".")[1];
    for(const target of event.targets||[]){
      if(kind==="power")outputs.results.push(await directGoveeCommand(target,String(p.state||"on").toLowerCase()==="on"?"on":"off",p));
      else outputs.results.push(await directGoveeCommand(target,map[kind],p));
    }
  }


  // Optional scheduled timer overlay addon.
  // This runs in addition to the event's primary action.
  const timerOverlay=event.timerOverlay&&typeof event.timerOverlay==="object"?event.timerOverlay:null;
  if(!skipOverlay&&timerOverlay?.enabled){
    const timerTargets=automationDisplayTargets(
      timerOverlay.useEventTargets!==false
        ? event.targets
        : (Array.isArray(timerOverlay.targets)?timerOverlay.targets:event.targets)
    );

    const now=new Date();
    let remainingSeconds=0;
    let endAt=null;

    if(timerOverlay.source==="class-end"){
      const cls=event._class||activeAutomationClassAt(event,now)||classScheduleById(event.classId)||activeClassAt(now);
      if(cls&&classScheduleMatchesDate(cls,now)){
        endAt=resolvedOccurrenceEndDate(event,cls,now);
        remainingSeconds=endAt?Math.max(0,Math.floor((endAt.getTime()-Date.now())/1000)):0;
      }
    }else{
      remainingSeconds=Math.max(0,Number(timerOverlay.durationSeconds||600));
      endAt=new Date(Date.now()+remainingSeconds*1000);
    }

    if(remainingSeconds>0){
      outputs.results.push(await executeCommand({
        type:"display.timer",
        target:timerTargets,
        payload:{
          visible:true,
          running:true,
          mode:"countdown",
          timerInstanceId:commandId(),
          durationSeconds:remainingSeconds,
          remainingSeconds,
          endAt:endAt.getTime(),
          startedAt:null,
          label:expandAutomationVariables(String(timerOverlay.label||"Time Remaining"),event,now),
          position:timerOverlay.position||"bottom",
          fontSize:Number(timerOverlay.fontSize||64),
          textColor:timerOverlay.textColor||"#ffffff",
          borderColor:timerOverlay.borderColor||"#ffffff",
          borderWidth:Number(timerOverlay.borderWidth??4),
          borderRadius:Number(timerOverlay.borderRadius??18),
          background:timerOverlay.background||"rgba(0,0,0,.35)"
        }
      },"automation"));
    }
  }

  if(!skipAudit)audit({kind:"automation.run",automationId:event.id,name:event.name,manual,action:event.action,targets:event.targets,ok:true});
  return {ok:true,eventId:event.id,name:event.name,manual,...outputs};
}


function timerLinkedClassChain(event,baseClass,now=new Date(),timerOverlay={}){
  if(!baseClass)return {classes:[],endAt:null,finalClass:null};

  // Transition pseudo-classes are already the gap being counted. They must end at
  // their own resolved boundary (for example 13:05 -> 13:13) and must not be
  // chained into subsequent selected full classes.
  if(event?._classIsTransition||isTransitionClass(baseClass)){
    const endAt=resolvedOccurrenceEndDate(event,baseClass,now);
    return {classes:[baseClass],endAt,finalClass:baseClass,gapMinutes:0,linked:false,transition:true};
  }

  // Always build the candidate list from the full multi-class selection on the
  // automation, not merely the occurrence that happened to trigger this run.
  // resolveAutomationForClass() preserves classIds, but accepting the private
  // source list as well makes this resilient to future occurrence normalization.
  const ids=[
    ...(Array.isArray(event?._automationClassIds)?event._automationClassIds:[]),
    ...automationClassIds(event),
    baseClass.id
  ].filter(Boolean).map(String);
  const selected=[...new Set(ids)]
    .map(classScheduleById)
    .filter(Boolean)
    .filter(c=>c.enabled!==false&&classScheduleMatchesDate(c,now));

  if(!selected.some(c=>c.id===baseClass.id))selected.push(baseClass);

  const maxGap=Math.max(0,Math.min(120,Number(timerOverlay.followGapMinutes??schoolScheduleProfile.continuation?.maximumGapMinutes??15)));
  const follow=timerOverlay.followLinkedClasses!==false;
  const chain=[baseClass];
  const used=new Set([baseClass.id]);
  const baseTimes=effectiveClassTimes(baseClass,now);
  let cursorEnd=timeToMinutes(baseTimes?.endTime||baseClass.endTime);

  if(follow){
    // Follow the schedule chronologically only through an explicitly linked
    // continuation (or imported compatibility mapping). The gap threshold is
    // a secondary guard, never the identity test.
    while(true){
      const next=selected
        .filter(c=>!used.has(c.id))
        .map(c=>{const t=effectiveClassTimes(c,now);return t?{c,start:timeToMinutes(t.startTime),end:timeToMinutes(t.endTime)}:null})
        .filter(Boolean)
        .filter(x=>x.start>=cursorEnd&&x.start-cursorEnd<=maxGap)
        .filter(x=>isValidTimerContinuation(chain[chain.length-1],x.c))
        .sort((a,b)=>a.start-b.start||b.end-a.end||String(a.c.name||'').localeCompare(String(b.c.name||'')))[0];
      if(!next)break;
      chain.push(next.c);
      used.add(next.c.id);
      cursorEnd=Math.max(cursorEnd,next.end);
    }
  }

  const final=chain[chain.length-1]||baseClass;
  return {
    classes:chain,
    endAt:final.id===baseClass.id?resolvedOccurrenceEndDate(event,final,now):classEndDate(final,now),
    finalClass:final,
    gapMinutes:maxGap,
    linked:chain.length>1
  };
}

async function runAutomationTimerOverlay(event,{manual=false}={}){
  const timerOverlay=event.timerOverlay&&typeof event.timerOverlay==="object"?event.timerOverlay:null;
  if(!timerOverlay?.enabled)return {ok:true,skipped:true,reason:"disabled"};

  const timerTargetSource=(event.useClassTargets!==false&&Array.isArray(event._classDefaultTargets)&&event._classDefaultTargets.length)
    ? event._classDefaultTargets
    : (timerOverlay.useEventTargets!==false
      ? event.targets
      : (Array.isArray(timerOverlay.targets)&&timerOverlay.targets.length?timerOverlay.targets:event.targets));
  const timerTargets=automationDisplayTargets(timerTargetSource);
  if(!timerTargets.length)throw new Error("Timer overlay has no display targets");

  const now=new Date();
  let remainingSeconds=0,endAt=null,cls=null;

  if(timerOverlay.source==="class-end"){
    // A resolved class occurrence takes priority so multi-class events follow the class
    // that actually triggered this occurrence. An explicitly selected timer class is only
    // used when the event has no resolved class occurrence.
    cls=event._class
      || classScheduleById(timerOverlay.classId)
      || activeAutomationClassAt(event,now)
      || classScheduleById(event.classId)
      || (Array.isArray(event.classIds)?event.classIds.map(classScheduleById).find(Boolean):null)
      || activeClassAt(now);

    if(!cls){
      throw new Error("Timer overlay is set to Linked Class End Time, but no timer class is selected, the event is not linked to a class, and no class is currently active.");
    }
    if(!manual&&!classScheduleMatchesDate(cls,now)){
      throw new Error(`Timer class "${cls.name}" is not scheduled today.`);
    }

    const chain=timerLinkedClassChain(event,cls,now,timerOverlay);
    endAt=chain.endAt||resolvedOccurrenceEndDate(event,cls,now);
    remainingSeconds=Math.max(0,Math.floor((endAt.getTime()-Date.now())/1000));
    if(chain.classes.length>1){
      cls={...cls,_timerChainNames:chain.classes.map(c=>c.name),_timerFinalClass:chain.finalClass};
    }

    // If Test Now is used after class end, show a terminal 00:00 overlay instead of silently doing nothing.
    if(remainingSeconds<=0){
      const result=await executeCommand({
        type:"display.timer",
        target:timerTargets,
        payload:{
          visible:true,running:false,mode:"countdown",
          timerInstanceId:commandId(),
          durationSeconds:0,remainingSeconds:0,endAt:null,startedAt:null,
          label:expandAutomationVariables(String(timerOverlay.label||"Time Remaining"),{...event,_class:cls},now),
          position:timerOverlay.position||"bottom",
          fontSize:Number(timerOverlay.fontSize||64),
          textColor:timerOverlay.textColor||"#ffffff",
          borderColor:timerOverlay.borderColor||"#ffffff",
          borderWidth:Number(timerOverlay.borderWidth??4),
          borderRadius:Number(timerOverlay.borderRadius??18),
          background:timerOverlay.background||"rgba(0,0,0,.35)"
        }
      },"automation");
      return {ok:true,atZero:true,classId:cls.id,className:cls.name,result};
    }
  }else{
    remainingSeconds=Math.max(0,Number(timerOverlay.durationSeconds||600));
    endAt=new Date(Date.now()+remainingSeconds*1000);
  }

  const contextEvent=cls?{...event,_class:cls}:event;
  const result=await executeCommand({
    type:"display.timer",
    target:timerTargets,
    payload:{
      visible:true,running:true,mode:"countdown",
      timerInstanceId:commandId(),
      durationSeconds:remainingSeconds,
      remainingSeconds,
      endAt:endAt.getTime(),
      startedAt:null,
      label:expandAutomationVariables(String(timerOverlay.label||"Time Remaining"),contextEvent,now),
      position:timerOverlay.position||"bottom",
      fontSize:Number(timerOverlay.fontSize||64),
      textColor:timerOverlay.textColor||"#ffffff",
      borderColor:timerOverlay.borderColor||"#ffffff",
      borderWidth:Number(timerOverlay.borderWidth??4),
      borderRadius:Number(timerOverlay.borderRadius??18),
      background:timerOverlay.background||"rgba(0,0,0,.35)"
    }
  },"automation");

  return {ok:true,classId:cls?.id||null,className:cls?.name||null,remainingSeconds,endAt:endAt.toISOString(),result};
}

function automationRunFailures(result={}){
  const failures=(Array.isArray(result.steps)?result.steps:[])
    .filter(step=>step?.ok===false)
    .map(step=>({kind:"action",index:step.index??null,action:step.action||"unknown",error:step.error||"Action failed"}));
  if(result.timerOverlay?.ok===false)failures.push({kind:"timer-overlay",action:"display.timer",error:result.timerOverlay.error||"Timer overlay failed"});
  return failures;
}

async function runClassroomAutomation(event,{manual=false,bypassAnnouncementPriority=false}={}){
  if(morningAnnouncementsRuntime.active&&!bypassAnnouncementPriority){const err=new Error("Morning Announcements have priority; automation is blocked until announcements end");err.code="ANNOUNCEMENTS_PRIORITY_ACTIVE";throw err}
  const additional=Array.isArray(event.actions)?event.actions:[];
  const steps=[{id:"primary",action:event.action,targets:event.targets,useEventTargets:true,payload:event.payload||{},delaySeconds:0,continueOnError:true},...additional];
  const combined={ok:true,eventId:event.id,name:event.name,manual,results:[],steps:[]};

  // alpha.23: every scheduled/manual automation starts from a known display state,
  // but the pre-clear is TARGET-AWARE. A TV5-only event clears TV5 only; events
  // spanning display actions clear the union of their effective display targets.
  // Pure non-display events retain the historical safety behavior and clear all
  // enabled displays because they have no narrower display scope. Timer overlays are
  // applied after normal actions and are included when they define an explicit scope.
  try{
    const displayScope=new Set();
    const eventDomain=automationTargetDomain(event.action);
    for(const step of steps){
      const stepAction=step?.action||event.action;
      const stepDomain=automationTargetDomain(stepAction);
      if(stepDomain!=="display")continue;
      const explicitTargets=Array.isArray(step?.targets)&&step.targets.length?step.targets:[];
      let rawTargets;
      if(step?.useEventTargets!==false && stepDomain===eventDomain)rawTargets=event.targets;
      else if(explicitTargets.length)rawTargets=explicitTargets;
      else rawTargets=["all"];
      // TV aggregate selectors are power-domain aliases; for screen clearing they
      // correspond to the enabled Classroom Control Hub displays.
      const normalized=(rawTargets||[]).map(cleanId).map(x=>["hdmi-all","hdbt-all"].includes(x)?"all":x);
      for(const id of automationDisplayTargets(normalized))displayScope.add(id);
    }
    const timer=event.timerOverlay&&typeof event.timerOverlay==="object"?event.timerOverlay:null;
    if(timer?.enabled){
      const tt=(event.useClassTargets!==false&&Array.isArray(event._classDefaultTargets)&&event._classDefaultTargets.length)
        ? event._classDefaultTargets
        : (timer.useEventTargets!==false?event.targets:(Array.isArray(timer.targets)&&timer.targets.length?timer.targets:event.targets));
      for(const id of automationDisplayTargets(tt||[]))displayScope.add(id);
    }
    const clearTargets=displayScope.size?[...displayScope]:["all"];
    const clearResult=await runSingleAutomationAction({
      ...event,
      action:"display.clear",
      targets:clearTargets,
      payload:{},
      timerOverlay:null
    },{manual,skipOverlay:true,skipAudit:true});
    combined.results.push(...(clearResult.results||[]));
    combined.steps.push({index:0,id:"pre-clear",action:"display.clear",targets:clearTargets,ok:true,automatic:true});
  }catch(err){
    combined.ok=false;
    combined.steps.push({index:0,id:"pre-clear",action:"display.clear",targets:[],ok:false,error:err.message,automatic:true});
    diagnosticError(err,{component:"automation.pre-clear",operation:"display.clear",data:{automationId:event.id}});
    // Clearing is a safety/reset action; continue so lighting/TV shutdown and other
    // non-display automation still executes even if a display client is unavailable.
  }

  for(let i=0;i<steps.length;i++){
    const step=steps[i]||{};
    const delay=Math.max(0,Number(step.delaySeconds||0));
    if(delay)await new Promise(r=>setTimeout(r,delay*1000));
    const stepAction=step.action||event.action;
    const stepDomain=automationTargetDomain(stepAction);
    const eventDomain=automationTargetDomain(event.action);
    const explicitTargets=Array.isArray(step.targets)&&step.targets.length ? step.targets : [];
    let resolvedTargets;
    if(step.useEventTargets!==false && stepDomain===eventDomain){
      resolvedTargets=event.targets;
    }else if(stepDomain==="display"&&event.useClassTargets!==false&&Array.isArray(event._classDefaultTargets)&&event._classDefaultTargets.length){
      // Class-default display targets are a display-domain policy, not a property
      // of the primary action. This also applies to display steps inside lighting-
      // led or TV-power automations.
      resolvedTargets=event._classDefaultTargets;
    }else if(explicitTargets.length){
      resolvedTargets=explicitTargets;
    }else if(stepDomain==="display"){
      // Safe default for legacy cross-domain actions created before alpha.17.
      resolvedTargets=["all"];
    }else if(stepDomain==="lighting"){
      // Prefer the canonical ALL Govee group; otherwise execute against every known lighting device.
      resolvedTargets=goveeGroups.all?["all"]:Object.keys(goveeDevices);
    }else{
      resolvedTargets=[];
    }
    const stepEvent={...event,action:stepAction,payload:step.payload||{},targets:resolvedTargets,timerOverlay:null};
    try{
      const result=await runSingleAutomationAction(stepEvent,{manual,skipOverlay:true,skipAudit:true});
      combined.results.push(...(result.results||[]));
      combined.steps.push({index:i+1,id:step.id||`step-${i+1}`,action:stepEvent.action,targets:stepEvent.targets,ok:true});
    }catch(err){
      combined.ok=false;
      combined.steps.push({index:i+1,id:step.id||`step-${i+1}`,action:stepEvent.action,targets:stepEvent.targets,ok:false,error:err.message});
      if(step.continueOnError===false)break;
    }
  }

  if(event.timerOverlay?.enabled){
    try{
      combined.timerOverlay=await runAutomationTimerOverlay(event,{manual});
      if(combined.timerOverlay?.result)combined.results.push(combined.timerOverlay.result);
    }catch(err){
      combined.ok=false;
      combined.timerOverlay={ok:false,error:err.message};
      diagnosticError(err,{component:"automation.timer",operation:"timer-overlay",data:{automationId:event.id,classId:event.timerOverlay?.classId||event.classId||null}});
    }
  }

  audit({kind:"automation.run",automationId:event.id,name:event.name,manual,actions:steps.map(x=>x.action),targets:event.targets,ok:combined.ok});
  return combined;
}

function safeStoredName(value){
  const name=path.basename(String(value||""));
  if(!name || name==="." || name==="..")throw new Error("Invalid file name");
  return name;
}
function mediaUrl(name){return `/media/${encodeURIComponent(name)}`}
function resolveAutomationMediaName(payload={}){
  const candidates=[payload.storedName,payload.media,payload.file,payload.name].map(v=>String(v||"").trim()).filter(Boolean);
  for(const raw of candidates){
    const base=path.basename(raw);
    if(fs.existsSync(path.join(MEDIA_DIR,base)))return base;
    const byOriginal=Object.entries(mediaLibrary.files||{}).find(([stored,rec])=>String(rec?.originalName||"")===raw&&fs.existsSync(path.join(MEDIA_DIR,stored)));
    if(byOriginal)return byOriginal[0];
  }
  throw new Error(`Media not found: ${candidates[0]||"no media selected"}`);
}
function automationMediaUrl(name){
  const stamp=encodeURIComponent(String(fs.statSync(path.join(MEDIA_DIR,name)).mtimeMs||Date.now()));
  return `${mediaUrl(name)}?v=${stamp}`;
}
function classifyMedia(name,mime=""){
  const ext=path.extname(name).toLowerCase();
  if([".png",".jpg",".jpeg",".gif",".webp",".svg",".bmp"].includes(ext)||mime.startsWith("image/"))return "image";
  if([".mp4",".webm",".mov",".m4v"].includes(ext)||mime.startsWith("video/"))return "video";
  if(ext===".pdf"||mime==="application/pdf")return "pdf";
  if([".ppt",".pptx",".odp"].includes(ext))return "presentation";
  if([".doc",".docx",".odt",".rtf"].includes(ext))return "document";
  return "file";
}
function officeConvertible(name){
  return ["presentation","document"].includes(classifyMedia(name));
}
async function convertOfficeToPdf(storedName){
  const src=path.join(MEDIA_DIR,safeStoredName(storedName));
  const stem=path.basename(storedName,path.extname(storedName));
  const generatedName=`${stem}.display.pdf`;
  const generatedPath=path.join(MEDIA_DIR,generatedName);

  const tmpDir=path.join(DATA_DIR,"convert-tmp",crypto.randomUUID());
  fs.mkdirSync(tmpDir,{recursive:true});
  try{
    await execFileAsync("libreoffice",[
      "--headless","--nologo","--nolockcheck","--nodefault","--nofirststartwizard",
      "--convert-to","pdf","--outdir",tmpDir,src
    ],{timeout:120000,maxBuffer:4*1024*1024});

    const candidates=fs.readdirSync(tmpDir).filter(x=>x.toLowerCase().endsWith(".pdf"));
    if(!candidates.length)throw new Error("LibreOffice did not create a PDF");
    const staged=`${generatedPath}.${crypto.randomUUID()}.tmp`;
    fs.copyFileSync(path.join(tmpDir,candidates[0]),staged);
    fs.renameSync(staged,generatedPath);
    return generatedName;
  }finally{
    fs.rmSync(tmpDir,{recursive:true,force:true});
  }
}
function documentViewerUrl(pdfName,opts={}){
  const q=new URLSearchParams();
  q.set("file",mediaUrl(pdfName));
  if(opts.autoAdvanceMs)q.set("auto",String(Math.max(0,Number(opts.autoAdvanceMs)||0)));
  if(opts.loop!==undefined)q.set("loop",opts.loop?"1":"0");
  if(opts.page)q.set("page",String(Math.max(1,Number(opts.page)||1)));
  return `/document-viewer/?${q.toString()}`;
}
function libraryRecordFromDisk(name){
  const full=path.join(MEDIA_DIR,name);
  if(!fs.existsSync(full))return null;
  const st=fs.statSync(full);
  const rec=mediaLibrary.files[name]||{};
  return {
    storedName:name,
    originalName:rec.originalName||name,
    url:mediaUrl(name),
    type:rec.type||classifyMedia(name,rec.mime||""),
    mime:rec.mime||"",
    size:st.size,
    modifiedAt:st.mtime.toISOString(),
    uploadedAt:rec.uploadedAt||st.birthtime.toISOString(),
    generatedPdf:rec.generatedPdf||null,
    conversionStatus:rec.conversionStatus||null,
    conversionError:rec.conversionError||null
  };
}
function listMediaLibrary(){
  const hidden=new Set();
  for(const rec of Object.values(mediaLibrary.files||{})){
    if(rec?.generatedPdf)hidden.add(rec.generatedPdf);
  }
  return fs.readdirSync(MEDIA_DIR,{withFileTypes:true})
    .filter(x=>x.isFile()&&x.name!==".gitkeep"&&!hidden.has(x.name))
    .map(x=>libraryRecordFromDisk(x.name))
    .filter(Boolean)
    .sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));
}


// -----------------------------------------------------------------------------
// v0.14 Classroom Presentation Mode
// -----------------------------------------------------------------------------

function cleanPresentationLabel(value,max=120){
  const v=String(value||"").replace(/[\u0000-\u001f]/g," ").trim();
  if(!v)throw new Error("Name is required");
  return v.slice(0,max);
}
function presentationId(){
  return `pres-${crypto.randomUUID()}`;
}
function presentationFolderId(){
  return `folder-${crypto.randomUUID()}`;
}
function defaultPresentationLibrary(){
  return {
    version:1,
    folders:{
      root:{id:"root",name:"Presentations",parentId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
    },
    presentations:{}
  };
}
let presentationLibrary=readJson(PRESENTATION_LIBRARY_FILE,defaultPresentationLibrary());
if(!presentationLibrary||typeof presentationLibrary!=="object")presentationLibrary=defaultPresentationLibrary();
if(!presentationLibrary.folders||typeof presentationLibrary.folders!=="object")presentationLibrary.folders={};
if(!presentationLibrary.folders.root)presentationLibrary.folders.root={id:"root",name:"Presentations",parentId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
if(!presentationLibrary.presentations||typeof presentationLibrary.presentations!=="object")presentationLibrary.presentations={};
let recoveredPresentationConversions=false;
for(const rec of Object.values(presentationLibrary.presentations))if(rec?.conversionStatus==="converting"){
  rec.conversionStatus=rec.slideCount>0?"ready":"failed";
  rec.conversionError=rec.slideCount>0?null:"Conversion was interrupted by a service restart; rebuild the presentation.";
  rec.lastRebuildError="Conversion interrupted by service restart";
  rec.updatedAt=new Date().toISOString();recoveredPresentationConversions=true;
}

function persistPresentationLibrary(){
  persistJson(PRESENTATION_LIBRARY_FILE,presentationLibrary);
}
if(recoveredPresentationConversions)persistPresentationLibrary();
function normalizePresentationFolderId(id){
  const v=String(id||"root");
  return presentationLibrary.folders[v]?v:"root";
}
function presentationDir(id){
  const rec=presentationLibrary.presentations[id];
  if(!rec)throw new Error("Presentation not found");
  return path.join(PRESENTATIONS_DIR,id);
}
function presentationSlideUrl(id,slide){
  const rec=presentationLibrary.presentations[id];
  if(!rec)throw new Error("Presentation not found");
  const n=Math.max(1,Math.min(Number(slide)||1,Number(rec.slideCount)||1));
  return `/presentations/${encodeURIComponent(id)}/slides/slide-${String(n).padStart(3,"0")}.jpg`;
}
function presentationPublicRecord(rec){
  if(!rec)return null;
  return {
    ...rec,
    originalUrl:rec.originalFile?`/presentations/${encodeURIComponent(rec.id)}/${encodeURIComponent(rec.originalFile)}`:null,
    pdfUrl:rec.pdfFile?`/presentations/${encodeURIComponent(rec.id)}/${encodeURIComponent(rec.pdfFile)}`:null,
    firstSlideUrl:rec.slideCount?presentationSlideUrl(rec.id,1):null
  };
}
function presentationDescendantFolderIds(folderId){
  const out=new Set([folderId]);
  let changed=true;
  while(changed){
    changed=false;
    for(const f of Object.values(presentationLibrary.folders)){
      if(f.id!=="root" && out.has(f.parentId) && !out.has(f.id)){out.add(f.id);changed=true;}
    }
  }
  return out;
}
function presentationFolderWouldCycle(folderId,newParentId){
  if(folderId==="root")return true;
  const descendants=presentationDescendantFolderIds(folderId);
  return descendants.has(newParentId);
}
function deletePresentationFiles(id){
  const dir=path.join(PRESENTATIONS_DIR,String(id||""));
  if(fs.existsSync(dir))fs.rmSync(dir,{recursive:true,force:true});
}
function deletePresentationRecord(id){
  const rec=presentationLibrary.presentations[id];
  if(!rec)return false;
  deletePresentationFiles(id);
  delete presentationLibrary.presentations[id];
  return true;
}
function xmlDecodeText(v){
  return String(v||"")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'")
    .replace(/&amp;/g,"&");
}
function extractPptxSpeakerNotes(file){
  const ext=path.extname(file).toLowerCase();
  if(ext!==".pptx")return [];
  try{
    const zip=new AdmZip(file);
    const entries=zip.getEntries()
      .filter(e=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(e.entryName))
      .sort((a,b)=>{
        const an=Number(a.entryName.match(/notesSlide(\d+)/i)?.[1]||0);
        const bn=Number(b.entryName.match(/notesSlide(\d+)/i)?.[1]||0);
        return an-bn;
      });
    const notes=[];
    for(const e of entries){
      const xml=e.getData().toString("utf8");
      const chunks=[...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m=>xmlDecodeText(m[1]).trim()).filter(Boolean);
      const text=chunks.filter(x=>!/^click to edit/i.test(x)).join("\n").trim();
      const n=Number(e.entryName.match(/notesSlide(\d+)/i)?.[1]||0);
      if(n>0)notes[n-1]=text;
    }
    return notes;
  }catch(err){
    audit({kind:"presentation.notes.error",error:err.message,file:path.basename(file)});
    return [];
  }
}
const presentationBuilds=new Map();
async function buildPresentationSlidesUnlocked(id){
  const rec=presentationLibrary.presentations[id];
  if(!rec)throw new Error("Presentation not found");
  const dir=presentationDir(id);
  const original=path.join(dir,rec.originalFile);
  const renderTmp=path.join(dir,`render-${crypto.randomUUID()}`);
  const slidesDir=path.join(dir,"slides");
  const stagedSlides=path.join(renderTmp,"slides");
  fs.mkdirSync(renderTmp,{recursive:true});
  fs.mkdirSync(stagedSlides,{recursive:true});

  try{
    let stagedPdf=path.join(renderTmp,"presentation.pdf");
    if(path.extname(original).toLowerCase()===".pdf")fs.copyFileSync(original,stagedPdf);
    else{
      const convertDir=path.join(renderTmp,"convert");fs.mkdirSync(convertDir,{recursive:true});
      await execFileAsync("libreoffice",[
        "--headless","--nologo","--nolockcheck","--nodefault","--nofirststartwizard",
        "--convert-to","pdf","--outdir",convertDir,original
      ],{timeout:180000,maxBuffer:8*1024*1024});
      const candidates=fs.readdirSync(convertDir).filter(x=>x.toLowerCase().endsWith(".pdf"));
      if(!candidates.length)throw new Error("LibreOffice did not create a presentation PDF");
      fs.copyFileSync(path.join(convertDir,candidates[0]),stagedPdf);
    }

    await execFileAsync("pdftoppm",[
      "-jpeg","-r","144","-jpegopt","quality=90",stagedPdf,path.join(stagedSlides,"raw")
    ],{timeout:180000,maxBuffer:8*1024*1024});

    const generated=fs.readdirSync(stagedSlides)
    .filter(x=>/^raw-\d+\.jpg$/i.test(x))
    .sort((a,b)=>Number(a.match(/(\d+)/)?.[1])-Number(b.match(/(\d+)/)?.[1]));
    if(!generated.length)throw new Error("No slide images were rendered");

    generated.forEach((name,i)=>fs.renameSync(path.join(stagedSlides,name),path.join(stagedSlides,`slide-${String(i+1).padStart(3,"0")}.jpg`)));
    const oldSlides=path.join(dir,`slides-old-${crypto.randomUUID()}`),finalPdf=path.join(dir,"presentation.pdf"),oldPdf=path.join(dir,`presentation-old-${crypto.randomUUID()}.pdf`);
    let movedSlides=false,movedPdf=false;
    try{
      if(fs.existsSync(slidesDir)){fs.renameSync(slidesDir,oldSlides);movedSlides=true}
      if(fs.existsSync(finalPdf)){fs.renameSync(finalPdf,oldPdf);movedPdf=true}
      fs.renameSync(stagedSlides,slidesDir);fs.renameSync(stagedPdf,finalPdf);
      fs.rmSync(oldSlides,{recursive:true,force:true});fs.rmSync(oldPdf,{force:true});
    }catch(error){
      fs.rmSync(slidesDir,{recursive:true,force:true});fs.rmSync(finalPdf,{force:true});
      if(movedSlides&&fs.existsSync(oldSlides))fs.renameSync(oldSlides,slidesDir);
      if(movedPdf&&fs.existsSync(oldPdf))fs.renameSync(oldPdf,finalPdf);
      throw error;
    }

    rec.pdfFile="presentation.pdf";
    rec.slideCount=generated.length;
    rec.notes=extractPptxSpeakerNotes(original);
    while(rec.notes.length<rec.slideCount)rec.notes.push("");
    rec.conversionStatus="ready";rec.conversionError=null;rec.lastRebuildError=null;
    rec.updatedAt=new Date().toISOString();persistPresentationLibrary();return rec;
  }finally{fs.rmSync(renderTmp,{recursive:true,force:true})}
}
function buildPresentationSlides(id){
  const key=String(id);
  if(presentationBuilds.has(key))return presentationBuilds.get(key);
  const task=buildPresentationSlidesUnlocked(key).finally(()=>presentationBuilds.delete(key));
  presentationBuilds.set(key,task);
  return task;
}

function defaultPresentationState(){
  return {
    active:false,
    presentationId:null,
    slide:1,
    targets:[],
    paused:false,
    black:false,
    startedAt:null,
    slideStartedAt:null,
    autoAdvanceSeconds:0,
    loop:false,
    targetSeconds:0,
    timings:{},
    sessionId:null,
    updatedAt:null
  };
}
let presentationState={...defaultPresentationState(),...readJson(PRESENTATION_STATE_FILE,{})};
if(!presentationState.timings||typeof presentationState.timings!=="object")presentationState.timings={};
if(!Array.isArray(presentationState.targets))presentationState.targets=[];

function persistPresentationState(){
  presentationState.updatedAt=new Date().toISOString();
  persistJson(PRESENTATION_STATE_FILE,presentationState);
}
function presentationElapsedSeconds(startValue){
  const start=Date.parse(startValue||0);
  if(!start||!Number.isFinite(start))return 0;
  const end=presentationState.paused&&presentationState.pausedAt?Date.parse(presentationState.pausedAt):Date.now();
  return Math.max(0,Math.floor((end-start)/1000));
}
function presentationStatePublic(){
  const rec=presentationLibrary.presentations[presentationState.presentationId]||null;
  return {
    ...presentationState,
    presentation: presentationPublicRecord(rec),
    presentationElapsedSeconds:presentationState.active?presentationElapsedSeconds(presentationState.startedAt):0,
    slideElapsedSeconds:presentationState.active?presentationElapsedSeconds(presentationState.slideStartedAt):0,
    currentSlideUrl:rec&&presentationState.active?presentationSlideUrl(rec.id,presentationState.slide):null,
    nextSlideUrl:rec&&presentationState.active&&presentationState.slide<rec.slideCount?presentationSlideUrl(rec.id,presentationState.slide+1):null,
    notes:rec?.notes?.[Math.max(0,(presentationState.slide||1)-1)]||""
  };
}
function recordCurrentSlideTiming(){
  if(!presentationState.active||!presentationState.presentationId)return;
  const elapsed=presentationElapsedSeconds(presentationState.slideStartedAt);
  const key=String(presentationState.slide||1);
  presentationState.timings[key]=Number(presentationState.timings[key]||0)+elapsed;
}
async function sendPresentationSlide(){
  const rec=presentationLibrary.presentations[presentationState.presentationId];
  if(!rec||!presentationState.active)return;
  const url=presentationSlideUrl(rec.id,presentationState.slide);
  await executeCommand({
    // Use the established display.image command so already-open TV receivers
    // from earlier Hub versions can present slides without requiring a reload.
    type:"display.image",
    target:presentationState.targets,
    payload:{
      presentationId:rec.id,
      presentation:true,
      name:rec.name,
      slide:presentationState.slide,
      slideCount:rec.slideCount,
      url,
      fit:"contain",
      opacity:1
    }
  },"presentation");
  if(presentationState.black){
    await executeCommand({
      type:"display.clear",
      target:presentationState.targets,
      payload:{presentation:true,black:true}
    },"presentation");
  }
}
async function presentationGoto(slide,{record=true}={}){
  const rec=presentationLibrary.presentations[presentationState.presentationId];
  if(!rec)throw new Error("No active presentation");
  const next=Math.max(1,Math.min(Number(slide)||1,Number(rec.slideCount)||1));
  if(record)recordCurrentSlideTiming();
  presentationState.slide=next;
  presentationState.slideStartedAt=new Date().toISOString();
  presentationState.paused=false;
  presentationState.pausedAt=null;
  persistPresentationState();
  await sendPresentationSlide();
  broadcastControllers({type:"presentation.state",state:presentationStatePublic()});
  return presentationStatePublic();
}
async function stopPresentation({clear=true}={}){
  const targets=[...presentationState.targets];
  if(presentationState.active)recordCurrentSlideTiming();
  const priorId=presentationState.presentationId;
  presentationState={...defaultPresentationState(),timings:presentationState.timings||{}};
  persistPresentationState();
  if(clear&&targets.length){
    await executeCommand({type:"display.clear",target:targets,payload:{}},"presentation");
  }
  audit({kind:"presentation.stop",presentationId:priorId,targets});
  broadcastControllers({type:"presentation.state",state:presentationStatePublic()});
  return presentationStatePublic();
}
async function controlPresentation(action,body={}){
  action=String(action||"").toLowerCase();
  if(action==="stop")return stopPresentation({clear:body.clear!==false});
  if(!presentationState.active)throw new Error("No active presentation");
  const rec=presentationLibrary.presentations[presentationState.presentationId];
  if(!rec)throw new Error("Active presentation is missing");

  if(action==="next"){
    if(presentationState.slide>=rec.slideCount){
      if(presentationState.loop)return presentationGoto(1);
      presentationState.paused=true;
      presentationState.pausedAt=new Date().toISOString();
      persistPresentationState();
      broadcastControllers({type:"presentation.state",state:presentationStatePublic()});
      return presentationStatePublic();
    }
    return presentationGoto(presentationState.slide+1);
  }
  if(action==="previous"||action==="back")return presentationGoto(presentationState.slide-1);
  if(action==="goto")return presentationGoto(body.slide);
  if(action==="restart-timer"){
    presentationState.slideStartedAt=new Date().toISOString();
    presentationState.timings[String(presentationState.slide)]=0;
    presentationState.paused=false;
    presentationState.pausedAt=null;
  }else if(action==="pause"){
    if(!presentationState.paused){
      presentationState.paused=true;
      presentationState.pausedAt=new Date().toISOString();
    }
  }else if(action==="resume"){
    if(presentationState.paused){
      const pausedAt=Date.parse(presentationState.pausedAt||0);
      const delta=pausedAt?Date.now()-pausedAt:0;
      for(const key of ["startedAt","slideStartedAt"]){
        const t=Date.parse(presentationState[key]||0);
        if(t&&delta>0)presentationState[key]=new Date(t+delta).toISOString();
      }
      presentationState.paused=false;
      presentationState.pausedAt=null;
    }
  }else if(action==="black"||action==="unblack"||action==="toggle-black"){
    if(action==="black")presentationState.black=true;
    else if(action==="unblack")presentationState.black=false;
    else presentationState.black=!presentationState.black;

    if(presentationState.black){
      // display.clear is understood by all receiver versions and gives us a
      // dependable black screen without requiring the new presentation command.
      await executeCommand({
        type:"display.clear",
        target:presentationState.targets,
        payload:{presentation:true,black:true}
      },"presentation");
    }else{
      await sendPresentationSlide();
    }
  }else if(action==="set-auto"){
    presentationState.autoAdvanceSeconds=Math.max(0,Math.min(3600,Number(body.seconds)||0));
    if(body.loop!==undefined)presentationState.loop=!!body.loop;
  }else if(action==="set-target"){
    presentationState.targetSeconds=Math.max(0,Math.min(3600,Number(body.seconds)||0));
  }else{
    throw new Error("Unsupported presentation action");
  }
  persistPresentationState();
  broadcastControllers({type:"presentation.state",state:presentationStatePublic()});
  return presentationStatePublic();
}

let presentationAutoAdvanceBusy=false;
const presentationAutoAdvanceTimer=setInterval(async()=>{
  if(presentationAutoAdvanceBusy)return;presentationAutoAdvanceBusy=true;
  try{
    if(!presentationState.active||presentationState.paused)return;
    const seconds=Number(presentationState.autoAdvanceSeconds||0);
    if(seconds<=0)return;
    if(presentationElapsedSeconds(presentationState.slideStartedAt)>=seconds){
      await controlPresentation("next",{});
    }
  }catch(err){
    audit({kind:"presentation.auto.error",error:err.message});
  }finally{presentationAutoAdvanceBusy=false}
},1000);
presentationAutoAdvanceTimer.unref();


// -----------------------------------------------------------------------------
// v0.15 Lab Computer Management
// -----------------------------------------------------------------------------
function defaultLabComputerStore(){return {version:1,computers:{}}}


// -----------------------------------------------------------------------------
// Classroom class / bell schedule
// -----------------------------------------------------------------------------
function defaultClassSchedules(){return {version:1,classes:[]}}
let classScheduleStore=readJson(CLASS_SCHEDULES_FILE,defaultClassSchedules());
if(!classScheduleStore||typeof classScheduleStore!=="object")classScheduleStore=defaultClassSchedules();
if(!Array.isArray(classScheduleStore.classes))classScheduleStore.classes=[];

function persistClassSchedules(){persistJson(CLASS_SCHEDULES_FILE,classScheduleStore)}
function commitClassSchedules(next){persistJson(CLASS_SCHEDULES_FILE,next);classScheduleStore=next;return next}
function normalizeClassSchedule(input={},existing={}){
  const id=existing.id||cleanId(input.id||`class-${crypto.randomUUID()}`);
  if(!id)throw new Error("A valid class ID is required");
  const name=String(input.name??existing.name??"Class").trim().slice(0,120);
  const shortName=String(input.shortName??existing.shortName??name).trim().slice(0,60);
  const startTime=String(input.startTime??existing.startTime??"08:00"),endTime=String(input.endTime??existing.endTime??"09:00");
  if(!validTime(startTime)||!validTime(endTime))throw new Error("Class times must be valid HH:MM values");
  if(timeToMinutes(startTime)>=timeToMinutes(endTime))throw new Error("Class end time must be after its start time");
  const days=(Array.isArray(input.days)?input.days:(existing.days||[1,2,3,4,5])).map(Number).filter(x=>x>=0&&x<=6);
  const scheduleMode=["weekly","alternating","schoolcycle"].includes(String(input.scheduleMode??existing.scheduleMode??"schoolcycle"))?String(input.scheduleMode??existing.scheduleMode??"schoolcycle"):"schoolcycle";
  const alternatePhase=String(input.alternatePhase??existing.alternatePhase??"A").toUpperCase()==="B"?"B":"A";
  const period=String(input.period??existing.period??"").trim().slice(0,40);
  const cycleDays=normalizeCycleDays(input.cycleDays===undefined?existing.cycleDays:input.cycleDays,periodDefaultCycleDays(period));
  const inferredDayType=cycleDaysDayColor(cycleDays);
  const dayType=normalizedDayType(input.dayType??existing.dayType??inferredDayType,inferredDayType);
  const anchorRaw=(input.anchorDate??existing.anchorDate??(scheduleMode==="alternating"?schoolCycleAnchor():""));const anchorDate=validDateKey(anchorRaw)?String(anchorRaw):"";
  const includeDates=uniqueDateKeys(input.includeDates===undefined?existing.includeDates:input.includeDates);
  const excludedDates=uniqueDateKeys(input.excludedDates===undefined?existing.excludedDates:input.excludedDates);
  const defaultTargets=(Array.isArray(input.defaultTargets)?input.defaultTargets:(existing.defaultTargets||["all"])).map(cleanId).filter(Boolean);
  const continuationOf=String(input.continuationOf??existing.continuationOf??"").trim().slice(0,80);
  return {...existing,id,name,shortName,startTime,endTime,days:[...new Set(days)],scheduleMode,alternatePhase,anchorDate,includeDates,excludedDates,period,cycleDays,dayType,continuationOf,phaseALabel:String(input.phaseALabel??existing.phaseALabel??alternateGroupLabel("A")).trim().slice(0,30)||alternateGroupLabel("A"),phaseBLabel:String(input.phaseBLabel??existing.phaseBLabel??alternateGroupLabel("B")).trim().slice(0,30)||alternateGroupLabel("B"),defaultTargets:[...new Set(defaultTargets)],enabled:input.enabled===undefined?(existing.enabled!==false):!!input.enabled,notes:String(input.notes??existing.notes??"").slice(0,500),createdAt:existing.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
}
function classScheduleById(id){return classScheduleStore.classes.find(c=>c.id===String(id||""))||null}

function classAlternatingPhaseForDate(anchorDate,date=new Date()){
  const status=schoolCycleForDate(date);
  if(!status.isStudentSchoolDay)return null;
  const anchor=dateFromKey(validDateKey(anchorDate)?anchorDate:schoolCycleAnchor());
  if(!anchor)return null;
  const offset=countEligibleSchoolDays(anchor,date);
  return Math.abs(offset)%2===0?"A":"B";
}

function classScheduleMatchesDate(cls,date=new Date()){
  const key=localDateKey(date);
  if(calendarRuleForDate(date).type==='half-day'&&!effectiveClassTimes(cls,date))return false;
  if((cls.excludedDates||[]).includes(key))return false;
  if((cls.includeDates||[]).includes(key))return true;
  if(isCalendarBlocked(date).blocked)return false;

  if(cls.scheduleMode==="schoolcycle"){
    const cycleDays=normalizeCycleDays(cls.cycleDays,periodDefaultCycleDays(cls.period));
    return schoolCycleMatches({cycleDays,dayType:cls.dayType||cycleDaysDayColor(cycleDays)},date);
  }

  if(!(cls.days||[]).includes(date.getDay()))return false;
  if(cls.scheduleMode!=="alternating")return true;

  return classAlternatingPhaseForDate(cls.anchorDate,date)===(cls.alternatePhase||"A");
}
function classPeriodNumber(cls){
  const direct=String(cls?.period||'').match(/(?:^|\D)([1-8])(?:$|\D)/);
  if(direct)return Number(direct[1]);
  const named=String(cls?.name||'').match(/\bP([1-8])\b/i);
  return named?Number(named[1]):null;
}
function minutesToHHMM(mins){mins=Math.max(0,Math.min(1439,Math.round(mins)));return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`}
function effectiveClassTimes(cls,date=new Date()){
  if(!cls)return null;
  const rule=calendarRuleForDate(date);
  const effective=effectiveTimesForRule(schoolScheduleProfile,cls,rule.type);
  return effective?{...effective,rule}:null;
}
function classStartDate(cls,date=new Date()){const t=effectiveClassTimes(cls,date);if(!t)return null;const [h,m]=t.startTime.split(":").map(Number),d=new Date(date);d.setHours(h,m,0,0);return d}
function classEndDate(cls,date=new Date()){const t=effectiveClassTimes(cls,date);if(!t)return null;const [h,m]=t.endTime.split(":").map(Number),d=new Date(date);d.setHours(h,m,0,0);return d}
function isTransitionClass(cls){
  return /transition/i.test(String(cls?.name||"")) || /transition/i.test(String(cls?.shortName||"")) || String(cls?.kind||"").toLowerCase()==="transition";
}
function classBasePeriodNumber(cls){
  if(!cls)return null;
  const name=String(cls.name||'');
  // Imported legacy labels encode the originating regular period explicitly.
  const bison=name.match(/^\s*B[12]\s*-\s*P([1-8])\b/i);
  if(bison)return Number(bison[1]);
  const regular=name.match(/^\s*P([1-8])\b/i);
  if(regular)return Number(regular[1]);
  return classPeriodNumber(cls);
}
function isLegacyContinuationClass(cls){
  if(!cls)return false;
  const name=String(cls.name||'');
  const period=String(cls.period||'');
  return /^\s*B[12]\b/i.test(name) || /^\s*B[12]\b/i.test(period) || /bison block/i.test(String(cls.notes||''));
}
function isValidTimerContinuation(current,next){
  if(!current||!next||isTransitionClass(current)||isTransitionClass(next))return false;
  if(next.continuationOf)return String(next.continuationOf)===String(current.id)||String(next.continuationOf)===String(current.period)||String(next.continuationOf)===String(classBasePeriodNumber(current)||"");
  if(!schoolScheduleProfile.continuation?.legacyBisonCompatibility||!isLegacyContinuationClass(next))return false;
  const a=classBasePeriodNumber(current),b=classBasePeriodNumber(next);
  return Number.isInteger(a)&&Number.isInteger(b)&&a===b;
}
function resolvedOccurrenceEndDate(event,cls,date=new Date()){
  const stamp=Number(event?._classEndAt);
  if(Number.isFinite(stamp)&&stamp>0){
    const d=new Date(stamp);
    if(localDateKey(d)===localDateKey(date))return d;
  }
  return classEndDate(cls,date);
}
function activeClassAt(date=new Date()){return classScheduleStore.classes.filter(c=>c.enabled!==false&&classScheduleMatchesDate(c,date)).find(c=>{const a=classStartDate(c,date),b=classEndDate(c,date);return a&&b&&a<=date&&date<b})||null}
function activeAutomationClassAt(event,date=new Date()){
  const ids=automationClassIds(event);
  if(!ids.length)return null;
  const active=ids
    .map(classScheduleById)
    .filter(Boolean)
    .filter(c=>c.enabled!==false&&classScheduleMatchesDate(c,date))
    .map(c=>({c,start:classStartDate(c,date),end:classEndDate(c,date)}))
    .filter(x=>x.start&&x.end&&x.start<=date&&date<x.end)
    .sort((a,b)=>b.start-a.start||a.end-b.end);
  return active[0]?.c||null;
}
function nextClassAfter(date=new Date()){
  const found=[];
  for(let off=0;off<14&&!found.length;off++){
    const d=new Date(date);d.setDate(d.getDate()+off);d.setHours(12,0,0,0);
    for(const c of classScheduleStore.classes){
      if(c.enabled===false||!classScheduleMatchesDate(c,d))continue;
      const start=classStartDate(c,d),end=classEndDate(c,d);if(start&&end&&start>date)found.push({...c,startTime:effectiveClassTimes(c,d)?.startTime||c.startTime,endTime:effectiveClassTimes(c,d)?.endTime||c.endTime,nextStartAt:start.toISOString(),nextEndAt:end.toISOString()});
    }
  }
  return found.sort((a,b)=>new Date(a.nextStartAt)-new Date(b.nextStartAt))[0]||null;
}
function classStatusPayload(date=new Date()){
  const a=activeClassAt(date),n=nextClassAfter(date);
  const at=a?effectiveClassTimes(a,date):null;
  return {schoolCycle:schoolCycleForDate(date),calendarRule:calendarRuleForDate(date),activeClass:a?{...a,startTime:at?.startTime||a.startTime,endTime:at?.endTime||a.endTime,startAt:classStartDate(a,date).toISOString(),endAt:classEndDate(a,date).toISOString()}:null,nextClass:n};
}
function automationClassIds(event){
  const ids=Array.isArray(event.classIds)?event.classIds.filter(Boolean):[];
  if(!ids.length&&event.classId)ids.push(event.classId);
  return [...new Set(ids.map(String))];
}
function resolveAutomationForClass(event,classId,date=new Date()){
  if(!classId)return event;
  const cls=classScheduleById(classId);if(!cls||cls.enabled===false)return null;
  if(!classScheduleMatchesDate(cls,date))return null;
  const effective=effectiveClassTimes(cls,date);if(!effective)return null;
  const base=event.classTimeReference==="end"?effective.endTime:effective.startTime;
  const [h,m]=base.split(":").map(Number),rawMinutes=h*60+m+Number(event.classTimeOffsetMinutes||0);
  const dayOffset=Math.floor(rawMinutes/1440),mins=((rawMinutes%1440)+1440)%1440;
  const scheduledDate=new Date(date);scheduledDate.setDate(scheduledDate.getDate()+dayOffset);
  const occurrenceStart=classStartDate(cls,date),occurrenceEnd=classEndDate(cls,date);
  return {...event,classId:cls.id,time:`${String(Math.floor(mins/60)).padStart(2,"0")}:${String(mins%60).padStart(2,"0")}`,days:[...(cls.days||[])],scheduleMode:cls.scheduleMode||"schoolcycle",alternatePhase:cls.alternatePhase||"A",anchorDate:cls.anchorDate||schoolCycleAnchor(),dayType:cls.dayType||"Any",cycleDays:[...(cls.cycleDays||periodDefaultCycleDays(cls.period))],period:cls.period||"",includeDates:[...(cls.includeDates||[])],targets:(event.useClassTargets!==false&&automationTargetDomain(event.action)==="display"&&cls.defaultTargets?.length)?[...cls.defaultTargets]:(event.targets||[]),_class:cls,_classDefaultTargets:[...(cls.defaultTargets||[])],_automationClassIds:automationClassIds(event),_classStartAt:occurrenceStart?.getTime()||null,_classEndAt:occurrenceEnd?.getTime()||null,_classIsTransition:isTransitionClass(cls),_sourceDateMatched:true,_scheduledDateKey:localDateKey(scheduledDate)};
}
function resolveAutomationOccurrences(event,date=new Date()){
  const ids=automationClassIds(event);
  if(!ids.length)return [event];
  return ids.map(id=>resolveAutomationForClass(event,id,date)).filter(Boolean);
}
function resolveAutomationFromClass(event,date=new Date()){
  // Manual/Test Now execution must follow the selected class occurrence that is
  // actually active now. Falling straight to the first configured class makes
  // multi-class automations resolve an already-ended period and yields 00:00.
  const active=activeAutomationClassAt(event,date);
  if(active){
    const resolved=resolveAutomationForClass(event,active.id,date);
    if(resolved)return resolved;
  }
  return resolveAutomationOccurrences(event,date)[0]||event;
}
function resolveAutomationForManualTest(event,date=new Date()){
  const resolved=resolveAutomationFromClass(event,date);
  if(resolved?._class||!automationClassIds(event).length)return resolved;
  // Test Now must remain useful on a day when none of the linked classes is
  // scheduled. Use the first enabled linked class as a deterministic test
  // context without weakening the real scheduler's date/cycle checks.
  const cls=automationClassIds(event).map(classScheduleById).find(c=>c&&c.enabled!==false);
  if(!cls)return resolved;
  const occurrenceStart=classStartDate(cls,date),occurrenceEnd=classEndDate(cls,date);
  return {
    ...event,
    classId:cls.id,
    targets:(event.useClassTargets!==false&&automationTargetDomain(event.action)==="display"&&cls.defaultTargets?.length)?[...cls.defaultTargets]:(event.targets||[]),
    _class:cls,
    _classDefaultTargets:[...(cls.defaultTargets||[])],
    _automationClassIds:automationClassIds(event),
    _classStartAt:occurrenceStart?.getTime()||null,
    _classEndAt:occurrenceEnd?.getTime()||null,
    _classIsTransition:isTransitionClass(cls),
    _manualTestOccurrence:true
  };
}

// -----------------------------------------------------------------------------
// Veyon lab computer integration
// -----------------------------------------------------------------------------

let veyonComputerStore=readJson(VEYON_COMPUTERS_FILE,{version:2,computers:{}});
if(!veyonComputerStore||typeof veyonComputerStore!=="object")veyonComputerStore={version:2,computers:{}};
if(!veyonComputerStore.computers||typeof veyonComputerStore.computers!=="object")veyonComputerStore.computers={};
for(const rec of Object.values(veyonComputerStore?.computers||{})){
  if(rec.role!=="teacher"&&rec.role!=="student")rec.role="student";
}
const veyonConnectionCache=new Map();
const veyonAuthInFlight=new Map();

function persistVeyonComputers(){
  persistJson(VEYON_COMPUTERS_FILE,veyonComputerStore);
}
try{dbStore.importSecretFile("veyon.private-key",VEYON_PRIVATE_KEY_FILE,{type:"private-key",integration:"veyon",keyName:VEYON_KEY_NAME})}catch(err){console.warn(`Veyon private-key database import skipped: ${err.message}`)}
function veyonPrivateKey(){
  try{const v=dbStore.getSecret("veyon.private-key");if(v)return v}catch{}
  return fs.readFileSync(VEYON_PRIVATE_KEY_FILE,"utf8")
}
async function veyonFetch(pathname,options={}){
  const ctrl=new AbortController();
  const timeout=setTimeout(()=>ctrl.abort(),Number(options.timeoutMs||7000));
  try{
    return await fetch(`${VEYON_WEBAPI_URL}${pathname}`,{
      method:options.method||"GET",headers:options.headers||{},body:options.body,signal:ctrl.signal
    });
  }finally{clearTimeout(timeout)}
}
async function veyonJson(pathname,options={}){
  const started=Date.now();
  try{
    const response=await veyonFetch(pathname,options);
    const text=await response.text();let body={};
    try{body=text?JSON.parse(text):{}}catch{body={raw:text}}
    if(!response.ok){
      const err=new Error(body?.error?.message||body?.raw||`Veyon HTTP ${response.status}`);
      err.status=response.status;err.body=body;err.veyonCode=body?.error?.code;throw err;
    }
    audit({kind:"service.action",component:"veyon",operation:String(options.method||"GET"),path:pathname,status:response.status,durationMs:Date.now()-started,ok:true});
    return body;
  }catch(err){
    diagnosticError(err,{component:"veyon",operation:`${options.method||"GET"} ${pathname}`});
    throw err;
  }
}
async function veyonCloseConnection(host,rec=veyonConnectionCache.get(host)){
  if(!rec?.uid){veyonConnectionCache.delete(host);return}
  try{
    await veyonJson(`/api/v1/authentication/${encodeURIComponent(host)}`,{
      method:"DELETE",headers:{"Connection-Uid":rec.uid},timeoutMs:3000
    });
  }catch{}
  veyonConnectionCache.delete(host);
}
async function veyonTrimPool(reserve=1){
  const max=Math.max(1,VEYON_POOL_MAX-reserve);
  if(veyonConnectionCache.size<=max)return;
  const victims=[...veyonConnectionCache.entries()]
    .sort((a,b)=>Number(a[1].lastUsed||0)-Number(b[1].lastUsed||0))
    .slice(0,Math.max(0,veyonConnectionCache.size-max));
  for(const [host,rec] of victims)await veyonCloseConnection(host,rec);
}
async function veyonCloseIdleConnections(){
  const now=Date.now();
  for(const [host,rec] of [...veyonConnectionCache.entries()]){
    if(now-Number(rec.lastUsed||0)>45000)await veyonCloseConnection(host,rec);
  }
}
const veyonPoolTimer=setInterval(()=>veyonCloseIdleConnections().catch(()=>{}),15000);
veyonPoolTimer.unref?.();

async function veyonAuthenticateInternal(host){
  await veyonTrimPool(1);
  const keydata=veyonPrivateKey();let lastErr=null;
  for(let attempt=0;attempt<=VEYON_AUTH_RETRIES;attempt++){
    try{
      const result=await veyonJson(`/api/v1/authentication/${encodeURIComponent(host)}`,{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({method:VEYON_AUTHKEYS_UUID,credentials:{keyname:VEYON_KEY_NAME,keydata}})
      });
      const uid=result["connection-uid"];
      if(!uid)throw new Error("Veyon authentication returned no connection UID");
      veyonConnectionCache.set(host,{uid,validUntil:Number(result.validUntil||0),lastUsed:Date.now(),createdAt:Date.now()});
      return uid;
    }catch(err){
      lastErr=err;
      if(err.status===429||err.veyonCode===7){
        const victims=[...veyonConnectionCache.entries()]
          .sort((a,b)=>Number(a[1].lastUsed||0)-Number(b[1].lastUsed||0))
          .slice(0,Math.max(2,Math.ceil(veyonConnectionCache.size/4)));
        for(const [victim,rec] of victims)await veyonCloseConnection(victim,rec);
        await new Promise(r=>setTimeout(r,200*(attempt+1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr||new Error("Veyon authentication failed");
}
async function veyonAuthenticate(host,force=false){
  host=String(host||"").trim();if(!host)throw new Error("Veyon host required");
  const now=Math.floor(Date.now()/1000),cached=veyonConnectionCache.get(host);
  if(!force&&cached?.uid&&Number(cached.validUntil||0)>now+30&&Date.now()-Number(cached.lastUsed||0)<45000){
    cached.lastUsed=Date.now();return cached.uid;
  }
  if(force&&cached)await veyonCloseConnection(host,cached);
  if(veyonAuthInFlight.has(host))return veyonAuthInFlight.get(host);
  const task=veyonAuthenticateInternal(host).finally(()=>veyonAuthInFlight.delete(host));
  veyonAuthInFlight.set(host,task);return task;
}
async function veyonConnectedJson(host,pathname,options={},retry=true){
  const uid=await veyonAuthenticate(host,false),rec=veyonConnectionCache.get(host);
  if(rec)rec.lastUsed=Date.now();
  try{
    return await veyonJson(pathname,{...options,headers:{...(options.headers||{}),"Connection-Uid":uid}});
  }catch(err){
    if(retry&&(err.status===401||err.status===408||err.status===429||[2,7,8].includes(err.veyonCode))){
      await veyonCloseConnection(host);
      if(err.status===429||err.veyonCode===7){await veyonTrimPool(4);await new Promise(r=>setTimeout(r,250))}
      await veyonAuthenticate(host,true);
      return veyonConnectedJson(host,pathname,options,false);
    }
    throw err;
  }
}
async function veyonAvailableFeatures(host){return veyonConnectedJson(host,"/api/v1/feature")}
async function veyonFeatureStatus(host,feature){
  const uid=VEYON_FEATURES[feature]||feature;
  if(!uid)throw new Error(`Unknown Veyon feature: ${feature}`);
  return veyonConnectedJson(host,`/api/v1/feature/${encodeURIComponent(uid)}`);
}
async function veyonFeature(host,feature,active=true,args={}){
  const uid=VEYON_FEATURES[feature]||feature;
  if(!uid)throw new Error(`Unknown Veyon feature: ${feature}`);
  return veyonConnectedJson(host,`/api/v1/feature/${encodeURIComponent(uid)}`,{
    method:"PUT",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({active:!!active,arguments:args||{}})
  });
}
function veyonTcpProbe(host,port=11100,timeout=450){
  return new Promise(resolve=>{
    const socket=new net.Socket();let done=false;
    const finish=ok=>{if(done)return;done=true;try{socket.destroy()}catch{}resolve(ok)};
    socket.setTimeout(timeout);
    socket.once("connect",()=>finish(true));
    socket.once("timeout",()=>finish(false));
    socket.once("error",()=>finish(false));
    socket.connect(port,host);
  });
}
async function veyonComputerInfo(host){
  const [user,session,screenLock,inputLock]=await Promise.all([
    veyonConnectedJson(host,"/api/v1/user").catch(()=>({login:"",fullName:""})),
    veyonConnectedJson(host,"/api/v1/session").catch(()=>({})),
    veyonFeatureStatus(host,"screenLock").catch(()=>({active:false})),
    veyonFeatureStatus(host,"inputLock").catch(()=>({active:false}))
  ]);
  return {user,session,featureState:{screenLock:!!screenLock?.active,inputLock:!!inputLock?.active}};
}
function veyonComputerId(ip){return String(ip).replace(/[^a-zA-Z0-9._-]/g,"-")}
function upsertVeyonComputer(ip,patch={}){
  const id=veyonComputerId(ip),old=veyonComputerStore.computers[id]||{id,ip,name:patch.name||ip,role:"student",createdAt:new Date().toISOString()};
  const role=(patch.role==="teacher"||patch.role==="student")?patch.role:(old.role==="teacher"?"teacher":"student");
  const rec={...old,...patch,role,id,ip:String(ip),updatedAt:new Date().toISOString()};
  veyonComputerStore.computers[id]=rec;persistVeyonComputers();return rec;
}
async function veyonStatusFor(rec,{includeInfo=true}={}){
  const online=await veyonTcpProbe(rec.ip);
  let info=null,error=null;
  if(online&&includeInfo){
    try{info=await veyonComputerInfo(rec.ip)}
    catch(err){error=err.message}
  }
  const hostname=info?.session?.sessionHostName||rec.hostname||"";
  if(hostname&&hostname!==rec.hostname){
    rec=upsertVeyonComputer(rec.ip,{hostname,name:rec.name===rec.ip?hostname:rec.name});
  }
  return {...rec,online,authenticated:online&&!error,user:info?.user||null,session:info?.session||null,
    featureState:info?.featureState||{screenLock:false,inputLock:false},error};
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let cursor=0;
  async function worker(){
    for(;;){
      const i=cursor++;if(i>=items.length)return;
      try{out[i]=await fn(items[i],i)}catch(err){out[i]={error:err.message}}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length||1)},worker));
  return out;
}
async function veyonDiscover({start=VEYON_SCAN_START,end=VEYON_SCAN_END}={}){
  start=Math.max(1,Math.min(254,Number(start)||VEYON_SCAN_START));
  end=Math.max(start,Math.min(254,Number(end)||VEYON_SCAN_END));
  const ips=Array.from({length:end-start+1},(_,i)=>`${VEYON_SCAN_SUBNET}.${start+i}`);
  const probed=await mapLimit(ips,40,async ip=>({ip,open:await veyonTcpProbe(ip)}));
  const open=probed.filter(x=>x.open).map(x=>x.ip);
  const details=await mapLimit(open,10,async ip=>{
    try{
      const info=await veyonComputerInfo(ip);
      const hostname=info?.session?.sessionHostName||ip;
      const rec=upsertVeyonComputer(ip,{hostname,name:veyonComputerStore.computers[veyonComputerId(ip)]?.name||hostname,lastDiscoveredAt:new Date().toISOString()});
      return {...rec,online:true,authenticated:true,user:info.user,session:info.session};
    }catch(err){
      const rec=upsertVeyonComputer(ip,{lastDiscoveredAt:new Date().toISOString()});
      return {...rec,online:true,authenticated:false,error:err.message};
    }
  });
  return details;
}

let labComputerStore=readJson(LAB_COMPUTERS_FILE,defaultLabComputerStore());
if(!labComputerStore||typeof labComputerStore!=="object")labComputerStore=defaultLabComputerStore();
if(!labComputerStore.computers||typeof labComputerStore.computers!=="object")labComputerStore.computers={};
let labHistoryStore=readJson(LAB_HISTORY_FILE,{version:1,computers:{}});
let labAiAlertsStore=readJson(LAB_AI_ALERTS_FILE,{version:1,alerts:[]});
let labAiRulesStore=readJson(LAB_AI_RULES_FILE,{
  version:1,
  enabled:true,
  domains:[
    "chatgpt.com","openai.com","claude.ai","anthropic.com","gemini.google.com",
    "copilot.microsoft.com","perplexity.ai","poe.com","grok.com","x.ai",
    "deepseek.com","mistral.ai","character.ai"
  ],
  keywords:[
    "chatgpt","openai","claude","anthropic","gemini","copilot","perplexity",
    "grok","deepseek","mistral","ai chat","artificial intelligence"
  ],
  excludeDomains:[]
});
if(!labAiAlertsStore||typeof labAiAlertsStore!=="object")labAiAlertsStore={version:1,alerts:[]};
if(!labAiRulesStore||typeof labAiRulesStore!=="object")labAiRulesStore={version:1,enabled:true,domains:[],keywords:[],excludeDomains:[]};
if(!Array.isArray(labAiAlertsStore.alerts))labAiAlertsStore.alerts=[];
if(!Array.isArray(labAiRulesStore.domains))labAiRulesStore.domains=[];
if(!Array.isArray(labAiRulesStore.keywords))labAiRulesStore.keywords=[];
if(!Array.isArray(labAiRulesStore.excludeDomains))labAiRulesStore.excludeDomains=[];

if(!labHistoryStore||typeof labHistoryStore!=="object")labHistoryStore={version:1,computers:{}};
if(!labHistoryStore.computers||typeof labHistoryStore.computers!=="object")labHistoryStore.computers={};
const labAgentSockets=new Map();
const LAB_ALLOWED_ACTIONS=new Set(["message","restart","shutdown","cancel-shutdown","logoff","lock","refresh-history","screenshot","run-preset","update-agent","instructor-lock","instructor-unlock","app-lock","app-unlock"]);

function cleanLabAgentId(v){
  const id=String(v||"").trim().toLowerCase().replace(/[^a-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"");
  if(!id)throw new Error("Invalid lab agent ID");
  return id.slice(0,120);
}
function persistLabComputers(){persistJson(LAB_COMPUTERS_FILE,labComputerStore)}
function persistLabHistory(){persistJson(LAB_HISTORY_FILE,labHistoryStore)}
function persistLabAiAlerts(){persistJson(LAB_AI_ALERTS_FILE,labAiAlertsStore)}
function persistLabAiRules(){persistJson(LAB_AI_RULES_FILE,labAiRulesStore)}
function aiRuleMatch(item){
  if(!LAB_AI_MONITOR_ENABLED||labAiRulesStore.enabled===false)return null;
  const domain=String(item?.domain||"").toLowerCase();
  const url=String(item?.url||"").toLowerCase();
  const title=String(item?.title||"").toLowerCase();
  if(labAiRulesStore.excludeDomains.some(d=>domain===d||domain.endsWith("."+d)))return null;
  const domainRule=labAiRulesStore.domains.find(d=>domain===d||domain.endsWith("."+d));
  if(domainRule)return {kind:"domain",rule:domainRule};
  const hay=`${domain} ${url} ${title}`;
  const keywordRule=labAiRulesStore.keywords.find(k=>hay.includes(String(k).toLowerCase()));
  return keywordRule?{kind:"keyword",rule:keywordRule}:null;
}
function aiAlertDuplicate(agentId,item){
  const cutoff=Date.now()-LAB_AI_ALERT_COOLDOWN_MINUTES*60000;
  return labAiAlertsStore.alerts.some(a=>
    a.agentId===agentId &&
    String(a.profile||"")===String(item.profile||"") &&
    a.domain===String(item.domain||"") &&
    Date.parse(a.createdAt||0)>=cutoff &&
    a.status!=="dismissed"
  );
}
function createAiAlert(agentId,item,match){
  if(aiAlertDuplicate(agentId,item))return null;
  const rec=labComputerStore.computers[agentId]||{};
  const alert={
    id:crypto.randomUUID(),
    agentId,
    hostname:rec.hostname||agentId,
    computerName:rec.name||rec.hostname||agentId,
    profile:String(item.profile||""),
    windowsUser:String(rec.user||""),
    domain:String(item.domain||""),
    url:String(item.url||""),
    title:String(item.title||""),
    browser:String(item.browser||""),
    visitTime:item.visitTime||new Date().toISOString(),
    ruleKind:match.kind,
    rule:String(match.rule||""),
    createdAt:new Date().toISOString(),
    status:"new",
    screenshotUrl:null,
    screenshotAt:null
  };
  labAiAlertsStore.alerts.unshift(alert);
  labAiAlertsStore.alerts=labAiAlertsStore.alerts.slice(0,5000);
  persistLabAiAlerts();
  if(typeof broadcastControllers==="function")broadcastControllers({type:"lab.ai.alert",alert});

  return alert;
}

function labOnline(id){
  const rec=labComputerStore.computers[id],ws=labAgentSockets.get(id),t=Date.parse(rec?.lastSeen||0);
  return !!rec&&Number.isFinite(t)&&Date.now()-t<45000&&ws?.readyState===WebSocket.OPEN;
}
function publicLabComputer(id,{sensitive=false}={}){
  const rec=labComputerStore.computers[id];if(!rec)return null;
  const hist=Array.isArray(labHistoryStore.computers[id])?labHistoryStore.computers[id]:[];
  const result={...rec,online:labOnline(id)};
  delete result.screenshotFile;delete result.screenshotHistory;delete result.screenshotBytes;
  if(sensitive){result.latestWebsite=hist[0]||null;result.historyCount=hist.length;result.screenshotUrl=rec.screenshotFile?`/api/v1/lab/computers/${encodeURIComponent(id)}/screenshot?t=${encodeURIComponent(rec.screenshotAt||"")}`:null}
  return result;
}
function publicLabInventory(){
  const computers=Object.keys(labComputerStore.computers).map(publicLabComputer).filter(Boolean)
    .sort((a,b)=>String(a.name||a.hostname||a.id).localeCompare(String(b.name||b.hostname||b.id)));
  return {ok:true,computers,summary:{total:computers.length,online:computers.filter(x=>x.online).length,offline:computers.filter(x=>!x.online).length},
    retentionHours:LAB_HISTORY_RETENTION_HOURS,configured:dbStore.listLabAgentCredentials().credentials.some(x=>!x.revokedAt)||!!LAB_AGENT_TOKEN};
}
function upsertLabComputer(id,patch={}){
  const now=new Date().toISOString(),cur=labComputerStore.computers[id]||{id,hostname:patch.hostname||id,name:patch.hostname||id,groups:[],firstSeen:now};
  labComputerStore.computers[id]={...cur,...patch,id,groups:Array.isArray(patch.groups)?patch.groups:(Array.isArray(cur.groups)?cur.groups:[]),lastSeen:now};
  persistLabComputers();return labComputerStore.computers[id];
}
function normalizeLabHistoryItem(raw,agentId){
  const url=String(raw?.url||"").trim();
  if(!url)return null;

  let domain="";
  try{domain=new URL(url).hostname.toLowerCase()}catch{}

  const rawTime=String(raw?.visitTime||raw?.visitedAt||raw?.time||"").trim();
  const parsed=Date.parse(rawTime);
  const visitTime=Number.isFinite(parsed)?new Date(parsed).toISOString():new Date().toISOString();

  const stableId=String(
    raw?.id ||
    `${raw?.historyFile||""}|${raw?.recordId||""}|${url}|${visitTime}`
  );

  return {
    id:String(raw?.id||crypto.createHash("sha1").update(`${agentId}|${stableId}`).digest("hex")),
    url:url.slice(0,8192),
    domain:domain.slice(0,255),
    title:String(raw?.title||"").trim().slice(0,1000),
    visitTime,
    visitCount:Number(raw?.visitCount||0)||0,
    visitedFrom:String(raw?.visitedFrom||"").trim().slice(0,8192),
    visitType:String(raw?.visitType||"").trim().slice(0,120),
    visitDuration:String(raw?.visitDuration||"").trim().slice(0,80),
    browser:String(raw?.browser||raw?.webBrowser||"").trim().slice(0,120),
    profile:String(raw?.profile||raw?.userProfile||"").trim().slice(0,260),
    browserProfile:String(raw?.browserProfile||"").trim().slice(0,260),
    urlLength:Number(raw?.urlLength||url.length)||url.length,
    typedCount:Number(raw?.typedCount||0)||0,
    historyFile:String(raw?.historyFile||"").trim().slice(0,2048),
    recordId:String(raw?.recordId??"").trim().slice(0,120),
    receivedAt:new Date().toISOString()
  };
}
function ingestLabHistory(agentId,items){
  const list=Array.isArray(labHistoryStore.computers[agentId])?labHistoryStore.computers[agentId]:[];
  const policy=privacyRetentionPolicy();
  if(!policy.browserHistoryEnabled||policy.browserHistoryHours===0)return {added:0,total:0,latest:null,disabled:true};
  if(!Array.isArray(items)||!items.length)return {added:0,total:list.length,latest:list[0]||null};
  const byId=new Map(list.map(x=>[x.id,x]));let added=0;
  const newItems=[];
  for(const raw of items.slice(0,500)){
    const item=normalizeLabHistoryItem(raw,agentId);
    if(!item||byId.has(item.id))continue;
    byId.set(item.id,item);
    newItems.push(item);
    added++;
  }
  const cutoff=Date.now()-policy.browserHistoryHours*3600000;
  const merged=[...byId.values()]
    .filter(x=>Date.parse(x.visitTime||x.receivedAt||0)>=cutoff)
    .sort((a,b)=>Date.parse(b.visitTime)-Date.parse(a.visitTime))
    .slice(0,100000);
  labHistoryStore.computers[agentId]=merged;
  if(added)persistLabHistory();

  for(const item of newItems){
    const match=aiRuleMatch(item);
    if(match)createAiAlert(agentId,item,match);
  }

  return {added,total:merged.length,latest:merged[0]||null};
}
function labHistoryQuery(agentId,query={}){
  let list=Array.isArray(labHistoryStore.computers[agentId])?[...labHistoryStore.computers[agentId]]:[];

  const fromMs=query.from?Date.parse(String(query.from)):NaN;
  const toMs=query.to?Date.parse(String(query.to)):NaN;
  const hours=Math.max(0,Number(query.hours||0)||0);
  const search=String(query.search||"").trim().toLowerCase();
  const browser=String(query.browser||"").trim().toLowerCase();
  const profile=String(query.profile||"").trim().toLowerCase();

  if(hours>0){
    const cutoff=Date.now()-hours*3600000;
    list=list.filter(x=>Date.parse(x.visitTime||0)>=cutoff);
  }
  if(Number.isFinite(fromMs))list=list.filter(x=>Date.parse(x.visitTime||0)>=fromMs);
  if(Number.isFinite(toMs))list=list.filter(x=>Date.parse(x.visitTime||0)<=toMs);
  if(search){
    list=list.filter(x=>[
      x.url,x.domain,x.title,x.visitedFrom,x.visitType,x.browser,x.profile,
      x.browserProfile,x.historyFile,x.recordId
    ].some(v=>String(v||"").toLowerCase().includes(search)));
  }
  if(browser)list=list.filter(x=>String(x.browser||"").toLowerCase().includes(browser));
  if(profile)list=list.filter(x=>String(x.profile||"").toLowerCase().includes(profile));

  list.sort((a,b)=>Date.parse(b.visitTime||0)-Date.parse(a.visitTime||0));
  const total=list.length;
  const limit=Math.max(1,Math.min(5000,Number(query.limit)||250));
  const offset=Math.max(0,Number(query.offset)||0);
  return {total,items:list.slice(offset,offset+limit),offset,limit};
}
function labHistoryFor(agentId,limit=100){return labHistoryQuery(agentId,{limit}).items}
function resolveLabTargets(raw){
  const requested=Array.isArray(raw)?raw:[raw],out=new Set();
  for(const item of requested){
    const v=String(item||"").trim().toLowerCase();if(!v)continue;
    if(v==="all"){Object.keys(labComputerStore.computers).forEach(id=>out.add(id));continue}
    if(v==="online"){Object.keys(labComputerStore.computers).filter(labOnline).forEach(id=>out.add(id));continue}
    if(v.startsWith("group:")){const g=v.slice(6);for(const [id,r] of Object.entries(labComputerStore.computers))if((r.groups||[]).map(x=>String(x).toLowerCase()).includes(g))out.add(id);continue}
    if(labComputerStore.computers[v])out.add(v);
  }
  return [...out];
}
function sendLabAgentCommand(targets,action,payload={}){
  action=String(action||"").toLowerCase();if(!LAB_ALLOWED_ACTIONS.has(action))throw new Error("Unsupported lab command");
  const ids=resolveLabTargets(targets);if(!ids.length)throw new Error("No lab computers matched the requested targets");
  const commandId=crypto.randomUUID(),issuedAt=new Date().toISOString(),deliveries=[];
  for(const id of ids){
    const ws=labAgentSockets.get(id),online=ws?.readyState===WebSocket.OPEN;
    if(online)wsSend(ws,{type:"lab.command",command:{id:commandId,action,payload,issuedAt}});
    deliveries.push({id,online,delivered:!!online});
    if(labComputerStore.computers[id])labComputerStore.computers[id].lastCommand={id:commandId,action,issuedAt,status:online?"sent":"offline"};
  }
  persistLabComputers();audit({kind:"lab.command",commandId,action,targets:ids,deliveries});broadcastControllers({type:"lab.inventory",inventory:publicLabInventory()});
  return {ok:true,commandId,action,targets:ids,deliveries};
}
function markLabSocketDisconnected(ws){
  if(ws.role!=="lab-agent"||!ws.labAgentId)return;
  const id=ws.labAgentId;if(labAgentSockets.get(id)===ws)labAgentSockets.delete(id);
  const rec=labComputerStore.computers[id];if(rec){rec.disconnectedAt=new Date().toISOString();persistLabComputers()}
  broadcastControllers({type:"lab.status",computer:publicLabComputer(id)});audit({kind:"lab.disconnected",id});
}

function pruneStudentData(policy=privacyRetentionPolicy()){
  const screenshotCutoff=Date.now()-policy.screenshotDays*86400000;
  let changed=false;
  for(const [id,rec] of Object.entries(labComputerStore.computers)){
    if(!Array.isArray(rec.screenshotHistory))rec.screenshotHistory=[];
    const keep=[];
    for(const item of rec.screenshotHistory){
      const t=Date.parse(item.capturedAt||0);
      if(Number.isFinite(t)&&t>=screenshotCutoff){
        keep.push(item);
      }else{
        try{
          const p=safeScreenshotPath(id,item.file);
          if(fs.existsSync(p))fs.unlinkSync(p);
        }catch{}
        changed=true;
      }
    }
    if(keep.length!==rec.screenshotHistory.length){
      rec.screenshotHistory=keep;
      changed=true;
    }
  }
  // Reconcile disk state as well as metadata so interrupted writes, deleted
  // computers, and records trimmed by older releases cannot leak files forever.
  if(fs.existsSync(LAB_SCREENSHOT_DIR))for(const entry of fs.readdirSync(LAB_SCREENSHOT_DIR,{withFileTypes:true})){
    if(!entry.isDirectory())continue;const dir=path.join(LAB_SCREENSHOT_DIR,entry.name),known=labComputerStore.computers[entry.name];
    if(!known){fs.rmSync(dir,{recursive:true,force:true});continue}
    for(const file of fs.readdirSync(dir)){const full=path.join(dir,file);try{if(fs.statSync(full).mtimeMs<screenshotCutoff)fs.rmSync(full,{force:true})}catch{}}
  }
  for(const [id,rec] of Object.entries(labComputerStore.computers))if(rec.screenshotFile){
    try{if(!fs.existsSync(safeScreenshotPath(id,rec.screenshotFile))){rec.screenshotFile=null;rec.screenshotAt=null;changed=true}}catch{rec.screenshotFile=null;rec.screenshotAt=null;changed=true}
  }
  if(changed)persistLabComputers();
  const historyCutoff=Date.now()-policy.browserHistoryHours*3600000;let historyChanged=false;
  for(const [id,list] of Object.entries(labHistoryStore.computers)){if(!Array.isArray(list))continue;const keep=(!policy.browserHistoryEnabled||policy.browserHistoryHours===0)?[]:list.filter(x=>Date.parse(x.visitTime||x.receivedAt||0)>=historyCutoff).slice(0,100000);if(keep.length!==list.length){labHistoryStore.computers[id]=keep;historyChanged=true}}
  if(historyChanged)persistLabHistory();
  const alertCutoff=Date.now()-policy.alertDays*86400000,alerts=labAiAlertsStore.alerts.filter(x=>Date.parse(x.createdAt||0)>=alertCutoff);
  if(alerts.length!==labAiAlertsStore.alerts.length){labAiAlertsStore.alerts=alerts;persistLabAiAlerts()}
  const auditCutoff=new Date(Date.now()-policy.auditDays*86400000).toISOString();
  dbStore.db.prepare("DELETE FROM audit_events WHERE at < ?").run(auditCutoff);
}

const studentDataPruneTimer=setInterval(()=>{try{pruneStudentData()}catch(error){diagnosticError(error,{component:"privacy-retention",operation:"periodic-prune"})}},10*60*1000);studentDataPruneTimer.unref();
setTimeout(()=>{try{pruneStudentData()}catch(error){diagnosticError(error,{component:"privacy-retention",operation:"startup-prune"})}},5000).unref();

const baseDeviceConfig = readJson(DEVICE_CONFIG_FILE, {
  room: ROOM_NAME,
  devices: {},
  displayGroups: {},
  lightingGroups: []
});
const runtimeConfig = readJson(RUNTIME_CONFIG_FILE, {});

let deviceConfig = {
  ...baseDeviceConfig,
  ...runtimeConfig,
  devices: {...(baseDeviceConfig.devices||{}),...(runtimeConfig.devices||{})},
  displayGroups: {...(baseDeviceConfig.displayGroups||{}),...(runtimeConfig.displayGroups||{})},
  lightingGroups: runtimeConfig.lightingGroups || baseDeviceConfig.lightingGroups || []
};
let devices=deviceConfig.devices||{};
let displayGroups=deviceConfig.displayGroups||{};
let lightingGroups=new Set(deviceConfig.lightingGroups||[]);
// v1.0-alpha.5: the relational devices tables are authoritative. Any legacy
// runtime-config overlay is merged once at startup and retired.
try{
  dbStore.writeNormalized("devices",{room:deviceConfig.room||ROOM_NAME,devices,displayGroups,lightingGroups:[...lightingGroups]});
  if(dbStore.hasObject("runtime-config")){dbStore.recordMigration("sqlite:object_store/runtime-config","sqlite:normalized/devices",1,{schemaVersion:3});dbStore.deleteObject("runtime-config")}
}catch(err){console.warn(`Runtime device consolidation failed: ${err.message}`)}
function persistRuntimeConfig(){
  deviceConfig={room:deviceConfig.room||ROOM_NAME,devices,displayGroups,lightingGroups:[...lightingGroups]};
  dbStore.writeNormalized("devices",deviceConfig);
}

const persistentState = readJson(STATE_FILE, {
  displays: {},
  lastCommandAt: null
});
let savedScenes = readJson(SCENES_FILE, {
  welcome:{name:"Welcome",actions:[
    {type:"display.background",payload:{color:"#0b1220"}},
    {type:"display.text",payload:{text:"Welcome to the Networking Lab",color:"#ffffff",size:72,position:"center",background:"rgba(0,0,0,0)"}}
  ]},
  scenario:{name:"Scenario",actions:[
    {type:"display.background",payload:{color:"#07111f"}},
    {type:"display.text",payload:{text:"Troubleshooting Scenario",color:"#ffffff",size:64,position:"top",background:"rgba(0,0,0,.35)"}}
  ]}
});
function persistScenes(){persistJson(SCENES_FILE,savedScenes);}


// -----------------------------------------------------------------------------
// v0.6.1 Classroom Session Engine
// Coordinates many student clients against one TV and shared room lighting.
// -----------------------------------------------------------------------------

let classroomSessions = readJson(SESSIONS_FILE, {});

function persistSessions() {
  try {
    persistJson(SESSIONS_FILE,classroomSessions);
  } catch (err) {
    console.error("Session persistence failed:", err.message);
  }
}

function cleanShort(value, max=120) {
  return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, max);
}

function csvCell(value){
  let text=String(value??"");
  // Spreadsheet applications may execute formula-like cells even when they
  // are correctly CSV-quoted. Preserve the visible value as literal text.
  if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r]/.test(text))text="'"+text;
  return `"${text.replace(/"/g,'""')}"`;
}

function validHexColor(value) {
  const v = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "#1769e0";
}

// Legacy participation templates were site-specific and referenced assets that are
// not part of the product. Session templates will return as GUI-managed records.
const OPENING_TOPICS = Object.freeze({});

function allowStudentEvent(session, studentId, minMs=700) {
  const st=session.students?.[studentId];
  if (!st) return true;
  const now=Date.now(),last=Number(st.lastEventAt||0);
  if (now-last<minMs) return false;
  st.lastEventAt=now;
  st.lastSeen=new Date().toISOString();
  return true;
}

function getSession(id) {
  const sid = cleanId(id || "classroom-session");
  if (!classroomSessions[sid]) {
    classroomSessions[sid] = {
      id: sid,
      name: "Classroom Session",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      paused: false,
      students: {},
      responses: {},
      topicVotes: {},
      gameScores: {},
      queue: [],
      recentEffects: [],
      currentEffect: null,
      spotlights: {},
      spotlightOrder: [],
      spotlightIndex: 0,
      spotlightRotation: true,
      stats: { joins: 0, events: 0 }
    };
    persistSessions();
  }
  return classroomSessions[sid];
}

function publicSessionState(session) {
  const topicTallies = {};
  for (const topic of Object.values(session.topicVotes || {})) {
    if (topic) topicTallies[topic] = (topicTallies[topic] || 0) + 1;
  }
  return {
    id: session.id,
    name: session.name,
    paused: !!session.paused,
    studentCount: Object.keys(session.students || {}).length,
    queueLength: (session.queue || []).length,
    currentEffect: session.currentEffect || null,
    spotlightCount: Object.keys(session.spotlights || {}).length,
    spotlightRotation: session.spotlightRotation !== false,
    topicTallies,
    gameScores: session.gameScores || {},
    stats: session.stats || {},
    updatedAt: session.updatedAt
  };
}

function broadcastSession(sessionId, payload) {
  for (const ws of wsClients) {
    if (ws.sessionId === sessionId && ["student","session-teacher"].includes(ws.role)) {
      wsSend(ws, payload);
    }
  }
}

function enqueueSessionEffect(session, effect) {
  if (!session.queue) session.queue = [];
  if (effect.kind === "topic") {
    session.queue = session.queue.filter(x => !(x.kind === "topic" && x.topic === effect.topic));
  }
  if (session.queue.length >= SESSION_MAX_QUEUE) session.queue.shift();
  session.queue.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...effect });
  session.updatedAt = new Date().toISOString();
  persistSessions();
  broadcastSession(session.id, {type:"session.state", state:publicSessionState(session)});
}


async function clearRoomDisplay() {
  try {
    await executeCommand({type:"display.clear",target:"tv1",payload:{}}, "session");
  } catch {}
  try {
    await executeCommand({type:"display.background",target:"tv1",payload:{color:"#000000"}}, "session");
  } catch {}
}

async function applySessionLighting(color) {
  const hex=validHexColor(color);
  const failures=[];

  // Preferred route: existing Node-RED all-lighting group.
  try {
    const result=await executeCommand({type:"lighting.color",target:"all",payload:{color:hex}}, "session");
    audit({kind:"session.lighting",mode:"group",color:hex,result});
    return {ok:true,mode:"group"};
  } catch (err) {
    failures.push({target:"all",error:err.message});
  }

  // Fallback route: known classroom Govee aliases.
  const targets=["services","tv1","tv2","tv3","tv4","tv5","tv6"];
  let success=0;
  for (const target of targets) {
    try {
      await executeCommand({type:"lighting.color",target,payload:{color:hex}}, "session");
      success++;
    } catch (err) {
      failures.push({target,error:err.message});
    }
  }

  audit({kind:"session.lighting",mode:"fallback",color:hex,success,failures});
  if (!success) throw new Error("No classroom lighting target accepted the color command");
  return {ok:true,mode:"fallback",success,failures};
}

function latestPollSummary(session) {
  const polls=session.responses?.polls || {};
  const entries=Object.entries(polls);
  if (!entries.length) return null;
  const [questionId,answers]=entries[entries.length-1];
  const tallies={};
  for (const answer of Object.values(answers || {})) tallies[answer]=(tallies[answer]||0)+1;
  return {questionId,tallies};
}

async function showClassDashboard(session) {
  if (!session) return;

  const studentCount=Object.keys(session.students||{}).length;
  const spotlightCount=Object.keys(session.spotlights||{}).length;
  const topicRows=Object.entries(publicSessionState(session).topicTallies||{})
    .sort((a,b)=>b[1]-a[1]).slice(0,4);
  const scoreRows=Object.entries(session.gameScores||{})
    .sort((a,b)=>b[1]-a[1]).slice(0,4);
  const poll=latestPollSummary(session);

  const lines=[];
  if (topicRows.length) {
    lines.push("TOP INTERESTS");
    topicRows.forEach(([k,v])=>lines.push(`${k}: ${v}`));
  }
  if (poll && Object.keys(poll.tallies).length) {
    if (lines.length) lines.push("");
    lines.push("LATEST CLASS POLL");
    Object.entries(poll.tallies).sort((a,b)=>b[1]-a[1]).slice(0,4)
      .forEach(([k,v])=>lines.push(`${k}: ${v}`));
  }
  if (scoreRows.length) {
    if (lines.length) lines.push("");
    lines.push("IT SHOWDOWN");
    scoreRows.forEach(([k,v])=>lines.push(`${k}: ${v}`));
  }
  if (!lines.length) lines.push("Waiting for class responses…");

  await executeCommand({type:"display.background",target:"tv1",payload:{color:"#07111f"}}, "session");
  await executeCommand({type:"display.title",target:"tv1",payload:{text:"Classroom CLASS LIVE",color:"#ffffff",size:70}}, "session");
  await executeCommand({type:"display.subtitle",target:"tv1",payload:{text:`${studentCount} students • ${spotlightCount} spotlights • responses update live`,color:"#7dd3fc",size:30}}, "session");
  await executeCommand({type:"display.text",target:"tv1",payload:{text:lines.join("\n"),color:"#ffffff",size:32,position:"center",background:"rgba(0,0,0,.20)"}}, "session");
}

async function runRoomEffect(effect) {
  if (!effect) return;

  if (effect.kind === "topic") {
    const t = OPENING_TOPICS[effect.topic];
    if (!t) return;
    await executeCommand({type:"display.background",target:"tv1",payload:{color:"#07111f"}}, "session");
    await executeCommand({type:"display.image",target:"tv1",payload:{url:t.image,fit:"contain",opacity:0.45}}, "session");
    await executeCommand({type:"display.title",target:"tv1",payload:{text:t.title,color:"#ffffff",size:86}}, "session");
    await executeCommand({type:"display.subtitle",target:"tv1",payload:{text:t.subtitle,color:"#ffffff",size:38}}, "session");
    await executeCommand({type:"display.text",target:"tv1",payload:{text:t.body,color:"#ffffff",size:34,position:"bottom",background:"rgba(0,0,0,.45)"}}, "session");
    try { await applySessionLighting(t.color); } catch (err) { audit({kind:"session.lighting.error",error:err.message}); }
  }

  if (effect.kind === "light-color") {
    const color = validHexColor(effect.color);
    await executeCommand({type:"display.background",target:"tv1",payload:{color:"#07111f"}}, "session");
    await executeCommand({type:"display.title",target:"tv1",payload:{text:"LIGHT LAB",color:"#ffffff",size:80}}, "session");
    await executeCommand({type:"display.subtitle",target:"tv1",payload:{text:`${cleanShort(effect.name || "A student",40)} chose ${cleanShort(effect.colorName || color,30)}`,color:"#ffffff",size:38}}, "session");
    await executeCommand({type:"display.text",target:"tv1",payload:{text:"Watch the room react — safely and through the shared session queue.",color:"#ffffff",size:32,position:"bottom",background:"rgba(0,0,0,.35)"}}, "session");
    try { await applySessionLighting(color); } catch (err) { audit({kind:"session.lighting.error",error:err.message}); }
  }

  if (effect.kind === "student-intro") {
    const color = validHexColor(effect.color);
    await executeCommand({type:"display.background",target:"tv1",payload:{color:"#0b1220"}}, "session");
    await executeCommand({type:"display.title",target:"tv1",payload:{text:`MEET ${cleanShort(effect.name,40).toUpperCase()}`,color:"#ffffff",size:82}}, "session");
    await executeCommand({type:"display.subtitle",target:"tv1",payload:{text:`Favorite color: ${cleanShort(effect.colorName || color,30)}`,color:"#ffffff",size:36}}, "session");
    await executeCommand({type:"display.text",target:"tv1",payload:{text:`Favorite activity: ${cleanShort(effect.activity,70)}\nInterested in: ${cleanShort(effect.interest,70)}`,color:"#ffffff",size:38,position:"center",background:"rgba(0,0,0,.25)"}}, "session");
    try { await applySessionLighting(color); } catch (err) { audit({kind:"session.lighting.error",error:err.message}); }
  }

  if (effect.kind === "poll") {
    const rows = Object.entries(effect.tallies || {}).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const total = rows.reduce((a,[,v])=>a+v,0) || 1;
    const text = rows.map(([k,v]) => `${k}: ${v} (${Math.round(v/total*100)}%)`).join("\n");
    await executeCommand({type:"display.background",target:"tv1",payload:{color:"#111827"}}, "session");
    await executeCommand({type:"display.title",target:"tv1",payload:{text:cleanShort(effect.title,80),color:"#ffffff",size:72}}, "session");
    await executeCommand({type:"display.text",target:"tv1",payload:{text,color:"#ffffff",size:42,position:"center",background:"rgba(0,0,0,.2)"}}, "session");
  }

  if (effect.kind === "scoreboard") {
    const rows = Object.entries(effect.scores || {}).sort((a,b)=>b[1]-a[1]);
    await executeCommand({type:"display.background",target:"tv1",payload:{color:"#101318"}}, "session");
    await executeCommand({type:"display.title",target:"tv1",payload:{text:"Classroom IT SHOWDOWN",color:"#ffffff",size:78}}, "session");
    await executeCommand({type:"display.text",target:"tv1",payload:{text:rows.map(([k,v],i)=>`${i+1}. ${k} — ${v}`).join("\n"),color:"#ffffff",size:46,position:"center",background:"rgba(0,0,0,.15)"}}, "session");
  }

}

let sessionEffectBusy = false;
const sessionLastSpotlightAt = new Map();

async function nextSessionEffect() {
  if (sessionEffectBusy) return;

  const sessions = Object.values(classroomSessions).filter(x => !x.paused);
  if (!sessions.length) return;

  // 1) Explicit queued work always wins.
  let session = sessions.find(x => Array.isArray(x.queue) && x.queue.length);
  let effect = session?.queue?.shift() || null;

  // 2) If nothing is queued, rotate through submitted student spotlights.
  if (!effect) {
    const now = Date.now();
    session = sessions.find(x => {
      if (x.spotlightRotation === false) return false;
      if (!Array.isArray(x.spotlightOrder) || !x.spotlightOrder.length) return false;
      const last=sessionLastSpotlightAt.get(x.id) || 0;
      return now-last >= SESSION_SPOTLIGHT_ROTATE_MS;
    });

    if (session) {
      const idx=Number(session.spotlightIndex||0) % session.spotlightOrder.length;
      const sid=session.spotlightOrder[idx];
      const spotlight=session.spotlights?.[sid];
      session.spotlightIndex=(idx+1) % session.spotlightOrder.length;
      sessionLastSpotlightAt.set(session.id,now);
      if (spotlight) {
        effect={
          id:crypto.randomUUID(),
          createdAt:new Date().toISOString(),
          kind:"student-intro",
          ...spotlight,
          rotation:true
        };
      }
    }
  }

  if (!session || !effect) return;

  sessionEffectBusy = true;
  session.currentEffect = effect;
  session.updatedAt = new Date().toISOString();
  persistSessions();
  broadcastSession(session.id,{type:"session.effect",effect,state:publicSessionState(session)});

  try {
    await clearRoomDisplay();
    await new Promise(r=>setTimeout(r,SESSION_CLEAR_GAP_MS));
    await runRoomEffect(effect);

    session.recentEffects=[effect,...(session.recentEffects||[])].slice(0,30);

    // Every shared room moment has a TTL. Return to live class totals instead of leaving stale/blank content.
    await new Promise(r=>setTimeout(r,SESSION_EFFECT_DURATION_MS));
    await clearRoomDisplay();

    // A master clear/pause must win over any effect that was already running.
    if (!session.paused) {
      await new Promise(r=>setTimeout(r,SESSION_CLEAR_GAP_MS));
      if (!session.paused) await showClassDashboard(session);
    }
  } catch (err) {
    audit({kind:"session.effect.error",sessionId:session.id,error:err.message,effect});
  } finally {
    session.currentEffect=null;
    session.updatedAt=new Date().toISOString();
    persistSessions();
    broadcastSession(session.id,{type:"session.state",state:publicSessionState(session)});
    sessionEffectBusy=false;
  }
}

setInterval(nextSessionEffect, SESSION_EFFECT_INTERVAL_MS);


function persistState() {
  try {
    persistJson(STATE_FILE,persistentState);
  } catch (err) {
    console.error("State persistence failed:", err.message);
  }
}

// -----------------------------------------------------------------------------
// Runtime state / audit
// -----------------------------------------------------------------------------

const runtime = {
  startedAt: new Date().toISOString(),
  mqtt: {
    configured: Boolean(MQTT_URL),
    connected: false,
    url: MQTT_URL ? MQTT_URL.replace(/:\/\/.*@/, "://***@") : "",
    lastError: null,
    lastConnectAt: null
  },
  hardware: {
    pluto: {configured:Boolean(PLUTO_URL),url:PLUTO_URL,lastError:null,lastSuccessAt:null},
    govee: {configured:Object.keys(goveeDevices).length>0,lastError:null,lastSuccessAt:null}
  },
  displays: {},
  websocketClients: 0
};

const recentEvents = [];

function telemetryKey(entry){
  const kind=String(entry?.kind||"telemetry");
  if(kind==="govee.discovery")return `${kind}:${entry.deviceId||entry.alias||"unknown"}`;
  if(kind==="govee.discovery.reconcile")return `${kind}:inventory`;
  if(kind==="api.request")return `${kind}:${entry.method||"GET"}:${entry.path||"/"}`;
  if(kind==="veyon.framebuffer.unavailable")return `${kind}:${entry.path||entry.target||"framebuffer"}`;
  if(kind==="service.action")return `${kind}:${entry.component||"service"}:${entry.operation||"unknown"}:${entry.path||entry.device||""}`;
  if(kind==="mqtt.connected")return `${kind}:${entry.url||"broker"}`;
  return `${kind}:${entry.component||entry.deviceId||entry.target||"state"}`;
}
function isTelemetryEvent(entry){
  const kind=String(entry?.kind||"");
  if(["govee.discovery","govee.discovery.reconcile","api.request","veyon.framebuffer.unavailable","mqtt.connected"].includes(kind))return true;
  if(kind==="service.action" && String(entry.operation||"").toUpperCase()==="GET" && entry.ok!==false)return true;
  return false;
}
function audit(event) {
  const entry = {
    at: new Date().toISOString(),
    ...event
  };
  recentEvents.push(entry);
  if (recentEvents.length > 2000) recentEvents.shift();

  if(isTelemetryEvent(entry))dbStore.recordTelemetry(entry,telemetryKey(entry));
  else dbStore.appendAudit(entry);
  return entry;
}


function diagnosticSanitize(value,depth=0){
  if(depth>6)return "[max-depth]";
  if(value===null||value===undefined)return value;
  if(Array.isArray(value))return value.slice(0,100).map(v=>diagnosticSanitize(v,depth+1));
  if(typeof value!=="object")return value;
  const out={};
  for(const [k,v] of Object.entries(value)){
    const key=String(k).toLowerCase();
    if(/password|passwd|secret|token|keydata|privatekey|authorization|credential/.test(key)){
      out[k]="[redacted]";
    }else{
      out[k]=diagnosticSanitize(v,depth+1);
    }
  }
  return out;
}
function diagnosticError(error,context={}){
  return audit({
    kind:"error",
    component:context.component||"classroom-hub",
    operation:context.operation||null,
    message:error?.message||String(error),
    name:error?.name||null,
    code:error?.code||null,
    status:error?.status||null,
    stack:String(error?.stack||"").split("\n").slice(0,12).join("\n"),
    context:diagnosticSanitize(context.data||{})
  });
}
process.on("unhandledRejection",reason=>diagnosticError(reason instanceof Error?reason:new Error(String(reason)),{component:"node",operation:"unhandledRejection"}));
process.on("uncaughtException",err=>{diagnosticError(err,{component:"node",operation:"uncaughtException"});process.exitCode=1;const timer=setTimeout(()=>process.exit(1),100);timer.unref()});

function diagnosticsFileStatus(file){
  try{
    const st=fs.statSync(file);
    return {path:file,exists:true,size:st.size,modifiedAt:st.mtime.toISOString(),readable:true};
  }catch(err){
    return {path:file,exists:false,readable:false,error:err.message};
  }
}
function diagnosticsEventSlice({limit=250,kind=null,errorsOnly=false}={}){
  let rows=recentEvents;
  if(kind)rows=rows.filter(e=>String(e.kind||"")===String(kind));
  if(errorsOnly)rows=rows.filter(e=>
    e.kind!=="veyon.framebuffer.unavailable" &&
    (e.kind==="error"||e.ok===false||e.status>=400||String(e.kind||"").includes("error"))
  );
  return rows.slice(-Math.max(1,Math.min(2000,Number(limit||250))));
}


function publicDisplayStatus(id) {
  const now=Date.now();
  const offlineMs=DEVICE_OFFLINE_SECONDS*1000;
  const r=runtime.displays[id]||{};
  const seen=r.lastSeen?Date.parse(r.lastSeen):0;
  const activeSocket=[...wsClients].some(ws =>
    ws.role==="display" &&
    ws.deviceId===id &&
    ws.readyState===WebSocket.OPEN
  );
  return {
    ...r,
    online:Boolean(activeSocket || (seen && now-seen<=offlineMs))
  };
}

function publicRuntime() {
  const now = Date.now();
  const offlineMs = DEVICE_OFFLINE_SECONDS * 1000;

  const displayStatus = {};
  for (const id of Object.keys(devices)) {
    displayStatus[id]=publicDisplayStatus(id);
  }

  return {
    startedAt: runtime.startedAt,
    room: deviceConfig.room || ROOM_NAME,
    mqtt: runtime.mqtt,
    hardware: runtime.hardware,
    websocketClients: runtime.websocketClients,
    displays: displayStatus
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function cleanId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 80);
}

function cookieValue(req,name){
  const raw=String(req.headers?.cookie||"");
  for(const part of raw.split(";")){const i=part.indexOf("=");if(i<0)continue;const k=part.slice(0,i).trim();if(k===name)return decodeURIComponent(part.slice(i+1).trim())}
  return "";
}
function requestUser(req){
  if(req.authUser!==undefined)return req.authUser;
  const token=cookieValue(req,"classroom_hub_session");
  req.authUser=dbStore.sessionUser(token)||null;
  return req.authUser;
}
function hasRole(user,minRole="operator"){
  const rank={viewer:1,operator:2,admin:3};return !!user&&(rank[user.role]||0)>=(rank[minRole]||2);
}
function userCapabilities(user){
  if(!user)return [];
  const profile=(dbStore.listAccessProfiles()||[]).find(x=>x.id===user.profileId&&x.enabled);
  return capabilitiesFor(user,profile);
}
function hasCapability(user,capability){const profile=(dbStore.listAccessProfiles()||[]).find(x=>x.id===user?.profileId&&x.enabled);return profileHasCapability(user,capability,profile)}
function publicUser(user){return user?{id:user.id,username:user.username,displayName:user.displayName,role:user.role,profileId:user.profileId||null,capabilities:userCapabilities(user)}:null}
function authenticationUnavailable(res){
  return res.status(503).json({ok:false,error:"Secure setup is required before this operation is available",setupRequired:dbStore.userCount()===0});
}
function requireControl(req, res, next) {
  if(dbStore.authEnabled()){
    const user=requestUser(req);if(!user)return res.status(401).json({ok:false,error:"Authentication required",authRequired:true});if(!hasCapability(user,"classroom.control"))return res.status(403).json({ok:false,error:"Permission required: classroom.control"});return next();
  }
  if(!CONTROL_TOKEN)return authenticationUnavailable(res);
  const token=req.get("x-control-token")||"";
  if(!secureTokenEqual(token,CONTROL_TOKEN))return res.status(401).json({ok:false,error:"Unauthorized"});
  next();
}
function requireAdmin(req,res,next){
  if(dbStore.authEnabled()){
    const user=requestUser(req);if(!hasRole(user,"admin")||!hasCapability(user,"*"))return res.status(403).json({ok:false,error:"Enabled administrator profile required"});return next();
  }
  return requireControl(req,res,next);
}
function requireAuthenticated(req,res,next){
  if(!dbStore.authEnabled())return requireControl(req,res,next);
  const user=requestUser(req);if(!user)return res.status(401).json({ok:false,error:"Authentication required",authRequired:true});return next();
}
function requireCapability(capability){return (req,res,next)=>{
  if(!dbStore.authEnabled())return requireControl(req,res,next);
  const user=requestUser(req);if(!user)return res.status(401).json({ok:false,error:"Authentication required",authRequired:true});
  if(!hasCapability(user,capability))return res.status(403).json({ok:false,error:`Permission required: ${capability}`});
  next();
}}
function requireClassroomRead(req,res,next){return requireCapability("classroom.read")(req,res,next)}

function requireMaintenanceAgent(req,res,next){
  if(!MAINTENANCE_TOKEN)return res.status(503).json({ok:false,error:"Maintenance agent is not configured"});
  if(!secureTokenEqual(req.get("x-maintenance-token")||"",MAINTENANCE_TOKEN))return res.status(401).json({ok:false,error:"Unauthorized maintenance agent"});
  next();
}

function resolveDisplayTargets(target) {
  if (Array.isArray(target)) {
    return [...new Set(target.flatMap(resolveDisplayTargets))];
  }

  const t = cleanId(target || "all");
  if (devices[t] && devices[t].enabled !== false) return [t];

  if (Array.isArray(displayGroups[t])) {
    return displayGroups[t].filter(
      (id) => devices[id] && devices[id].enabled !== false
    );
  }

  return [];
}

function commandId() {
  return crypto.randomUUID();
}

function normalizeCommand(input, source = "api") {
  const type = String(input?.type || "").trim();
  if (!type || type.length > 120) {
    throw new Error("Command type is required");
  }

  const target = input?.target ?? "all";
  const payload =
    input?.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
      ? input.payload
      : {};

  return {
    version: 1,
    id: String(input?.id || commandId()),
    timestamp: Date.now(),
    source: String(input?.source || source).slice(0, 80),
    room: String(input?.room || deviceConfig.room || ROOM_NAME).slice(0, 80),
    target,
    type,
    payload
  };
}

function setDisplayState(id, patch) {
  persistentState.displays[id] = {
    ...(persistentState.displays[id] || {}),
    ...patch,
    updatedAt: new Date().toISOString()
  };
  persistentState.lastCommandAt = new Date().toISOString();
}

function updateStateFromCommand(command, targets) {
  const p = command.payload;

  for (const id of targets) {
    switch (command.type) {
      case "display.text":
        setDisplayState(id, { text: p.text ?? "", textOptions: p });
        break;
      case "display.title":
        setDisplayState(id, { title: p.text ?? "", titleOptions: p });
        break;
      case "display.subtitle":
        setDisplayState(id, { subtitle: p.text ?? "", subtitleOptions: p });
        break;
      case "display.background":
        setDisplayState(id, { background: p });
        break;
      case "display.image":
        setDisplayState(id, { media: { type: "image", ...p } });
        break;
      case "display.video":
        setDisplayState(id, { media: { type: "video", ...p } });
        break;
      case "display.web":
        setDisplayState(id, { media: { type: "web", ...p } });
        break;
      case "display.pdf":
      case "display.document":
        setDisplayState(id, { media: { type: "pdf", ...p } });
        break;
      case "display.presentation":
        setDisplayState(id, { media: { type: "image", ...p }, presentationBlack: false });
        break;
      case "display.presentation.black":
        setDisplayState(id, { presentationBlack: !!p.black });
        break;
      case "display.timer":
        setDisplayState(id, { timer: { ...p } });
        break;
      case "display.timer.hide":
        setDisplayState(id, { timer: { ...(persistentState.displays[id]?.timer || {}), visible: false, running: false } });
        break;
      case "display.clear":
        setDisplayState(id, {
          text: "",
          textOptions: { text: "" },
          title: "",
          titleOptions: { text: "" },
          subtitle: "",
          subtitleOptions: { text: "" },
          media: null,
          background: { color: "#000000" },
          identify: null,
          presentationBlack: false,
          timer: { visible: false, running: false }
        });
        break;
      case "display.home":
        setDisplayState(id, { mode: "home" });
        break;
      default:
        break;
    }
  }

  persistState();
}

function sanitizeText(text, max = 20000) {
  return String(text ?? "").slice(0, max);
}

function safeMediaUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("/media/") ||
    url.startsWith("/document-viewer/") ||
    url.startsWith("/presentations/")
  ) {
    return url;
  }
  throw new Error("Media URL must use http://, https://, /media/, /document-viewer/, or /presentations/");
}

// -----------------------------------------------------------------------------
// Legacy MQTT translator
// Preserves the command vocabulary used by the existing LG/Smart-TV receivers.
// -----------------------------------------------------------------------------

const legacyColorMap = new Map([
  ["#ff0000", "RED"],
  ["red", "RED"],
  ["#ff9900", "AMBER"],
  ["amber", "AMBER"],
  ["#0066ff", "BLUE"],
  ["blue", "BLUE"],
  ["#008000", "GREEN"],
  ["green", "GREEN"],
  ["#7b2cff", "PURPLE"],
  ["purple", "PURPLE"],
  ["#ffffff", "WHITE"],
  ["white", "WHITE"],
  ["#000000", "BLACK"],
  ["black", "BLACK"]
]);

function toLegacyCommand(command) {
  const p = command.payload || {};

  switch (command.type) {
    case "display.text":
      return "MESSAGE:" + sanitizeText(p.text, 8000);

    case "display.background": {
      const key = String(p.color || "").trim().toLowerCase();
      return legacyColorMap.get(key) || null;
    }

    case "display.image":
      return "IMAGE:" + safeMediaUrl(p.url);

    case "display.video":
      return (p.muted ? "PLAYMUTED:" : "PLAY:") + safeMediaUrl(p.url);

    case "display.web":
      return "WEB:" + safeMediaUrl(p.url);

    case "display.pdf":
      return "PDF:" + safeMediaUrl(p.url);

    case "display.ppt":
      return "PPT:" + safeMediaUrl(p.url);

    case "display.clear":
      return "BLANK";

    case "display.home":
      return "HOME";

    case "display.stop":
      return "STOP";

    case "display.reload":
      return "RELOAD";

    case "display.setup":
      return "SETUP";

    case "voice.speak":
      return "VOICE:" + sanitizeText(p.text, 8000);

    case "sfx.play":
      return "SFX:" + sanitizeText(p.kind, 100);

    case "legacy.raw":
      return sanitizeText(p.command, 12000);

    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// MQTT
// -----------------------------------------------------------------------------

let mqttClient = null;

function mqttPublish(topic, payload, options = {}) {
  return new Promise((resolve, reject) => {
    if (!mqttClient || !runtime.mqtt.connected) {
      return reject(new Error("MQTT is not connected"));
    }

    mqttClient.publish(
      topic,
      typeof payload === "string" ? payload : JSON.stringify(payload),
      { qos: 0, retain: false, ...options },
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function connectMqtt() {
  runtime.mqtt.configured=Boolean(MQTT_URL);
  runtime.mqtt.url=MQTT_URL?MQTT_URL.replace(/:\/\/.*@/, "://***@"):"";
  runtime.mqtt.lastError=null;
  if (!MQTT_URL) {
    console.log("MQTT_URL is blank; MQTT bridge disabled.");
    return;
  }

  const options = {
    clientId: "classroom-hub-" + crypto.randomBytes(4).toString("hex"),
    reconnectPeriod: 2000,
    connectTimeout: 10000,
    clean: true
  };

  if (MQTT_USERNAME) options.username = MQTT_USERNAME;
  if (MQTT_PASSWORD) options.password = MQTT_PASSWORD;

  mqttClient = mqtt.connect(MQTT_URL, options);

  mqttClient.on("connect", () => {
    runtime.mqtt.connected = true;
    runtime.mqtt.lastError = null;
    runtime.mqtt.lastConnectAt = new Date().toISOString();
    console.log("MQTT connected:", MQTT_URL);

    mqttClient.subscribe(
      [
        "classroom/v2/display/+/state",
        "classroom/v2/display/+/presence",
        "homeassistant/light/+/config",
        "gv2mqtt/light/+/state",
        "gv2mqtt/light/+/availability",
        "gv2mqtt/sensor/+/state",
        "gv2mqtt/sensor/+/attributes"
      ],
      { qos: 0 }
    );

    audit({ kind: "mqtt.connected", url: runtime.mqtt.url });
  });

  mqttClient.on("reconnect", () => {
    runtime.mqtt.connected = false;
  });

  mqttClient.on("close", () => {
    runtime.mqtt.connected = false;
  });

  mqttClient.on("offline", () => {
    runtime.mqtt.connected = false;
  });

  mqttClient.on("error", (err) => {
    runtime.mqtt.lastError = err.message;
    console.error("MQTT error:", err.message);
  });

  mqttClient.on("message", (topic, payloadBuffer) => {
    const payloadText = payloadBuffer.toString();
    let payload;
    try { payload = JSON.parse(payloadText); } catch { payload = {raw:payloadText}; }

    const dm = topic.match(/^classroom\/v2\/display\/([^/]+)\/(state|presence)$/);
    if (dm) {
      const id=cleanId(dm[1]);
      if (!devices[id]) return;
      runtime.displays[id]={...(runtime.displays[id]||{}),lastSeen:new Date().toISOString(),source:"mqtt",[dm[2]]:payload};
      broadcastControllers({type:"device.status",deviceId:id,status:publicDisplayStatus(id)});
      return;
    }

    const cm=topic.match(/^homeassistant\/light\/gv2mqtt-([^/]+)\/config$/);
    if(cm){
      const deviceId=cm[1];
      goveeLiveConfigs[deviceId]=payload;
      const alias=enrollGoveeDevice(deviceId,payload,"homeassistant-discovery");
      touchGoveePresence(deviceId,"online");
      if(alias)broadcastControllers({type:"govee.inventory",reason:"discovery",alias});
      return;
    }

    const sm=topic.match(/^gv2mqtt\/light\/([^/]+)\/state$/);
    if(sm){
      const deviceId=sm[1];
      if(!goveeConfiguredAliasById(deviceId) && goveeDiscovery.autoAdd!==false){
        enrollGoveeDevice(deviceId,goveeLiveConfigs[deviceId]||{},"light-state");
      }
      goveeStates[deviceId]=payload;
      touchGoveePresence(deviceId,"online");
      broadcastControllers({type:"govee.status",deviceId,state:payload});
      return;
    }

    const am=topic.match(/^gv2mqtt\/light\/([^/]+)\/availability$/);
    if(am){
      const deviceId=am[1];
      if(!goveeConfiguredAliasById(deviceId) && goveeDiscovery.autoAdd!==false){
        enrollGoveeDevice(deviceId,goveeLiveConfigs[deviceId]||{},"availability");
      }
      const raw=String(payload?.raw??payloadText??"").trim().toLowerCase();
      touchGoveePresence(deviceId,raw||"online");
      broadcastControllers({type:"govee.presence",deviceId,status:raw||"online"});
      return;
    }

    const gsm=topic.match(/^gv2mqtt\/sensor\/sensor-([^/]+)-gv2mqtt-status\/state$/);
    if(gsm){
      const deviceId=gsm[1];
      const raw=String(payload?.raw??payloadText??"").trim().toLowerCase();
      if(!goveeConfiguredAliasById(deviceId) && goveeDiscovery.autoAdd!==false){
        enrollGoveeDevice(deviceId,goveeLiveConfigs[deviceId]||{},"status-state");
      }
      touchGoveePresence(deviceId,["available","online","on","true","1"].includes(raw)?"online":raw||"online");
      broadcastControllers({type:"govee.presence",deviceId,status:raw||"online"});
      return;
    }

    const gam=topic.match(/^gv2mqtt\/sensor\/sensor-([^/]+)-gv2mqtt-status\/attributes$/);
    if(gam){
      const deviceId=gam[1];
      const meta=goveeMetaFromStatusAttributes(deviceId,payload||{});
      goveeLiveConfigs[deviceId]={...(goveeLiveConfigs[deviceId]||{}),...meta};
      const alias=enrollGoveeDevice(deviceId,meta,"status-attributes");
      const overall=meta.overall||{};
      if(overall && typeof overall==="object"){
        const st={};
        if(overall.on!==undefined||overall.light_on!==undefined)st.state=(overall.on??overall.light_on)?"ON":"OFF";
        if(overall.brightness!==undefined)st.brightness=overall.brightness;
        if(overall.color)st.color=overall.color;
        if(overall.scene)st.effect=overall.scene;
        if(Object.keys(st).length)goveeStates[deviceId]={...(goveeStates[deviceId]||{}),...st};
      }
      touchGoveePresence(deviceId,"online");
      if(alias)broadcastControllers({type:"govee.inventory",reason:"status-attributes",alias});
      return;
    }
  });
}

function reconnectMqtt(){
  if(mqttClient){mqttClient.removeAllListeners();mqttClient.end(true);mqttClient=null}
  runtime.mqtt.connected=false;
  connectMqtt();
}

// -----------------------------------------------------------------------------
// Direct hardware integrations — Govee + Pluto Mark I
// -----------------------------------------------------------------------------

function colorParts(payload) {
  if (payload.r !== undefined && payload.g !== undefined && payload.b !== undefined) {
    const vals=[payload.r,payload.g,payload.b].map(Number);
    if(vals.some(v=>!Number.isFinite(v)||v<0||v>255)) throw new Error("RGB values must be 0-255");
    return vals.map(Math.round);
  }
  const hex=String(payload.color||"").trim();
  const m=hex.match(/^#?([0-9a-f]{6})$/i);
  if(!m) throw new Error("Color must be #RRGGBB or r/g/b");
  const n=parseInt(m[1],16);
  return [(n>>16)&255,(n>>8)&255,n&255];
}

function goveeTargets(target){
  const t=cleanId(target);
  if(goveeDevices[t]) return [t];
  if(Array.isArray(goveeGroups[t])) return [...goveeGroups[t]];
  throw new Error(`Unknown Govee device/group: ${t}`);
}

async function goveeUdpTemperature(device,kelvin){
  return new Promise((resolve,reject)=>{
    const sock=dgram.createSocket("udp4");
    const packet=Buffer.from(JSON.stringify({msg:{cmd:"colorwc",data:{color:{r:0,g:0,b:0},colorTemInKelvin:kelvin}}}));
    const done=(err)=>{try{sock.close()}catch{};err?reject(err):resolve({method:"native-udp",ip:device.ip,port:4003})};
    sock.send(packet,4003,device.ip,done);
  });
}

async function goveePublish(alias,payload){
  const d=goveeDevices[alias];
  if(!d) throw new Error(`Unknown Govee device ${alias}`);
  const started=Date.now();
  try{
    await mqttPublish(`gv2mqtt/light/${d.id}/command`,payload);
    runtime.hardware.govee.lastError=null;
    runtime.hardware.govee.lastSuccessAt=new Date().toISOString();
    audit({kind:"service.action",component:"govee",operation:"mqttPublish",device:alias,durationMs:Date.now()-started,ok:true});
    return {device:alias,name:d.name,payload};
  }catch(err){
    runtime.hardware.govee.lastError=err.message;
    diagnosticError(err,{component:"govee",operation:"mqttPublish",data:{device:alias}});
    throw err;
  }
}

async function directGoveeCommand(target,action,p={}){
  const aliases=goveeTargets(target);
  const results=[];
  for(const alias of aliases){
    const d=goveeDevices[alias];
    if(action==="on") results.push(await goveePublish(alias,{state:"ON"}));
    else if(action==="off") results.push(await goveePublish(alias,{state:"OFF"}));
    else if(action==="brightness"){
      const level=Math.round(Number(p.level));
      if(!Number.isFinite(level)||level<1||level>100) throw new Error("Brightness must be 1-100");
      results.push(await goveePublish(alias,{state:"ON",brightness:level}));
    } else if(action==="color"){
      const [r,g,b]=colorParts(p);
      results.push(await goveePublish(alias,{state:"ON",color:{r,g,b}}));
    } else if(action==="temp"){
      const kelvin=Math.round(Number(p.kelvin));
      if(!Number.isFinite(kelvin)||kelvin<2000||kelvin>9000) throw new Error("Kelvin must be 2000-9000");
      if(d.sku==="H618G" && d.ip){
        results.push({device:alias,name:d.name,kelvin,...await goveeUdpTemperature(d,kelvin)});
      }else{
        const mired=Math.round(1000000/kelvin);
        results.push(await goveePublish(alias,{state:"ON",color_temp:mired}));
      }
    } else if(action==="scene"){
      const scene=String(p.scene||"").trim();
      if(!scene) throw new Error("Scene is required");
      results.push(await goveePublish(alias,{state:"ON",effect:scene}));
    } else throw new Error(`Unsupported Govee action ${action}`);
  }
  audit({kind:"govee.command",target,action,count:aliases.length});
  return {ok:true,target,action,count:aliases.length,results};
}

function goveeInventory(){
  const states={},presence={},meta={};
  for(const [alias,d] of Object.entries(goveeDevices)){
    states[alias]=goveeStates[d.id]||null;
    const reg=Object.values(goveeDiscovery.devices).find(x=>x?.id===String(d.id));
    presence[alias]={online:goveeDeviceOnline(d.id),lastSeen:goveePresence[d.id]?.lastSeen||reg?.lastSeen||d.lastSeen||null};
    meta[alias]={discovered:!!reg?.discovered,source:reg?.source||"configured",groups:reg?.groups||[]};
  }
  return {ok:true,direct:true,devices:goveeDevices,groups:goveeGroups,states,presence,meta,discovery:{
    autoAdd:goveeDiscovery.autoAdd!==false,
    lastDiscoveryAt:goveeDiscovery.lastDiscoveryAt,
    discoveredCount:Object.values(goveeDiscovery.devices).filter(x=>x?.discovered&&!isSyntheticGoveeEntity(x?.id,x)).length,
    totalCount:Object.keys(goveeDevices).length,
    reconcileGraceSeconds:Math.floor(GOVEE_RECONCILE_GRACE_MS/1000)
  }};
}

function goveeScenes(alias){
  const d=goveeDevices[cleanId(alias)];
  if(!d) throw new Error("Unknown Govee device");
  const cfg=goveeLiveConfigs[d.id]||{};
  const live=Array.isArray(cfg.effect_list)?cfg.effect_list:[];
  const scenes=live.length?live:(goveeSceneFallback[d.sku]||[]);
  return {ok:true,device:cleanId(alias),name:d.name,sku:d.sku,source:live.length?"live-mqtt":"verified-fallback",scenes,count:scenes.length};
}

function plutoBuild(action){
  const p=action||{};
  const bit=v=>v?1:0;
  let body,expected,readOnly=false;
  switch(p.action){
    case "videoStatus": body={comhead:"get video status"}; expected="get video status"; readOnly=true; break;
    case "outputStatus": body={comhead:"get output status"}; expected="get output status"; readOnly=true; break;
    case "inputStatus": body={comhead:"get input status"}; expected="get input status"; readOnly=true; break;
    case "cecStatus": body={comhead:"get cec status"}; expected="get cec status"; readOnly=true; break;
    case "systemStatus": body={comhead:"get system status"}; expected="get system status"; readOnly=true; break;
    case "networkStatus": body={comhead:"get network"}; expected="get network"; readOnly=true; break;
    case "route": body={comhead:"video switch",source:[Number(p.input),Number(p.output)]};expected="video switch";break;
    case "hdmiStream": body={comhead:"hdmi tx stream",out:[Number(p.output),bit(p.state)]};expected="hdmi tx stream";break;
    case "hdbtStream": body={comhead:"hdbt tx stream",out:[Number(p.output),bit(p.state)]};expected="hdbt tx stream";break;
    case "hdmiScaler": body={comhead:"video hdmi scaler",value:[Number(p.output),Number(p.mode)]};expected="video hdmi scaler";break;
    case "hdbtScaler": body={comhead:"video hdbt scaler",value:[Number(p.output),Number(p.mode)]};expected="video hdbt scaler";break;
    case "txHdcp": body={comhead:"tx hdcp",hdcp:[Number(p.output),bit(p.state)]};expected="tx hdcp";break;
    case "arc": body={comhead:"set arc",arc:[Number(p.output),bit(p.state)]};expected="set arc";break;
    case "setInputNames": body={comhead:"set input name",input:p.names};expected="set input name";break;
    case "setHdmiOutputNames": body={comhead:"set hdmiout name",output:p.names};expected="set hdmiout name";break;
    case "setHdbtOutputNames": body={comhead:"set hdbtout name",output:p.names};expected="set hdbtout name";break;
    case "setEdid": body={comhead:"set edid",edid:[Number(p.input),Number(p.profile)]};expected="set edid";break;
    case "panelLock": body={comhead:"set panel lock",lock:bit(p.state)};expected="set panel lock";break;
    case "beep": body={comhead:"set beep",beep:bit(p.state)};expected="set beep";break;
    case "backlight": body={comhead:"set bl mode",mode:Number(p.mode)};expected="set bl mode";break;
    case "reboot": body={comhead:"reboot",reboot:1};expected="reboot";break;
    case "cecAllOutputs": body={comhead:"cec command",language:0,object:1,port:new Array(16).fill(1),index:Number(p.index)};expected="cec command";break;
    case "cecAllHdmi": body={comhead:"cec command",language:0,object:1,port:[1,1,1,1,1,1,1,1,0,0,0,0,0,0,0,0],index:Number(p.index)};expected="cec command";break;
    case "cecAllHdbt": body={comhead:"cec command",language:0,object:1,port:[0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1],index:Number(p.index)};expected="cec command";break;
    case "cecInput":{
      const ports=new Array(8).fill(0),i=Number(p.input);if(i<1||i>8)throw new Error("Invalid CEC input");
      ports[i-1]=1;body={comhead:"cec command",language:0,object:0,port:ports,index:Number(p.index)};expected="cec command";break;
    }
    case "cecOutput":{
      const ports=new Array(16).fill(0),o=Number(p.output);if(o<1||o>8)throw new Error("Invalid CEC output");
      ports[(p.connection==="hdbt"?8:0)+(o-1)]=1;body={comhead:"cec command",language:0,object:1,port:ports,index:Number(p.index)};expected="cec command";break;
    }
    case "raw":
      if(!p.body||typeof p.body!=="object"||!p.body.comhead)throw new Error("Raw body must contain comhead");
      body=p.body;expected=String(p.body.comhead);break;
    default: throw new Error(`Unknown Pluto action: ${p.action}`);
  }
  return {body,expected,readOnly,meta:p};
}

async function plutoPostRaw(body){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),PLUTO_TIMEOUT_MS),started=Date.now();
  try{
    const r=await fetch(PLUTO_URL,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","Connection":"close"},body:JSON.stringify(body),signal:controller.signal});
    const text=await r.text();
    let data;try{data=JSON.parse(text)}catch{throw new Error(`Pluto returned non-JSON: ${text.slice(0,300)}`)}
    if(!r.ok)throw new Error(`Pluto HTTP ${r.status}`);
    audit({kind:"service.action",component:"pluto",operation:String(body?.comhead||"request"),durationMs:Date.now()-started,status:r.status,ok:true});
    return data;
  }catch(err){
    diagnosticError(err,{component:"pluto",operation:String(body?.comhead||"request")});
    throw err;
  }finally{clearTimeout(timer)}
}

async function directPluto(action){
  const req=plutoBuild(action);
  let last;
  const attempts=req.readOnly?Math.max(1,PLUTO_READ_RETRIES+1):1;
  const delays=[0,120,250,500,900];
  for(let n=0;n<attempts;n++){
    if(n && delays[Math.min(n,delays.length-1)]) await new Promise(r=>setTimeout(r,delays[Math.min(n,delays.length-1)]));
    try{
      const raw=await plutoPostRaw(req.body);last=raw;
      if(raw?.comhead===req.expected){
        runtime.hardware.pluto.lastError=null;runtime.hardware.pluto.lastSuccessAt=new Date().toISOString();
        if(req.readOnly)return {type:action.action,data:raw,retries:n};
        if(action.action==="raw")return {type:"raw",data:raw};
        return {type:"ack",action:action.action,result:raw.result,ok:Number(raw.result)===1,raw};
      }
      if(!req.readOnly){
        runtime.hardware.pluto.lastError=null;runtime.hardware.pluto.lastSuccessAt=new Date().toISOString();
        return {type:"ack",action:action.action,ok:true,pendingVerify:true,message:`Write sent; Pluto returned stale ${raw?.comhead||"response"}. Verify on refresh.`,raw};
      }
    }catch(err){
      runtime.hardware.pluto.lastError=err.name==="AbortError"?`Timeout after ${PLUTO_TIMEOUT_MS} ms`:err.message;
      if(!req.readOnly||n===attempts-1)throw err;
    }
  }
  throw new Error(`Pluto kept returning stale responses. Last: ${last?.comhead||"unknown"}`);
}

async function runLightingCommand(command){
  const p=command.payload||{},type=command.type;
  if(type==="lighting.on")return directGoveeCommand(command.target,"on",p);
  if(type==="lighting.off")return directGoveeCommand(command.target,"off",p);
  if(type==="lighting.brightness")return directGoveeCommand(command.target,"brightness",p);
  if(type==="lighting.color")return directGoveeCommand(command.target,"color",p);
  if(type==="lighting.temp")return directGoveeCommand(command.target,"temp",p);
  if(type==="lighting.scene")return directGoveeCommand(command.target,"scene",p);
  throw new Error(`Unsupported lighting command: ${type}`);
}

async function runAvCommand(command){
  const p=command.payload||{};
  if(command.type==="av.route")return directPluto({action:"route",output:Number(p.output??devices[cleanId(command.target)]?.avOutput),input:Number(p.input)});
  if(command.type==="av.cecOutput")return directPluto({action:"cecOutput",output:Number(p.output??devices[cleanId(command.target)]?.avOutput),connection:p.connection==="hdbt"?"hdbt":"hdmi",index:Number(p.index)});
  if(command.type==="av.cecAllOutputs")return directPluto({action:"cecAllOutputs",index:Number(p.index)});
  if(command.type==="av.cecAllHdmi")return directPluto({action:"cecAllHdmi",index:Number(p.index)});
  if(command.type==="av.cecAllHdbt")return directPluto({action:"cecAllHdbt",index:Number(p.index)});
  throw new Error(`Unsupported AV command: ${command.type}`);
}

// -----------------------------------------------------------------------------
// WebSocket transport
// -----------------------------------------------------------------------------

const wsClients = new Set();

function wsSend(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcastControllers(message) {
  for (const ws of wsClients) {
    if (ws.role === "controller" || ws.role === "admin") {
      if(dbStore.authEnabled()){
        const user=ws.sessionToken?dbStore.sessionUser(ws.sessionToken):null;
        if(!user){try{ws.close(1008,"Session expired or revoked")}catch{};continue}
        const type=String(message?.type||"");
        const sensitive=type.startsWith("lab.history")||type.startsWith("lab.screenshot")||type.startsWith("lab.ai.alert");
        if(sensitive&&!hasCapability(user,"lab.sensitive.read"))continue;
      }
      wsSend(ws, message);
    }
  }
}

function broadcastDisplays(targets, message) {
  // Physical display receivers only. Preview sockets are observers and must never count
  // as delivery to a classroom display.
  const wanted = new Set(targets), delivered = new Set();
  for (const ws of wsClients) {
    if (ws.role === "display" && wanted.has(ws.deviceId) && ws.readyState === WebSocket.OPEN) {
      wsSend(ws, message);delivered.add(ws.deviceId);
    }
  }
  return [...delivered];
}
function broadcastDisplayPreviews(targets, message) {
  const wanted = new Set(targets);
  for (const ws of wsClients) {
    if (ws.role === "preview" && wanted.has(ws.deviceId) && ws.readyState === WebSocket.OPEN) wsSend(ws, message);
  }
}

function markDisplaySeen(ws, extra = {}) {
  if (!ws.deviceId || !devices[ws.deviceId]) return;

  const previous = runtime.displays[ws.deviceId] || {};
  const mergedMeta = extra.meta && typeof extra.meta === "object"
    ? { ...(previous.meta || {}), ...extra.meta }
    : previous.meta;

  runtime.displays[ws.deviceId] = {
    ...previous,
    lastSeen: new Date().toISOString(),
    source: "websocket",
    connectionId: ws.connectionId,
    disconnectedAt: null,
    ...extra,
    ...(mergedMeta ? { meta: mergedMeta } : {})
  };

  broadcastControllers({
    type: "device.status",
    deviceId: ws.deviceId,
    status: publicDisplayStatus(ws.deviceId)
  });
}

// -----------------------------------------------------------------------------
// Core command router
// -----------------------------------------------------------------------------

async function executeCommand(input, source = "api") {
  const commandStart=Date.now();
  try {
  const command = normalizeCommand(input, source);
  const result = {
    ok: true,
    command,
    deliveries: {
      websocket: [],
      mqttJson: [],
      mqttLegacy: [],
      hardware: null
    },
    warnings: []
  };

  const isDisplayCommand =
    command.type.startsWith("display.") ||
    command.type.startsWith("voice.") ||
    command.type.startsWith("sfx.") ||
    command.type.startsWith("music.assistant.") ||
    command.type === "legacy.raw";

  if (isDisplayCommand) {
    const targets = resolveDisplayTargets(command.target);
    if (!targets.length) {
      throw new Error(`No display targets resolved from ${JSON.stringify(command.target)}`);
    }

    updateStateFromCommand(command, targets);

    const physicalDeliveries=broadcastDisplays(targets, {type:"command",command});
    // Keep dashboard previews visually synchronized, but do not treat them as target
    // receivers and never let the preview selection influence command routing.
    broadcastDisplayPreviews(targets,{type:"command",command});
    result.deliveries.websocket = physicalDeliveries;
    const missingPhysical=targets.filter(id=>!physicalDeliveries.includes(id));
    if(missingPhysical.length)result.warnings.push(`No live physical display WebSocket for: ${missingPhysical.join(', ')}`);

    if (MQTT_JSON_BRIDGE && runtime.mqtt.connected) {
      for (const id of targets) {
        const topic = `classroom/v2/display/${id}/command`;
        await mqttPublish(topic, command);
        result.deliveries.mqttJson.push(topic);
      }
    } else if (MQTT_JSON_BRIDGE) {
      result.warnings.push("MQTT JSON bridge enabled but MQTT is not connected");
    }

    const legacy = toLegacyCommand(command);
    if (MQTT_LEGACY_BRIDGE && legacy) {
      if (runtime.mqtt.connected) {
        const rawTarget = cleanId(command.target);

        if (rawTarget === "all") {
          await mqttPublish("classroom/all", legacy);
          result.deliveries.mqttLegacy.push("classroom/all");
        } else {
          for (const id of targets) {
            const topic = devices[id]?.legacyTopic || `classroom/${id}`;
            await mqttPublish(topic, legacy);
            result.deliveries.mqttLegacy.push(topic);
          }
        }
      } else {
        result.warnings.push("Legacy MQTT bridge enabled but MQTT is not connected");
      }
    } else if (MQTT_LEGACY_BRIDGE && !legacy) {
      result.warnings.push(
        `No legacy receiver translation exists for ${command.type}; modern WebSocket/JSON receivers still receive it`
      );
    }
  } else if (command.type.startsWith("lighting.")) {
    result.deliveries.hardware = await runLightingCommand(command);
  } else if (command.type.startsWith("av.")) {
    result.deliveries.hardware = await runAvCommand(command);
  } else if (command.type === "system.ping") {
    // no-op; useful for API diagnostics
  } else {
    throw new Error(`Unsupported command type: ${command.type}`);
  }

  backgroundMusicObserveDisplayCommand(command, source);

  audit({
    kind: "command",
    source: command.source,
    commandId: command.id,
    commandType: command.type,
    target: command.target,
    deliveries: result.deliveries,
    warnings: result.warnings
  });

  broadcastControllers({
    type: "command.executed",
    command,
    deliveries: result.deliveries,
    warnings: result.warnings
  });

  return result;
  } catch(err) {
    diagnosticError(err,{component:"command",operation:String(input?.type||"unknown"),data:{source,target:input?.target}});
    throw err;
  }
}

// -----------------------------------------------------------------------------
// HTTP API
// -----------------------------------------------------------------------------

const app = express();
let shuttingDown=false;
app.disable("x-powered-by");
app.set("trust proxy", TRUST_PROXY_HOPS);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// alpha.15 browser/API hardening. Keep the application compatible with the
// Cloudflare Tunnel deployment while protecting authenticated browser sessions.
app.use((req,res,next)=>{
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Referrer-Policy","same-origin");
  res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy","same-origin");
  // Keep controller execution self-contained. External/injected scripts (including browser
  // extensions which attempt page-level injection) are intentionally blocked.
  const mainController=["/controller","/controller/","/controller/index.html"].includes(req.path);
  const scriptPolicy=mainController?"script-src 'self'; script-src-elem 'self'; script-src-attr 'unsafe-inline'":"script-src 'self' 'unsafe-inline'; script-src-elem 'self' 'unsafe-inline'; script-src-attr 'unsafe-inline'";
  res.setHeader("Content-Security-Policy",`default-src 'self' data: blob:; base-uri 'self'; object-src 'none'; img-src 'self' data: blob: http: https:; media-src 'self' data: blob: http: https:; style-src 'self' 'unsafe-inline'; ${scriptPolicy}; connect-src 'self' http: https: ws: wss:; frame-src 'self' http: https:; frame-ancestors 'self'`);
  const proto=String(req.get("x-forwarded-proto")||"").toLowerCase();
  if(req.secure||proto==="https")res.setHeader("Strict-Transport-Security","max-age=15552000; includeSubDomains");
  next();
});

function effectiveHost(req){
  // Caddy preserves the original Host header. Do not trust X-Forwarded-Host:
  // port 3000 may also be reachable directly on older installations.
  const raw=String(req.get?.("host")||req.headers?.host||"").trim().toLowerCase();
  if(!raw||raw.length>255||/[\s\\/'"`;(){}]/.test(raw))return "";
  try{
    const parsed=new URL(`http://${raw}`);
    return parsed.host.toLowerCase()===raw?parsed.host.toLowerCase():"";
  }catch{return ""}
}
function powerShellLiteral(value){return `'${String(value??"").replace(/'/g,"''")}'`}
function clientAddress(req){return String(req.ip||req.socket?.remoteAddress||"")}
function browserWebSocketOriginAllowed(req){
  const origin=String(req.headers?.origin||"").trim();
  if(!origin)return false;
  try{const u=new URL(origin);return u.host.toLowerCase()===effectiveHost(req)||CORS_ALLOWED_ORIGINS.has(origin)}catch{return false}
}
app.use((req,res,next)=>{
  if(!dbStore.authEnabled()||!["POST","PUT","PATCH","DELETE"].includes(req.method))return next();
  if(!cookieValue(req,"classroom_hub_session"))return next();
  const origin=String(req.get("origin")||"").trim();
  if(!origin)return next(); // CLI/native clients do not normally send Origin.
  try{const u=new URL(origin);if(u.host.toLowerCase()!==effectiveHost(req)){audit({kind:"security.csrf.blocked",method:req.method,path:req.path,origin,host:effectiveHost(req),remote:clientAddress(req)});return res.status(403).json({ok:false,error:"Cross-site request blocked"})}}
  catch{ return res.status(403).json({ok:false,error:"Invalid request origin"}) }
  next();
});

const loginAttempts=new Map();
const LOGIN_ATTEMPT_CACHE_MAX=10000;
const LOGIN_DUMMY_SALT=crypto.randomBytes(16);
const LOGIN_DUMMY_HASH=crypto.scryptSync(crypto.randomBytes(32),LOGIN_DUMMY_SALT,64,{N:16384,r:8,p:1});
function pruneLoginAttempts(now=Date.now()){
  for(const [key,state] of loginAttempts){if(now-Math.max(Number(state.firstAt||0),Number(state.lockedUntil||0))>Math.max(LOGIN_WINDOW_MS,LOGIN_LOCK_MS))loginAttempts.delete(key)}
  while(loginAttempts.size>LOGIN_ATTEMPT_CACHE_MAX)loginAttempts.delete(loginAttempts.keys().next().value);
}
function loginAttemptKey(req,username){return `${clientAddress(req).slice(0,128)}|${String(username||"").trim().toLowerCase().slice(0,80)}`}
function loginAddressKey(req){return `${clientAddress(req).slice(0,128)}|*`}
function loginAttemptState(key){const now=Date.now(),s=loginAttempts.get(key);if(!s)return {count:0,firstAt:now,lockedUntil:0};if(s.lockedUntil>now)return s;if(now-s.firstAt>LOGIN_WINDOW_MS){loginAttempts.delete(key);return {count:0,firstAt:now,lockedUntil:0}}return s}
function recordLoginFailure(key){const now=Date.now(),s=loginAttemptState(key);s.count+=1;if(s.count>=LOGIN_MAX_ATTEMPTS)s.lockedUntil=now+LOGIN_LOCK_MS;loginAttempts.delete(key);loginAttempts.set(key,s);pruneLoginAttempts(now);return s}
function clearLoginFailures(key){loginAttempts.delete(key)}
const loginAttemptCleanupTimer=setInterval(()=>pruneLoginAttempts(),Math.max(60000,Math.min(LOGIN_WINDOW_MS,LOGIN_LOCK_MS)));loginAttemptCleanupTimer.unref();

async function verifyUserAsync(username,password){
  const row=dbStore.db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND enabled=1").get(String(username||"").trim());
  const salt=row?Buffer.from(row.password_salt,"hex"):LOGIN_DUMMY_SALT;
  const derived=await scryptAsync(String(password??""),salt,64,{N:16384,r:8,p:1});
  const expected=row?Buffer.from(row.password_hash,"hex"):LOGIN_DUMMY_HASH,actual=Buffer.from(derived);
  if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;
  if(!row)return null;
  return {id:row.id,username:row.username,displayName:row.display_name,role:row.role,profileId:row.profile_id,enabled:!!row.enabled};
}

// Diagnostic API access log. Bodies are never persisted here, so credentials,
// uploaded data and control secrets are not captured.
app.use((req,res,next)=>{
  const started=Date.now();
  res.on("finish",()=>{
    if(!req.path.startsWith("/api/"))return;
    const isFramebuffer=req.path.includes("/api/v1/veyon/computers/")&&req.path.endsWith("/framebuffer");
    const transientFramebuffer=isFramebuffer&&[409,429,502,503,504].includes(res.statusCode);
    const event={
      kind:transientFramebuffer?"veyon.framebuffer.unavailable":(res.statusCode>=400?"api.error":"api.request"),
      severity:transientFramebuffer?"warning":(res.statusCode>=400?"error":"info"),
      method:req.method,
      path:req.path,
      status:res.statusCode,
      durationMs:Date.now()-started,
      remote:clientAddress(req)||null,
      ok:res.statusCode<400,
      transient:transientFramebuffer
    };
    audit(event);
  });
  next();
});



// Classroom Control Hub 1.0 maintenance proxy. The browser never talks to the
// privileged maintenance agent directly; all requests remain behind the
// existing Classroom Control Hub control authorization boundary.
//
// These internal endpoints run in the opposite direction. They keep the main
// application as the only process that owns and writes the SQLite database.
// They are deliberately limited to agent health, audit retention and managed
// integration deployment state.
function integrationSecretSetting(key){return /password|token|secret|api.?key|credential/i.test(String(key||""))}
function integrationSecretName(id,key){return `integration.${id}.${key}`}
function managedIntegrationsView({resolved=false}={}){
  const value=dbStore.getManagedIntegrations();
  for(const [id,cfg] of Object.entries(value.modules||{}))for(const key of Object.keys(cfg||{})){
    if(!integrationSecretSetting(key))continue;
    const present=dbStore.hasSecret(integrationSecretName(id,key));
    cfg[key]=resolved?(present?(dbStore.getSecret(integrationSecretName(id,key))||""):""):(present?"••••••••":"");
  }
  return value;
}
app.get("/api/v1/internal/maintenance/status",requireMaintenanceAgent,(_req,res)=>{
  const total=dbStore.db.prepare("SELECT COUNT(*) c FROM audit_events").get().c;
  const first=dbStore.db.prepare("SELECT at FROM audit_events ORDER BY at ASC LIMIT 1").get()?.at||null;
  const last=dbStore.db.prepare("SELECT at FROM audit_events ORDER BY at DESC LIMIT 1").get()?.at||null;
  res.json({ok:true,database:dbStore.databaseInfo(),audit:{total,first,last}});
});
app.post("/api/v1/internal/maintenance/audit/prune",requireMaintenanceAgent,(req,res)=>{
  if(req.body?.confirm!==true)return res.status(400).json({ok:false,error:"Confirmation required"});
  const days=Math.max(7,Math.min(3650,Number(req.body?.days||180))),cutoff=new Date(Date.now()-days*86400000).toISOString();
  const before=dbStore.db.prepare("SELECT COUNT(*) c FROM audit_events").get().c;
  const info=dbStore.db.prepare("DELETE FROM audit_events WHERE at < ?").run(cutoff);
  dbStore.db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  const after=dbStore.db.prepare("SELECT COUNT(*) c FROM audit_events").get().c;
  audit({kind:"audit.retention.prune",days,cutoff,removed:info.changes});
  res.json({ok:true,days,cutoff,removed:info.changes,before,after});
});
app.get("/api/v1/internal/maintenance/integrations",requireMaintenanceAgent,(req,res)=>{
  res.json({ok:true,integrations:managedIntegrationsView({resolved:String(req.query.resolved||"")==="1"})});
});
app.put("/api/v1/internal/maintenance/integrations/:id",requireMaintenanceAgent,(req,res)=>{
  try{
    const id=String(req.params.id||"").trim();if(!/^[a-z0-9_-]{1,80}$/i.test(id))throw Error("Invalid integration id");
    const value=dbStore.getManagedIntegrations(),prior={...(value.modules?.[id]||{})};
    for(const [key,input] of Object.entries(req.body?.settings||{})){
      if(!/^[A-Za-z0-9_.-]{1,100}$/.test(key)||input==="••••••••")continue;
      if(integrationSecretSetting(key)){
        if(input!==undefined&&input!==null&&String(input)!==""){dbStore.putSecret(integrationSecretName(id,key),String(input),{type:"integration-setting",integration:id,key});prior[key]="__encrypted__"}
      }else prior[key]=input;
    }
    value.modules=value.modules||{};value.modules[id]=prior;dbStore.putManagedIntegrations(value);
    audit({kind:"admin.integration.configure",integration:id,keys:Object.keys(req.body?.settings||{}).filter(key=>!integrationSecretSetting(key))});
    res.json({ok:true,id,config:managedIntegrationsView().modules[id]||{},resolved:managedIntegrationsView({resolved:true}).modules[id]||{}});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

const TRUSTED_UPDATE_REPOSITORY="wagnerks1990/classroom-control-hub";
function updatePolicy(){
  const saved=dbStore.getPreference("updates.policy",{})||{};
  return {repository:TRUSTED_UPDATE_REPOSITORY,channel:["alpha","beta","stable"].includes(saved.channel)?saved.channel:"alpha",automatic:!!saved.automatic,checkIntervalHours:Math.max(1,Math.min(168,Number(saved.checkIntervalHours)||24)),maintenanceStart:validTime(saved.maintenanceStart)?saved.maintenanceStart:"02:00",maintenanceEnd:validTime(saved.maintenanceEnd)?saved.maintenanceEnd:"04:00",lastCheckedAt:saved.lastCheckedAt||null,lastAvailable:saved.lastAvailable||null};
}
function validUpdateRepository(value){return String(value||"")===TRUSTED_UPDATE_REPOSITORY}
function releaseVersion(tag){return String(tag||"").replace(/^v/,"")}
function semverParts(value){const m=releaseVersion(value).match(/^(\d+)\.(\d+)\.(\d+)(?:[-.]([0-9A-Za-z.-]+))?$/);return m?{core:m.slice(1,4).map(Number),pre:m[4]?m[4].split("."):[]}:null}
function compareVersions(a,b){const x=semverParts(a),y=semverParts(b);if(!x||!y)return 0;for(let i=0;i<3;i++)if(x.core[i]!==y.core[i])return x.core[i]-y.core[i];if(!x.pre.length||!y.pre.length)return x.pre.length?-1:y.pre.length?1:0;for(let i=0;i<Math.max(x.pre.length,y.pre.length);i++){if(x.pre[i]===undefined)return -1;if(y.pre[i]===undefined)return 1;const xn=Number(x.pre[i]),yn=Number(y.pre[i]),numeric=Number.isFinite(xn)&&Number.isFinite(yn);if(x.pre[i]!==y.pre[i])return numeric?xn-yn:String(x.pre[i]).localeCompare(String(y.pre[i]))}return 0}
function releaseAllowed(release,channel){if(release?.draft)return false;if(channel==="stable")return !release.prerelease;const tag=String(release.tag_name||"").toLowerCase();return release.prerelease&&(channel==="alpha"?tag.includes("alpha"):tag.includes("beta"))}
async function githubReleaseCheck({persist=true}={}){
  const policy=updatePolicy();if(!validUpdateRepository(policy.repository))throw Error("Update repository must use owner/name format");
  const token=String(dbStore.getSecret("github.update.token")||""),headers={accept:"application/vnd.github+json","user-agent":"classroom-control-hub-updater","x-github-api-version":"2022-11-28"};if(token)headers.authorization=`Bearer ${token}`;
  const response=await fetch(`https://api.github.com/repos/${policy.repository.split("/").map(encodeURIComponent).join("/")}/releases?per_page=30`,{headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`GitHub release check failed (${response.status})`);
  const releases=await response.json(),eligible=(Array.isArray(releases)?releases:[]).filter(x=>releaseAllowed(x,policy.channel)&&semverParts(x.tag_name)).sort((a,b)=>compareVersions(b.tag_name,a.tag_name));
  const latest=eligible[0]||null,available=latest&&compareVersions(latest.tag_name,APPLICATION_VERSION)>0?{tag:latest.tag_name,version:releaseVersion(latest.tag_name),name:latest.name||latest.tag_name,publishedAt:latest.published_at||null,url:latest.html_url||null,prerelease:!!latest.prerelease}:null;
  const checkedAt=new Date().toISOString(),result={ok:true,currentVersion:APPLICATION_VERSION,repository:policy.repository,channel:policy.channel,checkedAt,available,latest:latest?{tag:latest.tag_name,version:releaseVersion(latest.tag_name),name:latest.name||latest.tag_name,publishedAt:latest.published_at||null,url:latest.html_url||null}:null};
  if(persist)dbStore.setPreference("updates.policy",{...policy,lastCheckedAt:checkedAt,lastAvailable:available});return result;
}
async function maintenanceAgentApi(method,pathName,body=null,timeoutMs=30000){
  if(!MAINTENANCE_TOKEN)throw Error("Maintenance agent is not configured");const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{const response=await fetch(MAINTENANCE_URL+pathName,{method,headers:{"x-maintenance-token":MAINTENANCE_TOKEN,...(body==null?{}:{"content-type":"application/json"})},body:body==null?undefined:JSON.stringify(body),signal:controller.signal});const text=await response.text();let value;try{value=JSON.parse(text||"{}")}catch{value={error:text}}if(!response.ok)throw Error(value.error||`Maintenance agent HTTP ${response.status}`);return value}finally{clearTimeout(timer)}
}
function recordUpdateJob(job){if(!job?.phase)return;const history=dbStore.getPreference("updates.history",[])||[],key=[job.updatedAt,job.phase,job.targetCommit].join(":");if(history.some(x=>x.key===key))return;history.unshift({key,at:job.updatedAt||new Date().toISOString(),phase:job.phase,ok:job.ok??null,message:job.message||"",action:job.action||"",targetRef:job.targetRef||"",previousVersion:job.previousVersion||"",activeVersion:job.activeVersion||"",backupName:job.backupName||"",rollback:job.rollback??false});dbStore.setPreference("updates.history",history.slice(0,100))}
app.get("/api/v1/admin/app-updates/settings",requireAdmin,(_req,res)=>res.json({ok:true,settings:updatePolicy(),tokenConfigured:dbStore.hasSecret("github.update.token"),currentVersion:APPLICATION_VERSION,history:dbStore.getPreference("updates.history",[])||[]}));
app.put("/api/v1/admin/app-updates/settings",requireAdmin,(req,res)=>{try{const current=updatePolicy(),repository=String(req.body?.repository||current.repository).trim(),channel=String(req.body?.channel||current.channel);if(!validUpdateRepository(repository))throw Error(`Updates are restricted to the trusted repository ${TRUSTED_UPDATE_REPOSITORY}`);if(!["alpha","beta","stable"].includes(channel))throw Error("Invalid release channel");const next={...current,repository:TRUSTED_UPDATE_REPOSITORY,channel,automatic:req.body?.automatic===true,checkIntervalHours:Math.max(1,Math.min(168,Number(req.body?.checkIntervalHours)||24)),maintenanceStart:String(req.body?.maintenanceStart||current.maintenanceStart),maintenanceEnd:String(req.body?.maintenanceEnd||current.maintenanceEnd)};if(!validTime(next.maintenanceStart)||!validTime(next.maintenanceEnd))throw Error("Maintenance window times must use valid HH:MM values");dbStore.setPreference("updates.policy",next);if(req.body?.clearToken===true)dbStore.deleteSecret("github.update.token");else if(req.body?.token)dbStore.putSecret("github.update.token",String(req.body.token),{type:"github-release-read-token",repository:TRUSTED_UPDATE_REPOSITORY});audit({kind:"admin.updates.settings",repository:TRUSTED_UPDATE_REPOSITORY,channel,automatic:next.automatic,tokenCleared:req.body?.clearToken===true});res.json({ok:true,settings:updatePolicy(),tokenConfigured:dbStore.hasSecret("github.update.token")})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post("/api/v1/admin/app-updates/check",requireAdmin,async(_req,res)=>{try{res.json(await githubReleaseCheck())}catch(e){res.status(502).json({ok:false,error:e.message})}});
app.get("/api/v1/admin/app-updates/job",requireAdmin,async(_req,res)=>{try{const job=await maintenanceAgentApi("GET","/app-updates/job",null,30000);recordUpdateJob(job);res.json({...job,history:dbStore.getPreference("updates.history",[])||[]})}catch(e){res.status(502).json({ok:false,error:e.message})}});
app.post("/api/v1/admin/app-updates/install",requireAdmin,async(req,res)=>{try{const check=await githubReleaseCheck();if(!check.available||check.available.tag!==String(req.body?.tag||""))return res.status(409).json({ok:false,error:"Selected release is no longer the current approved update"});const result=await maintenanceAgentApi("POST","/app-updates/start",{targetRef:check.available.tag,expectedVersion:check.available.version,githubToken:String(dbStore.getSecret("github.update.token")||""),confirm:"INSTALL_RELEASE"},30000);audit({kind:"admin.updates.start",tag:check.available.tag,version:check.available.version});res.status(202).json(result)}catch(e){res.status(502).json({ok:false,error:e.message})}});
app.post("/api/v1/admin/app-updates/revert",requireAdmin,async(req,res)=>{try{if(String(req.body?.confirm||"")!=="REVERT_RELEASE")return res.status(400).json({ok:false,error:"Explicit REVERT_RELEASE confirmation required"});const result=await maintenanceAgentApi("POST","/app-updates/revert",{confirm:"REVERT_RELEASE"},30000);audit({kind:"admin.updates.revert"});res.status(202).json(result)}catch(e){res.status(502).json({ok:false,error:e.message})}});

function withinUpdateWindow(policy,date=new Date()){const minutes=s=>{const [h,m]=s.split(":").map(Number);return h*60+m},now=date.getHours()*60+date.getMinutes(),start=minutes(policy.maintenanceStart),end=minutes(policy.maintenanceEnd);return start===end||start<end?(now>=start&&now<end):(now>=start||now<end)}
async function automaticUpdateTick(){const policy=updatePolicy();if(!policy.automatic||!withinUpdateWindow(policy))return;const last=policy.lastCheckedAt?Date.parse(policy.lastCheckedAt):0;if(Date.now()-last<policy.checkIntervalHours*3600000)return;try{const job=await maintenanceAgentApi("GET","/app-updates/job");if(job.running)return;const check=await githubReleaseCheck();if(check.available){await maintenanceAgentApi("POST","/app-updates/start",{targetRef:check.available.tag,expectedVersion:check.available.version,githubToken:String(dbStore.getSecret("github.update.token")||""),confirm:"INSTALL_RELEASE"},30000);audit({kind:"updates.automatic.start",tag:check.available.tag})}}catch(e){audit({kind:"updates.automatic.error",error:e.message})}}
const automaticUpdateTimer=setInterval(()=>automaticUpdateTick(),15*60*1000);automaticUpdateTimer.unref();setTimeout(()=>automaticUpdateTick(),60*1000).unref();
async function synchronizeUpdateJob(){try{recordUpdateJob(await maintenanceAgentApi("GET","/app-updates/job"))}catch{}}
const updateJobSyncTimer=setInterval(()=>synchronizeUpdateJob(),60*1000);updateJobSyncTimer.unref();setTimeout(()=>synchronizeUpdateJob(),15*1000).unref();
app.use("/api/v1/maintenance", requireAdmin, (req,res)=>{
  if(!MAINTENANCE_PROXY_ENABLED)return res.status(503).json({ok:false,error:"Privileged maintenance proxy is disabled during stabilization"});
  if(!MAINTENANCE_TOKEN)return res.status(503).json({ok:false,error:"Maintenance agent is not configured"});
  let target;
  try{target=new URL(MAINTENANCE_URL + req.originalUrl.replace(/^\/api\/v1\/maintenance/,""))}
  catch(err){return res.status(500).json({ok:false,error:`Invalid maintenance URL: ${err.message}`})}
  const headers={...req.headers,host:target.host,"x-maintenance-token":MAINTENANCE_TOKEN};
  delete headers["content-length"];
  delete headers["x-control-token"];
  let buffered=null;
  const contentType=String(req.headers["content-type"]||"");
  if((contentType.includes("application/json")||contentType.includes("application/x-www-form-urlencoded")) && req.body && Object.keys(req.body).length){
    buffered=Buffer.from(contentType.includes("application/json")?JSON.stringify(req.body):new URLSearchParams(req.body).toString());
    headers["content-length"]=String(buffered.length);
  }
  const upstream=http.request({protocol:target.protocol,hostname:target.hostname,port:target.port||80,path:target.pathname+target.search,method:req.method,headers},up=>{
    res.status(up.statusCode||502);
    for(const [k,v] of Object.entries(up.headers))if(v!==undefined&&!['connection','transfer-encoding'].includes(k.toLowerCase()))res.setHeader(k,v);
    up.pipe(res);
  });
  upstream.on("error",err=>res.status(502).json({ok:false,error:`Maintenance agent unavailable: ${err.message}`}));
  if(buffered){upstream.end(buffered)}else{req.pipe(upstream)}
});

// Closed-lab HTTP application. No HSTS/TLS assumptions.
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const origin=String(req.get("origin")||"");
  if(origin&&CORS_ALLOWED_ORIGINS.has(origin)){
    res.setHeader("Access-Control-Allow-Origin",origin);
    res.setHeader("Vary","Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Control-Token, X-Display-Token, X-Setup-Token"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if(req.method==="OPTIONS"&&origin&&!CORS_ALLOWED_ORIGINS.has(origin))return res.status(403).json({ok:false,error:"Cross-origin request blocked"});
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

function persistentAssetAccessKey(){
  try{
    let encoded=String(dbStore.getSecret("internal.asset-access-key")||"");
    if(!/^[A-Za-z0-9_-]{43}$/.test(encoded)){encoded=crypto.randomBytes(32).toString("base64url");dbStore.putSecret("internal.asset-access-key",encoded,{type:"internal-signing-key"})}
    return Buffer.from(encoded,"base64url");
  }catch(error){diagnosticError(error,{component:"asset-access",operation:"key-load"});return crypto.randomBytes(32)}
}
const assetAccessKey=persistentAssetAccessKey();
function issueAssetAccessToken(deviceId,credentialId="",ttlSeconds=900){const expires=Math.floor(Date.now()/1000)+ttlSeconds,credential=String(credentialId||"legacy").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,80)||"legacy",payload=`${cleanId(deviceId)}.${expires}.${credential}`,signature=crypto.createHmac("sha256",assetAccessKey).update(payload).digest("base64url");return `${payload}.${signature}`}
function validAssetAccessToken(token){const parts=String(token||"").split(".");if(parts.length!==4||!/^\d+$/.test(parts[1])||Number(parts[1])<Math.floor(Date.now()/1000))return false;const payload=`${parts[0]}.${parts[1]}.${parts[2]}`,expected=crypto.createHmac("sha256",assetAccessKey).update(payload).digest("base64url");if(!secureTokenEqual(parts[3],expected)||!devices[cleanId(parts[0])]?.enabled)return false;const policy=dbStore.displayCredentialPolicy();if(parts[2]==="direct")return !policy.authenticationRequired;if(parts[2]==="legacy")return policy.legacySharedTokenAllowed;return dbStore.listDisplayCredentials().credentials.some(item=>item.id===parts[2]&&item.displayId===parts[0]&&!item.revokedAt)}
function requireAssetAccess(req,res,next){if(requestUser(req)||validAssetAccessToken(req.query.access_token))return next();return res.status(401).json({ok:false,error:"Authenticated or enrolled-display asset access required"})}
app.use("/media",requireAssetAccess,(req,res,next)=>path.extname(req.path).toLowerCase()===".svg"?res.status(415).json({ok:false,error:"Active SVG media is not served from the application origin"}):next(),express.static(MEDIA_DIR,{fallthrough:false}));
app.use("/presentations",requireAssetAccess,express.static(PRESENTATIONS_DIR,{fallthrough:false}));
app.use("/vendor/pdfjs", express.static(path.join(path.resolve(__dirname,".."),"node_modules","pdfjs-dist","build")));
app.use("/vendor/hls", express.static(path.join(path.resolve(__dirname,".."),"node_modules","hls.js","dist")));

app.use(express.static(path.join(APP_DIR, "public")));

const BRAND_THEME_DEFAULTS={mode:"dark",primary:"#2aa866",accent:"#1b7a49",background:"#040705",surface:"#121923",text:"#eef4f8"};
function shortBrandText(value,fallback,max=120){const text=String(value??fallback??"").trim();return (text||String(fallback||"")).slice(0,max)}
function brandColor(value,fallback){const text=String(value||"").trim();if(text&&!/^#[0-9a-f]{6}$/i.test(text))throw Error("Theme colors must use six-digit hexadecimal values");return text||fallback}
function brandAssetUrl(value){const text=String(value||"").trim();if(!text)return "";if(text.length>2048)throw Error("Brand asset URL is too long");if(text.startsWith("/")&&!text.startsWith("//"))return text;let parsed;try{parsed=new URL(text)}catch{throw Error("Brand asset URL must be an HTTPS, HTTP, or site-relative URL")}if(!["https:","http:"].includes(parsed.protocol))throw Error("Brand asset URL must be an HTTPS, HTTP, or site-relative URL");return parsed.href}
function normalizedSiteProfile(input={}){
  const school=shortBrandText(input.school,"Your School");
  const room=shortBrandText(input.room,"Classroom",80);
  const mode=["dark","light","system"].includes(input.theme?.mode)?input.theme.mode:"dark";
  return {school,room,productName:shortBrandText(input.productName,"Classroom Control Hub"),logoUrl:brandAssetUrl(input.logoUrl),faviconUrl:brandAssetUrl(input.faviconUrl),displayPrefix:shortBrandText(input.displayPrefix,"TV",40),timezone:normalizedTimezone(input.timezone||"America/New_York"),theme:{mode,primary:brandColor(input.theme?.primary,BRAND_THEME_DEFAULTS.primary),accent:brandColor(input.theme?.accent,BRAND_THEME_DEFAULTS.accent),background:brandColor(input.theme?.background,BRAND_THEME_DEFAULTS.background),surface:brandColor(input.theme?.surface,BRAND_THEME_DEFAULTS.surface),text:brandColor(input.theme?.text,BRAND_THEME_DEFAULTS.text)},revision:Math.max(0,Number(input.revision)||0),updatedAt:input.updatedAt||null};
}
function publicBranding(){const site=normalizedSiteProfile(dbStore.getAdminConfig().site||{});return {ok:true,branding:site}}

app.get("/api/v1/branding",(_req,res)=>{res.setHeader("Cache-Control","no-store");res.json(publicBranding())});

app.get("/controller", (_req, res) => {
  res.sendFile(path.join(APP_DIR, "public", "controller", "index.html"));
});
app.get("/controller/", (_req, res) => {
  res.sendFile(path.join(APP_DIR, "public", "controller", "index.html"));
});
app.get("/schoology", (_req,res)=>res.sendFile(path.join(APP_DIR,"public","schoology","index.html")));
app.get("/schoology/", (_req,res)=>res.sendFile(path.join(APP_DIR,"public","schoology","index.html")));
app.get("/display/:id", (req, res) => {
  res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma","no-cache");
  res.setHeader("Expires","0");
  const id = cleanId(req.params.id);
  if (!devices[id]) {
    return res.status(404).type("text/plain").send("Unknown display");
  }
  res.sendFile(path.join(APP_DIR, "public", "display", "index.html"));
});

app.get("/", (_req, res) => {
  const brand=publicBranding().branding;
  res.type("text/plain").send(
    [
      `${brand.productName} Backend`,
      `School: ${brand.school}`,
      `Classroom: ${brand.room}`,
      `API: http://HOST:${PORT}/api/v1/status`,
      `WebSocket: ws://HOST:${PORT}/ws`,
      `Media: http://HOST:${PORT}/media/`
    ].join("\n")
  );
});

app.get("/health", (_req, res) => {
  const database=dbStore.healthCheck();
  const invalidClasses=classScheduleStore.classes.filter(item=>!validTime(item.startTime)||!validTime(item.endTime)||timeToMinutes(item.startTime)>=timeToMinutes(item.endTime)).map(item=>item.id);
  const invalidAutomations=classroomAutomations.events.filter(item=>!validTime(item.time)||!AUTOMATION_ACTIONS.has(item.action)||(item.actions||[]).some(step=>!AUTOMATION_ACTIONS.has(step.action))).map(item=>item.id);
  const scheduler={ok:invalidClasses.length===0&&invalidAutomations.length===0,timezone:SCHEDULER_TIMEZONE,invalidClasses,invalidAutomations};
  const ready=!shuttingDown&&database.ok&&scheduler.ok;
  res.status(ready?200:503).json({
    ok: ready,
    ready,
    service: "classroom-hub-backend",
    version: APPLICATION_VERSION,
    checks:{database:{ok:database.ok},scheduler:{ok:scheduler.ok}}
  });
});

app.get("/api/v1/status",requireClassroomRead, (_req, res) => {
  res.json({
    ok: true,
    runtime: publicRuntime(),
    state: persistentState
  });
});
app.get("/api/v1/lab-agent/manifest",(_req,res)=>{
  const file=path.join(PUBLIC_DIR,"lab-agent","ClassroomHubAgent.ps1");
  try{res.json({ok:true,version:APPLICATION_VERSION,file:"ClassroomHubAgent.ps1",sha256:crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")})}
  catch(error){res.status(500).json({ok:false,error:"Lab agent package is unavailable"})}
});

app.get("/api/v1/devices",requireClassroomRead, (_req, res) => {
  res.json({
    ok: true,
    room: deviceConfig.room || ROOM_NAME,
    devices,
    status: publicRuntime().displays
  });
});

app.get("/api/v1/devices/:id",requireClassroomRead, (req, res) => {
  const id = cleanId(req.params.id);
  if (!devices[id]) {
    return res.status(404).json({ ok: false, error: "Unknown device" });
  }

  res.json({
    ok: true,
    id,
    config: devices[id],
    state: persistentState.displays[id] || null,
    status: publicRuntime().displays[id] || null
  });
});

app.get("/api/v1/groups",requireClassroomRead, (_req, res) => {
  res.json({
    ok: true,
    displayGroups,
    lightingGroups: [...lightingGroups]
  });
});

app.get("/api/v1/events",requireClassroomRead, (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
  res.json({ ok: true, events: recentEvents.slice(-limit) });
});

app.post("/api/v1/commands", requireControl, async (req, res) => {
  try {
    const result = await executeCommand(req.body, "http");
    res.json(result);
  } catch (err) {
    audit({ kind: "command.error", error: err.message, input: req.body });
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.get("/api/v1/integrations/check",requireCapability("integrations.control"), async (_req,res)=>{
  const out={ok:true,mqtt:{configured:runtime.mqtt.configured,connected:runtime.mqtt.connected,lastError:runtime.mqtt.lastError},
    hardware:{govee:{configured:runtime.hardware.govee.configured,reachable:runtime.mqtt.connected,lastError:runtime.hardware.govee.lastError},
              pluto:{configured:runtime.hardware.pluto.configured,reachable:false,lastError:runtime.hardware.pluto.lastError}}};
  try{const p=await directPluto({action:"systemStatus"});out.hardware.pluto.reachable=true;out.hardware.pluto.system=p.data}catch(e){out.ok=false;out.hardware.pluto.lastError=e.message}
  if(!runtime.mqtt.connected)out.ok=false;
  res.status(out.ok?200:503).json(out);
});


// v0.9 media library / scenes
app.get("/api/v1/media",requireClassroomRead, (_req,res)=>{
  res.json({ok:true,files:listMediaLibrary(),converter:{available:true,engine:"LibreOffice headless"}});
});
app.get("/api/v1/scenes",requireClassroomRead,(_req,res)=>res.json({ok:true,scenes:savedScenes}));
app.post("/api/v1/scenes/:id",requireControl,(req,res)=>{
 const id=cleanId(req.params.id),actions=Array.isArray(req.body?.actions)?req.body.actions:[];
 if(!id||!actions.length)return res.status(400).json({ok:false,error:"Scene id and actions required"});
 savedScenes[id]={name:String(req.body?.name||id).slice(0,100),actions};persistScenes();res.json({ok:true,id,scene:savedScenes[id]});
});
app.post("/api/v1/scenes/:id/run",requireControl,async(req,res)=>{
 try{const id=cleanId(req.params.id),scene=savedScenes[id];if(!scene)return res.status(404).json({ok:false,error:"Scene not found"});
 const results=[];for(const a of scene.actions)results.push(await executeCommand({type:a.type,target:req.body?.target??"all",payload:a.payload||{}},"scene"));
 res.json({ok:true,id,results});}catch(e){res.status(400).json({ok:false,error:e.message})}
});
app.get("/api/v1/integrations/govee/:target/scenes",requireClassroomRead,(req,res)=>{
  try{res.json(goveeScenes(req.params.target))}catch(e){res.status(400).json({ok:false,error:e.message})}
});
app.post("/api/v1/integrations/pluto/status",requireCapability("integrations.control"),async(req,res)=>{
  try{const action=String(req.body?.action||"videoStatus"),allowed=new Set(["videoStatus","outputStatus","inputStatus","cecStatus","systemStatus","networkStatus"]);
  if(!allowed.has(action))return res.status(400).json({ok:false,error:"Unsupported status action"});
  res.json(await directPluto({action}));}catch(e){res.status(502).json({ok:false,error:e.message})}
});




// v0.8 direct Govee APIs
app.get("/api/v1/govee",requireClassroomRead,(_req,res)=>res.json(goveeInventory()));
app.put("/api/v1/govee/discovery",requireControl,(req,res)=>{
  if(req.body?.autoAdd!==undefined)goveeDiscovery.autoAdd=!!req.body.autoAdd;
  persistGoveeDiscovery();
  res.json({ok:true,discovery:goveeInventory().discovery});
});
app.post("/api/v1/govee/discovery/reconcile",requireControl,(req,res)=>{
  const migrated=migrateGoveeDiscoveryRegistry();
  const force=req.body?.force!==false;
  const result=reconcileGoveeDiscovery(Date.now(),{force});
  res.json({ok:true,migrated,...result,inventory:goveeInventory()});
});
app.put("/api/v1/govee/device/:target",requireControl,(req,res)=>{
  try{res.json({ok:true,...updateGoveeDevice(req.params.target,req.body||{})})}
  catch(e){res.status(400).json({ok:false,error:e.message})}
});
app.get("/api/v1/govee/:target/status",requireClassroomRead,(req,res)=>{
  const alias=cleanId(req.params.target),d=goveeDevices[alias];
  if(!d)return res.status(404).json({ok:false,error:"Unknown Govee device"});
  res.json({ok:true,device:alias,meta:d,state:goveeStates[d.id]||null});
});
app.get("/api/v1/govee/:target/scenes",requireClassroomRead,(req,res)=>{try{res.json(goveeScenes(req.params.target))}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post("/api/v1/govee/:target/:action",requireControl,async(req,res)=>{
  try{res.json(await directGoveeCommand(req.params.target,cleanId(req.params.action),req.body||{}))}catch(e){res.status(400).json({ok:false,error:e.message})}
});

// v0.8 direct Pluto APIs
app.post("/api/v1/pluto",requireControl,async(req,res)=>{try{res.json(await directPluto(req.body||{}))}catch(e){res.status(502).json({ok:false,error:e.message})}});
app.get("/api/v1/pluto/status",requireClassroomRead,async(_req,res)=>{
  const out={ok:true,labels:avLabels};
  for(const a of ["videoStatus","outputStatus","inputStatus","cecStatus","systemStatus","networkStatus"]){
    try{out[a]=(await directPluto({action:a})).data}catch(e){out.ok=false;out[a]={error:e.message}}
  }
  res.status(out.ok?200:207).json(out);
});
app.get("/api/v1/pluto/labels",requireClassroomRead,(_req,res)=>res.json({ok:true,labels:avLabels}));
app.put("/api/v1/pluto/labels",requireControl,(req,res)=>{
  avLabels=normalizeAvLabels(req.body||{});persistAvLabels();audit({kind:"admin.config.av-labels",outputs:avLabels.outputs,inputs:avLabels.inputs,sourceEndpoints:avLabels.sourceEndpoints});res.json({ok:true,labels:avLabels});
});
app.get("/api/v1/pluto/schedules",requireClassroomRead,(_req,res)=>res.json({ok:true,schedules:plutoSchedules}));
app.post("/api/v1/pluto/schedules",requireControl,(req,res)=>{
  const incoming=req.body?.schedules||{},base=makeDefaultPlutoSchedules();
  for(const [k,v] of Object.entries(incoming)){
    if(!/^(hdmi|hdbt):[1-8]$/.test(k))continue;
    if(v?.enabled&&(!validTime(v.onTime)||!validTime(v.offTime)))return res.status(400).json({ok:false,error:`${k} requires valid on/off HH:MM times`});
    const [type,indexText]=k.split(":"),index=Number(indexText);
    base[k]={type,index,enabled:!!v.enabled,onTime:validTime(v.onTime)?v.onTime:"07:30",offTime:validTime(v.offTime)?v.offTime:"16:00",
      days:Array.isArray(v.days)?v.days.map(Number).filter(d=>d>=0&&d<=6):[],lastRun:v.lastRun||{},lastExec:v.lastExec||{}};
  }
  plutoSchedules=base;persistPlutoSchedules();res.json({ok:true,schedules:plutoSchedules});
});



// v0.10 unified classroom automations
app.get("/api/v1/automations/morning-announcements",requireClassroomRead,(_req,res)=>{
  res.json({ok:true,config:morningAnnouncements,runtime:morningAnnouncementsRuntime,playbackUrl:announcementsPlaybackUrl()});
});
app.put("/api/v1/automations/morning-announcements",requireCapability("automation.manage"),(req,res)=>{
  try{morningAnnouncements=normalizeMorningAnnouncements(req.body||{},morningAnnouncements);persistMorningAnnouncements();restartMorningAnnouncementsWatcher();res.json({ok:true,config:morningAnnouncements,runtime:morningAnnouncementsRuntime,playbackUrl:announcementsPlaybackUrl()})}
  catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.post("/api/v1/automations/morning-announcements/check",requireControl,async(_req,res)=>{
  try{
    const probe=await probeMorningAnnouncementsLive();
    morningAnnouncementsRuntime.lastCheck=new Date().toISOString();
    morningAnnouncementsRuntime.probe=probe.probe||null;
    morningAnnouncementsRuntime.probeStatus=probe.status||null;
    morningAnnouncementsRuntime.probeDurationMs=probe.durationMs??null;
    morningAnnouncementsRuntime.lastError=probe.error||null;
    if(probe.live===true){
      morningAnnouncementsRuntime.live=true;
      morningAnnouncementsRuntime.offlineCount=0;
      morningAnnouncementsRuntime.lastLiveAt=morningAnnouncementsRuntime.lastCheck;
    }else if(probe.live===false){
      morningAnnouncementsRuntime.live=false;
      if(morningAnnouncementsRuntime.active)morningAnnouncementsRuntime.offlineCount++;
      else morningAnnouncementsRuntime.offlineCount=0;
    }
    res.json({ok:true,...probe,config:morningAnnouncements,runtime:morningAnnouncementsRuntime});
  }catch(err){
    morningAnnouncementsRuntime.lastCheck=new Date().toISOString();
    morningAnnouncementsRuntime.lastError=err.message;
    res.status(500).json({ok:false,error:err.message,runtime:morningAnnouncementsRuntime});
  }
});
app.post("/api/v1/automations/morning-announcements/start",requireControl,async(req,res)=>{
  try{
    const rawTargets=Array.isArray(req.body?.targets)?req.body.targets:[req.body?.targets||"all"];
    const targets=automationDisplayTargets(rawTargets);
    await assertMorningAnnouncements({mode:"manual",targetsOverride:targets,urlOverride:req.body?.url||announcementsPlaybackUrl()});
    res.json({ok:true,config:morningAnnouncements,runtime:morningAnnouncementsRuntime,targets});
  }catch(err){res.status(500).json({ok:false,error:err.message})}
});
app.post("/api/v1/automations/morning-announcements/stop",requireControl,async(req,res)=>{
  try{await releaseMorningAnnouncements(String(req.body?.reason||"manual-stop"));res.json({ok:true,runtime:morningAnnouncementsRuntime})}
  catch(err){res.status(500).json({ok:false,error:err.message})}
});
app.get("/api/v1/automations/calendar",requireClassroomRead,(_req,res)=>{
  res.json({ok:true,calendar:schedulerCalendar,scheduleProfile:schoolScheduleProfile,cycleAnchor:{date:schoolCycleAnchor(),cycleDay:schoolCycleLetters()[0]||null,dayColor:alternateGroupLabel('A')}});
});
app.put("/api/v1/automations/calendar",requireCapability("schedule.manage"),(req,res)=>{
  try{
    const nextCalendar=normalizeSchedulerCalendar(req.body||{},schedulerCalendar);
    const nextProfile=req.body?.scheduleProfile?normalizeSchoolScheduleProfile({...req.body.scheduleProfile,anchorDate:req.body.scheduleProfile.anchorDate||nextCalendar.anchorDate},schoolScheduleProfile):schoolScheduleProfile;
    // Validate the complete request before changing either live object or durable state.
    if(req.body?.scheduleProfile){nextProfile.updatedAt=new Date().toISOString();dbStore.setPreference("school.schedule.profile",nextProfile)}
    persistJson(SCHEDULER_CALENDAR_FILE,nextCalendar);
    schedulerCalendar=nextCalendar;schoolScheduleProfile=nextProfile;
    audit({kind:"automation.calendar.update",noSchoolDates:schedulerCalendar.noSchoolDates,halfDayDates:schedulerCalendar.halfDayDates,oneHourDelayDates:schedulerCalendar.oneHourDelayDates,twoHourDelayDates:schedulerCalendar.twoHourDelayDates,remoteDates:schedulerCalendar.remoteDates,cycleAnchor:schoolCycleAnchor(),profileId:schoolScheduleProfile.id});
    res.json({ok:true,calendar:schedulerCalendar,scheduleProfile:schoolScheduleProfile,cycleAnchor:{date:schoolCycleAnchor(),cycleDay:schoolCycleLetters()[0]||null,dayColor:alternateGroupLabel('A')}});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});



function timeToMinutes(value){
  const [h,m]=String(value||"00:00").split(":").map(Number);
  return (Number.isFinite(h)?h:0)*60+(Number.isFinite(m)?m:0);
}
function classPhaseRank(cls){
  if(cls?.scheduleMode!=="alternating")return 2;
  return cls.alternatePhase==="B"?1:0;
}
function compareClassSchedules(a,b){
  return classPhaseRank(a)-classPhaseRank(b)
    || timeToMinutes(a.startTime)-timeToMinutes(b.startTime)
    || String(a.name||"").localeCompare(String(b.name||""));
}
function automationPrimaryOccurrence(event){
  const occ=resolveAutomationOccurrences(event);
  return Array.isArray(occ)&&occ.length
    ? [...occ].sort((a,b)=>timeToMinutes(a.time)-timeToMinutes(b.time))[0]
    : resolveAutomationFromClass(event);
}
function automationPhaseRank(event){
  const occ=automationPrimaryOccurrence(event)||event;
  if(occ?.scheduleMode!=="alternating")return 2;
  return occ.alternatePhase==="B"?1:0;
}
function compareAutomations(a,b){
  const ao=automationPrimaryOccurrence(a)||a;
  const bo=automationPrimaryOccurrence(b)||b;
  return automationPhaseRank(a)-automationPhaseRank(b)
    || timeToMinutes(ao.time||a.time)-timeToMinutes(bo.time||b.time)
    || String(a.name||"").localeCompare(String(b.name||""));
}

app.get("/api/v1/school-cycle",requireClassroomRead,(req,res)=>{
  const date=req.query.date&&validDateKey(req.query.date)?new Date(`${req.query.date}T12:00:00`):new Date();
  res.json({ok:true,...schoolCycleForDate(date),calendarRule:calendarRuleForDate(date),automationSuppressed:isAutomationSuppressed(date).blocked,cycle:schoolCycleLetters(),dayGroups:schoolScheduleProfile.dayGroups,scheduleProfileId:schoolScheduleProfile.id});
});

app.get("/api/v1/class-schedules",requireClassroomRead,(_req,res)=>{
  try{
    const now=new Date();
    res.json({ok:true,classes:[...classScheduleStore.classes].sort(compareClassSchedules),...classStatusPayload(now),scheduler:schedulerStatus()});
  }catch(err){
    res.status(500).json({ok:false,error:err.message,classes:classScheduleStore.classes});
  }
});
app.get("/api/v1/class-schedules/status",requireClassroomRead,(_req,res)=>{const now=new Date();res.json({ok:true,...classStatusPayload(now),scheduler:schedulerStatus()})});
app.post("/api/v1/class-schedules",requireCapability("schedule.manage"),(req,res)=>{try{const cls=normalizeClassSchedule(req.body||{});if(classScheduleStore.classes.some(x=>x.id===cls.id))return res.status(409).json({ok:false,error:"Class ID already exists"});const next={...classScheduleStore,classes:[...classScheduleStore.classes,cls]};commitClassSchedules(next);res.json({ok:true,classSchedule:cls})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.put("/api/v1/class-schedules/:id",requireCapability("schedule.manage"),(req,res)=>{try{const i=classScheduleStore.classes.findIndex(c=>c.id===req.params.id);if(i<0)return res.status(404).json({ok:false,error:"Class not found"});const cls=normalizeClassSchedule(req.body||{},classScheduleStore.classes[i]),classes=[...classScheduleStore.classes];classes[i]=cls;commitClassSchedules({...classScheduleStore,classes});res.json({ok:true,classSchedule:cls})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.post("/api/v1/class-schedules/:id/duplicate",requireCapability("schedule.manage"),(req,res)=>{
  try{
    const source=classScheduleStore.classes.find(c=>c.id===req.params.id);
    if(!source)return res.status(404).json({ok:false,error:"Class not found"});
    const copy=normalizeClassSchedule({
      ...source,
      id:undefined,
      name:String(req.body?.name||`${source.name} - Copy`),
      shortName:String(req.body?.shortName||source.shortName||source.name),
      createdAt:undefined,
      updatedAt:undefined
    },{});
    commitClassSchedules({...classScheduleStore,classes:[...classScheduleStore.classes,copy]});
    audit({kind:"class.duplicate",sourceId:source.id,classId:copy.id,name:copy.name});
    res.json({ok:true,classSchedule:copy});
  }catch(err){
    diagnosticError?.(err,{component:"classes",operation:"duplicate"});
    res.status(400).json({ok:false,error:err.message});
  }
});
app.delete("/api/v1/class-schedules/:id",requireCapability("schedule.manage"),(req,res)=>{
  const i=classScheduleStore.classes.findIndex(c=>c.id===req.params.id);
  if(i<0)return res.status(404).json({ok:false,error:"Class not found"});
  const references=classroomAutomations.events.filter(event=>automationClassIds(event).includes(req.params.id)||String(event.timerOverlay?.classId||"")===req.params.id).map(event=>({id:event.id,name:event.name}));
  if(references.length)return res.status(409).json({ok:false,error:"Class is referenced by one or more automations",references});
  try{const classes=[...classScheduleStore.classes],removed=classes.splice(i,1)[0];commitClassSchedules({...classScheduleStore,classes});res.json({ok:true,removed})}
  catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.get("/api/v1/automations",requireClassroomRead,(_req,res)=>{
  res.json({ok:true,events:[...classroomAutomations.events].sort(compareAutomations).map(e=>({...e,resolved:resolveAutomationFromClass(e),resolvedOccurrences:resolveAutomationOccurrences(e)})),scheduler:schedulerStatus(),actions:[
    "tv.power","display.clear","display.text","display.url","display.media","display.timer.class-end",
    "govee.power","govee.color","govee.brightness","govee.temp","govee.scene"
  ]});
});

app.post("/api/v1/automations",requireCapability("automation.manage"),(req,res)=>{
  try{
    const event=normalizeAutomation(req.body||{});
    if(classroomAutomations.events.some(x=>x.id===event.id))return res.status(409).json({ok:false,error:"Automation ID already exists"});
    commitAutomations({...classroomAutomations,events:[...classroomAutomations.events,event]});
    audit({kind:"automation.create",automationId:event.id,name:event.name});
    res.json({ok:true,event});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.put("/api/v1/automations/:id",requireCapability("automation.manage"),(req,res)=>{
  try{
    const id=cleanId(req.params.id),idx=classroomAutomations.events.findIndex(x=>x.id===id);
    if(idx<0)return res.status(404).json({ok:false,error:"Automation not found"});
    const event=normalizeAutomation({...req.body,id},classroomAutomations.events[idx]);
    const events=[...classroomAutomations.events];events[idx]=event;commitAutomations({...classroomAutomations,events});
    audit({kind:"automation.update",automationId:event.id,name:event.name});
    res.json({ok:true,event});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.delete("/api/v1/automations/:id",requireCapability("automation.manage"),(req,res)=>{
  const id=cleanId(req.params.id),before=classroomAutomations.events.length;
  const events=classroomAutomations.events.filter(x=>x.id!==id);
  if(events.length===before)return res.status(404).json({ok:false,error:"Automation not found"});
  try{commitAutomations({...classroomAutomations,events});audit({kind:"automation.delete",automationId:id});res.json({ok:true,id})}catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.post("/api/v1/automations/:id/duplicate",requireCapability("automation.manage"),(req,res)=>{
  try{
    const source=classroomAutomations.events.find(e=>e.id===req.params.id);
    if(!source)return res.status(404).json({ok:false,error:"Scheduled event not found"});

    const copy=normalizeAutomation({
      ...source,
      id:undefined,
      name:String(req.body?.name||`${source.name} - Copy`),
      lastRun:null,
      lastExec:null,
      createdAt:undefined,
      updatedAt:undefined
    },{});

    commitAutomations({...classroomAutomations,events:[...classroomAutomations.events,copy]});
    audit({kind:"automation.duplicate",sourceId:source.id,automationId:copy.id,name:copy.name});
    res.json({ok:true,event:copy});
  }catch(err){
    diagnosticError?.(err,{component:"automation",operation:"duplicate"});
    res.status(400).json({ok:false,error:err.message});
  }
});


app.post("/api/v1/automations/:id/run",requireControl,async(req,res)=>{
  let event=null;
  try{
    const id=cleanId(req.params.id);event=classroomAutomations.events.find(x=>x.id===id);
    if(!event)return res.status(404).json({ok:false,error:"Automation not found"});
    if(morningAnnouncementsRuntime.active)return res.status(409).json({ok:false,error:"Morning Announcements have priority. Stop announcements before running an automation manually."});
    const result=await runClassroomAutomation(resolveAutomationForManualTest(event),{manual:true});
    event.lastRun={at:new Date().toISOString(),ok:result.ok!==false,manual:true,message:result.ok===false?"Completed with action errors":"Completed",resultSummary:{action:event.action,actions:[event.action,...(event.actions||[]).map(x=>x.action)],targets:event.targets,failures:automationRunFailures(result)}};event.updatedAt=new Date().toISOString();persistAutomations();
    res.json(result);
  }catch(err){if(event){event.lastRun={at:new Date().toISOString(),ok:false,manual:true,message:err.message};event.updatedAt=new Date().toISOString();persistAutomations()}res.status(500).json({ok:false,error:err.message})}
});


// v0.5 configuration + diagnostics
app.get("/api/v1/config",requireClassroomRead,(_req,res)=>res.json({ok:true,room:deviceConfig.room||ROOM_NAME,devices,displayGroups,lightingGroups:[...lightingGroups]}));

app.post("/api/v1/config/devices/:id",requireControl,(req,res)=>{
 const id=cleanId(req.params.id);if(!devices[id])return res.status(404).json({ok:false,error:"Unknown device"});
 const cur=devices[id],b=req.body||{};
 devices[id]={...cur,
  name:b.name!==undefined?String(b.name).slice(0,100):cur.name,
  enabled:b.enabled!==undefined?!!b.enabled:cur.enabled,
  avOutput:b.avOutput!==undefined?Number(b.avOutput):cur.avOutput,
  lightingAlias:b.lightingAlias!==undefined?(b.lightingAlias===null?null:cleanId(b.lightingAlias)):cur.lightingAlias,
  tags:Array.isArray(b.tags)?b.tags.map(cleanId).filter(Boolean):cur.tags
 };
 deviceConfig.devices=devices;persistRuntimeConfig();res.json({ok:true,id,device:devices[id]});
});

app.post("/api/v1/config/groups/:id",requireControl,(req,res)=>{
 const id=cleanId(req.params.id),members=Array.isArray(req.body?.members)?req.body.members.map(cleanId).filter(x=>devices[x]):[];
 if(!id)return res.status(400).json({ok:false,error:"Group id required"});
 displayGroups[id]=[...new Set(members)];deviceConfig.displayGroups=displayGroups;persistRuntimeConfig();res.json({ok:true,id,members:displayGroups[id]});
});

async function buildDiagnosticsSnapshot(){
  const r=publicRuntime();
  const now=new Date();
  let veyonWebApi={ok:false};
  try{
    const response=await veyonFetch("/",{timeoutMs:2500});
    veyonWebApi={ok:true,httpStatus:response.status,url:VEYON_WEBAPI_URL};
  }catch(err){
    veyonWebApi={ok:false,url:VEYON_WEBAPI_URL,error:err.message};
  }

  const veyonPool=[...veyonConnectionCache.entries()].map(([host,x])=>({
    host,
    validUntil:x.validUntil,
    idleSeconds:Math.max(0,Math.floor((Date.now()-Number(x.lastUsed||0))/1000))
  }));

  const mem=process.memoryUsage();
  const errors=diagnosticsEventSlice({limit:100,errorsOnly:true});
  const actions=diagnosticsEventSlice({limit:250}).filter(e=>
    ["command","automation.run","automation.create","automation.update","automation.delete","service.action","govee.command"].includes(e.kind)
  );

  return {
    ok:true,
    generatedAt:now.toISOString(),
    system:{
      version:APPLICATION_VERSION,
      node:process.version,
      platform:process.platform,
      arch:process.arch,
      pid:process.pid,
      processUptimeSeconds:Math.round(process.uptime()),
      systemUptimeSeconds:Math.round(os.uptime()),
      timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||null,
      schedulerTimezone:SCHEDULER_TIMEZONE,
      memory:{
        rss:mem.rss,heapTotal:mem.heapTotal,heapUsed:mem.heapUsed,external:mem.external,
        freeSystem:os.freemem(),totalSystem:os.totalmem()
      },
      loadAverage:os.loadavg()
    },
    services:{
      classroomHub:{ok:true,startedAt:runtime.startedAt,room:deviceConfig.room||ROOM_NAME},
      mqtt:{ok:!!runtime.mqtt.connected,...diagnosticSanitize(runtime.mqtt)},
      pluto:{ok:!runtime.hardware.pluto.lastError,...diagnosticSanitize(runtime.hardware.pluto)},
      govee:{ok:!runtime.hardware.govee.lastError,...diagnosticSanitize(runtime.hardware.govee),configuredDevices:Object.keys(goveeDevices).length},
      veyon:{...veyonWebApi,pool:{size:veyonConnectionCache.size,max:VEYON_POOL_MAX,connections:veyonPool}},
      websocket:{ok:true,clients:runtime.websocketClients},
      displays:{
        ok:Object.values(r.displays).some(x=>x.online),
        configured:Object.keys(devices).length,
        online:Object.values(r.displays).filter(x=>x.online).length,
        status:r.displays
      },
      scheduler:{ok:true,...schedulerStatus()},
      database:{ok:true,...dbStore.databaseInfo()}
    },
    configuration:{
      room:deviceConfig.room||ROOM_NAME,
      mqtt:{url:MQTT_URL,jsonBridge:MQTT_JSON_BRIDGE,legacyBridge:MQTT_LEGACY_BRIDGE},
      pluto:{configured:Boolean(PLUTO_URL),url:PLUTO_URL,timeoutMs:PLUTO_TIMEOUT_MS,readRetries:PLUTO_READ_RETRIES},
      veyon:{url:VEYON_WEBAPI_URL,keyName:VEYON_KEY_NAME,keyFileReadable:dbStore.hasSecret("veyon.private-key")||fs.existsSync(VEYON_PRIVATE_KEY_FILE),scanSubnet:VEYON_SCAN_SUBNET,poolMax:VEYON_POOL_MAX},
      scheduler:schedulerStatus(),
      displayGroups,
      lightingGroups:[...lightingGroups]
    },
    data:{
      classes:classScheduleStore.classes.length,
      automations:classroomAutomations.events.length,
      mediaFiles:fs.existsSync(MEDIA_DIR)?fs.readdirSync(MEDIA_DIR).length:0,
      presentationEntries:fs.existsSync(PRESENTATIONS_DIR)?fs.readdirSync(PRESENTATIONS_DIR).length:0,
      database:dbStore.databaseInfo(),
      legacyFiles:{
        audit:diagnosticsFileStatus(AUDIT_FILE),
        automations:diagnosticsFileStatus(AUTOMATIONS_FILE),
        classSchedules:diagnosticsFileStatus(CLASS_SCHEDULES_FILE),
        veyonComputers:diagnosticsFileStatus(VEYON_COMPUTERS_FILE)
      }
    },
    recent:{errors,actions,events:diagnosticsEventSlice({limit:250})}
  };
}


// Local authentication, users and setup completion.
function disconnectInvalidUserWebSockets(userId){
  for(const ws of wsClients){
    if(ws.readyState!==WebSocket.OPEN||String(ws.authUser?.id||"")!==String(userId||""))continue;
    if(!ws.sessionToken||!dbStore.sessionUser(ws.sessionToken))ws.close(1008,"Session revoked");
  }
}
app.get("/api/v1/auth/status",(req,res)=>{
  const user=requestUser(req);res.json({ok:true,authEnabled:dbStore.authEnabled(),setupCompleted:dbStore.setupCompleted(),user:publicUser(user),userCount:dbStore.userCount()});
});
app.post("/api/v1/auth/login",async(req,res)=>{
  const username=String(req.body?.username||"").trim().slice(0,80),key=loginAttemptKey(req,username),addressKey=loginAddressKey(req),state=loginAttemptState(key),addressState=loginAttemptState(addressKey),now=Date.now();
  if(state.lockedUntil>now||addressState.lockedUntil>now){const retry=Math.max(1,Math.ceil((Math.max(state.lockedUntil,addressState.lockedUntil)-now)/1000));res.setHeader("Retry-After",String(retry));audit({kind:"security.login.rate-limited",username,remote:clientAddress(req),retryAfter:retry});return res.status(429).json({ok:false,error:`Too many failed sign-in attempts. Try again in ${Math.ceil(retry/60)} minute(s).`,retryAfter:retry})}
  const user=await verifyUserAsync(username,req.body?.password);
  if(!user){const failed=recordLoginFailure(key),addressFailed=recordLoginFailure(addressKey);audit({kind:"auth.login.failed",username,remote:clientAddress(req),attempt:failed.count});if(Math.max(failed.lockedUntil,addressFailed.lockedUntil)>Date.now()){const retry=Math.ceil((Math.max(failed.lockedUntil,addressFailed.lockedUntil)-Date.now())/1000);res.setHeader("Retry-After",String(retry));return res.status(429).json({ok:false,error:"Too many failed sign-in attempts. This sign-in source is temporarily locked.",retryAfter:retry})}return res.status(401).json({ok:false,error:"Invalid username or password"})}
  clearLoginFailures(key);clearLoginFailures(addressKey);
  const policy=dbStore.authPolicy(),ttlHours=req.body?.remember?policy.rememberHours:policy.standardHours,sess=dbStore.createSession(user,{remoteAddr:clientAddress(req),userAgent:req.get("user-agent")||"",ttlHours});
  const secure=(req.secure||String(req.get("x-forwarded-proto")||"").toLowerCase()==="https")?"; Secure":"";
  res.setHeader("Set-Cookie",`classroom_hub_session=${encodeURIComponent(sess.token)}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${Math.round(ttlHours*3600)}`);audit({kind:"auth.login",userId:user.id,username:user.username,role:user.role,remote:clientAddress(req)});res.json({ok:true,user:publicUser(user),expiresAt:sess.expiresAt});
});
app.post("/api/v1/auth/logout",(req,res)=>{const token=cookieValue(req,"classroom_hub_session"),user=requestUser(req);dbStore.deleteSession(token);if(user)disconnectInvalidUserWebSockets(user.id);res.setHeader("Set-Cookie","classroom_hub_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");if(user)audit({kind:"auth.logout",userId:user.id,username:user.username});res.json({ok:true})});
app.get("/api/v1/auth/me",(req,res)=>{const user=requestUser(req);if(dbStore.authEnabled()&&!user)return res.status(401).json({ok:false,error:"Not authenticated"});res.json({ok:true,user:publicUser(user),authEnabled:dbStore.authEnabled()})});
app.get("/api/v1/auth/sessions",requireAuthenticated,(req,res)=>{const user=requestUser(req);if(!user)return res.json({ok:true,sessions:[]});res.json({ok:true,sessions:dbStore.listUserSessions(user.id).map(x=>({...x,current:x.id===user.sessionId}))})});
app.delete("/api/v1/auth/sessions/:id",requireAuthenticated,(req,res)=>{const user=requestUser(req);if(!user)return res.status(401).json({ok:false,error:"Not authenticated"});if(req.params.id===user.sessionId)return res.status(400).json({ok:false,error:"Use Logout to end the current session"});const removed=dbStore.deleteUserSession(user.id,req.params.id);disconnectInvalidUserWebSockets(user.id);audit({kind:"auth.session.revoke",userId:user.id,sessionId:req.params.id,removed});res.json({ok:true,removed})});
app.post("/api/v1/auth/logout-others",requireAuthenticated,(req,res)=>{const user=requestUser(req);if(!user)return res.status(401).json({ok:false,error:"Not authenticated"});const removed=dbStore.deleteAllUserSessions(user.id,{exceptSessionId:user.sessionId});disconnectInvalidUserWebSockets(user.id);audit({kind:"auth.sessions.revoke-others",userId:user.id,removed});res.json({ok:true,removed})});
app.post("/api/v1/auth/change-password",requireAuthenticated,(req,res)=>{try{const user=requestUser(req);if(!user)return res.status(401).json({ok:false,error:"Not authenticated"});dbStore.changeUserPassword(user.id,req.body?.currentPassword,req.body?.newPassword);dbStore.deleteAllUserSessions(user.id,{exceptSessionId:user.sessionId});disconnectInvalidUserWebSockets(user.id);audit({kind:"auth.password.change",userId:user.id,username:user.username});res.json({ok:true,message:"Password changed. Other sessions were signed out."})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.post("/api/v1/setup/administrator",(req,res)=>{
  try{
    if(dbStore.userCount()>0)return res.status(409).json({ok:false,error:"Secure setup is already complete"});
    if(!SETUP_TOKEN)return res.status(503).json({ok:false,error:"SETUP_TOKEN must be configured before creating the first administrator"});
    if(!secureTokenEqual(req.get("x-setup-token")||"",SETUP_TOKEN)){
      audit({kind:"security.setup.denied",remote:clientAddress(req)});
      return res.status(403).json({ok:false,error:"Invalid setup token"});
    }
    const user=dbStore.createFirstAdministrator({id:req.body?.id||crypto.randomUUID(),username:req.body?.username,displayName:req.body?.displayName||req.body?.username},{password:req.body?.password});
    const policy=dbStore.authPolicy(),sess=dbStore.createSession(user,{remoteAddr:clientAddress(req),userAgent:req.get("user-agent")||"",ttlHours:policy.standardHours});
    const secure=(req.secure||String(req.get("x-forwarded-proto")||"").toLowerCase()==="https")?"; Secure":"";
    res.setHeader("Set-Cookie",`classroom_hub_session=${encodeURIComponent(sess.token)}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${Math.round(policy.standardHours*3600)}`);
    audit({kind:"setup.administrator",userId:user.id,username:user.username,authEnabled:true,remote:clientAddress(req)});
    res.status(201).json({ok:true,user:publicUser(user),authEnabled:true,setupCompleted:true});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.get("/api/v1/admin/users",requireAdmin,(_req,res)=>res.json({ok:true,users:dbStore.listUsers(),authEnabled:dbStore.authEnabled(),policy:dbStore.authPolicy(),sessions:dbStore.listAllUserSessions()}));
app.post("/api/v1/admin/users",requireAdmin,(req,res)=>{try{const user=dbStore.putUser(req.body||{},{password:req.body?.password});audit({kind:"admin.user.create",userId:user.id,username:user.username,role:user.role});res.json({ok:true,user})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.put("/api/v1/admin/users/:id",requireAdmin,(req,res)=>{try{const current=dbStore.listUsers().find(x=>x.id===req.params.id);if(!current)return res.status(404).json({ok:false,error:"User not found"});const enabledAdmins=dbStore.listUsers().filter(x=>x.enabled&&x.role==="admin");if(current.role==="admin"&&enabledAdmins.length<=1&&(req.body?.enabled===false||(req.body?.role&&req.body.role!=="admin")))return res.status(400).json({ok:false,error:"Cannot disable or demote the last enabled administrator"});const profileId=req.body?.profileId||(req.body?.role&&req.body.role!==current.role?{admin:"administrator",operator:"teacher",viewer:"read-only"}[req.body.role]:current.profileId);const user=dbStore.putUser({...current,...req.body,profileId,id:req.params.id},{password:req.body?.password||null});const authorizationChanged=current.role!==user.role||current.profileId!==user.profileId||current.enabled!==user.enabled||Boolean(req.body?.password);let revokedSessions=0;if(authorizationChanged){revokedSessions=dbStore.deleteAllUserSessions(user.id);disconnectInvalidUserWebSockets(user.id)}audit({kind:"admin.user.update",userId:user.id,username:user.username,role:user.role,profileId:user.profileId,enabled:user.enabled,revokedSessions});res.json({ok:true,user,revokedSessions})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.delete("/api/v1/admin/users/:id",requireAdmin,(req,res)=>{const current=dbStore.listUsers().find(x=>x.id===req.params.id);if(!current)return res.status(404).json({ok:false,error:"User not found"});if(current.role==="admin"&&dbStore.listUsers().filter(x=>x.enabled&&x.role==="admin").length<=1)return res.status(400).json({ok:false,error:"Cannot remove the last enabled administrator"});dbStore.deleteUser(req.params.id);disconnectInvalidUserWebSockets(req.params.id);audit({kind:"admin.user.delete",userId:req.params.id,username:current.username});res.json({ok:true})});
app.put("/api/v1/admin/auth",requireAdmin,(req,res)=>{
  if(req.body?.enabled!==true)return res.status(400).json({ok:false,error:"Local authentication cannot be disabled on a secured appliance"});
  const enabled=dbStore.setAuthEnabled(true);audit({kind:"admin.auth.update",enabled});res.json({ok:true,enabled});
});
app.post("/api/v1/admin/users/:id/reset-password",requireAdmin,(req,res)=>{try{const user=dbStore.resetUserPassword(req.params.id,req.body?.password);disconnectInvalidUserWebSockets(user.id);audit({kind:"admin.user.password-reset",userId:user.id,username:user.username});res.json({ok:true,user,message:"Password reset. All existing sessions for this user were revoked."})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.delete("/api/v1/admin/sessions/:id",requireAdmin,(req,res)=>{const sess=dbStore.listAllUserSessions().find(x=>x.id===req.params.id);if(!sess)return res.status(404).json({ok:false,error:"Session not found"});const removed=dbStore.deleteUserSession(sess.userId,sess.id);disconnectInvalidUserWebSockets(sess.userId);audit({kind:"admin.session.revoke",sessionId:sess.id,userId:sess.userId,removed});res.json({ok:true,removed})});
app.put("/api/v1/admin/auth-policy",requireAdmin,(req,res)=>{try{const policy=dbStore.setAuthPolicy(req.body||{});audit({kind:"admin.auth-policy.update",policy});res.json({ok:true,policy})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.get("/api/v1/admin/privacy-retention",requireAdmin,(_req,res)=>res.json({ok:true,policy:privacyRetentionPolicy()}));
app.put("/api/v1/admin/privacy-retention",requireAdmin,(req,res)=>{try{const current=privacyRetentionPolicy(),hours=req.body?.browserHistoryHours===undefined?current.browserHistoryHours:Number(req.body.browserHistoryHours);if(!Number.isFinite(hours)||hours<0)throw Error("Browser history retention must be zero or a positive number of hours");const next={browserHistoryEnabled:req.body?.browserHistoryEnabled===undefined?current.browserHistoryEnabled:req.body.browserHistoryEnabled===true,browserHistoryHours:Math.max(0,Math.min(24*365,hours)),screenshotDays:Math.max(1,Math.min(365,Number(req.body?.screenshotDays)||current.screenshotDays)),alertDays:Math.max(1,Math.min(365,Number(req.body?.alertDays)||current.alertDays)),auditDays:Math.max(7,Math.min(3650,Number(req.body?.auditDays)||current.auditDays))};if(next.browserHistoryHours===0)next.browserHistoryEnabled=false;dbStore.setPreference("privacy.retention",next);applyPrivacyRetentionPolicy();if(req.body?.applyNow===true||!next.browserHistoryEnabled)pruneStudentData(next);audit({kind:"admin.privacy-retention.update",policy:next,applyNow:req.body?.applyNow===true});res.json({ok:true,policy:next})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.put("/api/v1/admin/setup-state",requireAdmin,(req,res)=>{const completed=dbStore.setSetupCompleted(req.body?.completed!==false);res.json({ok:true,completed})});

// Database-native administration/configuration APIs.
app.get("/api/v1/admin/health",requireAdmin,(req,res)=>{const u=requestUser(req),db=dbStore.databaseInfo();res.json({ok:true,version:APPLICATION_VERSION,generatedAt:new Date().toISOString(),auth:{enabled:dbStore.authEnabled(),setupCompleted:dbStore.setupCompleted(),user:u?{id:u.id,username:u.username,displayName:u.displayName,role:u.role}:null,policy:dbStore.authPolicy(),activeSessions:dbStore.listAllUserSessions().length},runtime:{room:deviceConfig.room||ROOM_NAME,mqtt:{configured:runtime.mqtt.configured,connected:runtime.mqtt.connected,lastError:runtime.mqtt.lastError,lastConnectAt:runtime.mqtt.lastConnectAt},websocketClients:runtime.websocketClients,onlineDisplays:Object.values(runtime.displays||{}).filter(x=>x&&x.online).length},database:db});});
app.get("/api/v1/admin/summary",requireAdmin,(_req,res)=>{
  const cfg=dbStore.getAdminConfig(),db=dbStore.databaseInfo();
  res.json({ok:true,site:cfg.site,database:db,counts:{
    displays:Object.keys(cfg.devices?.devices||{}).length,
    displayGroups:Object.keys(cfg.devices?.displayGroups||{}).length,
    lightingDevices:Object.keys(cfg.hardware?.govee?.devices||{}).length,
    lightingGroups:Object.keys(cfg.hardware?.govee?.groups||{}).length,
    accessProfiles:(cfg.accessProfiles||[]).length
  }});
});
app.get("/api/v1/admin/config",requireAdmin,(_req,res)=>{
  res.json({ok:true,...dbStore.getAdminConfig(),integrationConnections:integrationConnectionsView(),database:dbStore.databaseInfo()});
});
app.put("/api/v1/admin/site",requireAdmin,(req,res)=>{
  try{
    const current=normalizedSiteProfile(dbStore.getAdminConfig().site||{}),site=dbStore.putSiteProfile(normalizedSiteProfile({...current,...(req.body||{}),theme:{...current.theme,...(req.body?.theme||{})}}));
    SCHEDULER_TIMEZONE=site.timezone;process.env.TZ=site.timezone;
    if(site.room){deviceConfig.room=String(site.room);persistRuntimeConfig()}
    audit({kind:"admin.config.site",site:{...site}});res.json({ok:true,site});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.put("/api/v1/admin/displays",requireAdmin,(req,res)=>{
  try{
    const incoming=req.body||{};
    const nextDevices=incoming.devices&&typeof incoming.devices==="object"?incoming.devices:devices;
    const nextGroups=incoming.displayGroups&&typeof incoming.displayGroups==="object"?incoming.displayGroups:displayGroups;
    for(const [id,d] of Object.entries(nextDevices)){if(!/^[a-z0-9_-]{1,40}$/i.test(id))throw Error(`Invalid display id: ${id}`);if(!d||typeof d!=="object")throw Error(`Invalid display definition: ${id}`)}
    for(const [name,members] of Object.entries(nextGroups)){if(!Array.isArray(members))throw Error(`Group ${name} members must be an array`);for(const id of members)if(!nextDevices[id])throw Error(`Group ${name} references unknown display ${id}`)}
    const committedDevices=JSON.parse(JSON.stringify(nextDevices)),committedGroups=JSON.parse(JSON.stringify(nextGroups));
    dbStore.writeNormalized("devices",{room:deviceConfig.room||ROOM_NAME,devices:committedDevices,displayGroups:committedGroups,lightingGroups:[...lightingGroups]});
    devices=committedDevices;displayGroups=committedGroups;deviceConfig.devices=devices;deviceConfig.displayGroups=displayGroups;
    const disconnected=[];for(const ws of wsClients){if(ws.role!=="display"||ws.readyState!==WebSocket.OPEN)continue;const id=String(ws.deviceId||"");if(!devices[id]||devices[id].enabled===false){disconnected.push(id);ws.close(1008,"Display removed or disabled")}}
    audit({kind:"admin.config.displays",displayCount:Object.keys(devices).length,groupCount:Object.keys(displayGroups).length,disconnected:[...new Set(disconnected)]});res.json({ok:true,devices,displayGroups});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
function displayCredentialAdminView(){
  const security=dbStore.listDisplayCredentials(),byDisplay={};
  for(const [id,d] of Object.entries(devices))byDisplay[id]={id,name:d.name||id,enabled:d.enabled!==false,credentials:[],pending:[]};
  for(const c of security.credentials)if(byDisplay[c.displayId])byDisplay[c.displayId].credentials.push(c);
  for(const p of security.pending)if(byDisplay[p.displayId])byDisplay[p.displayId].pending.push(p);
  const values=Object.values(byDisplay),unenrolled=values.filter(d=>d.enabled&&!d.credentials.some(c=>!c.revokedAt)).map(d=>d.id);
  return {policy:security.policy,coverage:{enabled:values.filter(d=>d.enabled).length,enrolled:values.filter(d=>d.enabled&&d.credentials.some(c=>!c.revokedAt)).length,unenrolled},displays:values};
}
function disconnectRevokedDisplayCredentials(ids){const set=new Set([].concat(ids||[]).map(String));for(const ws of wsClients)if(ws.role==="display"&&set.has(String(ws.displayCredentialId||""))&&ws.readyState===WebSocket.OPEN)ws.close(1008,"Display credential revoked")}
function disconnectRevokedLabAgentCredentials(ids){const set=new Set([].concat(ids||[]).map(String));for(const ws of wsClients)if(ws.role==="lab-agent"&&set.has(String(ws.labAgentCredentialId||""))&&ws.readyState===WebSocket.OPEN)ws.close(1008,"Lab agent credential revoked")}
app.get("/api/v1/admin/display-credentials",requireAdmin,(_req,res)=>res.json({ok:true,...displayCredentialAdminView()}));
app.put("/api/v1/admin/display-credentials/policy",requireAdmin,(req,res)=>{try{const state=displayCredentialAdminView();if(req.body?.authenticationRequired===true&&state.coverage.unenrolled.length&&req.body?.confirmEnableWithoutFullEnrollment!==true)return res.status(409).json({ok:false,error:`Enroll every enabled display before requiring credentials. Missing: ${state.coverage.unenrolled.join(", ")}`,unenrolled:state.coverage.unenrolled});const policy=dbStore.setDisplayCredentialPolicy(req.body||{});if(policy.authenticationRequired)for(const ws of wsClients)if(ws.role==="display"&&ws.displayAuthMode==="configured-display"&&ws.readyState===WebSocket.OPEN)ws.close(1008,"Display authentication is now required");audit({kind:"admin.display-credentials.policy",policy});res.json({ok:true,policy})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.post("/api/v1/admin/displays/:id/enrollment",requireAdmin,(req,res)=>{try{const displayId=cleanId(req.params.id),issued=dbStore.createDisplayEnrollment(displayId,{ttlMinutes:req.body?.ttlMinutes});if(req.body?.revokeExisting===true){const active=dbStore.listDisplayCredentials().credentials.filter(x=>x.displayId===displayId&&!x.revokedAt).map(x=>x.id);dbStore.revokeDisplayCredentials(displayId);disconnectRevokedDisplayCredentials(active)}const url=`/display/${encodeURIComponent(displayId)}#enrollmentToken=${encodeURIComponent(issued.token)}`;audit({kind:"admin.display-enrollment.issue",displayId,expiresAt:issued.expiresAt,revokeExisting:req.body?.revokeExisting===true});res.status(201).json({ok:true,enrollment:{id:issued.id,displayId,displayName:issued.displayName,expiresAt:issued.expiresAt,url}})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.delete("/api/v1/admin/displays/:id/enrollment",requireAdmin,(req,res)=>{const displayId=cleanId(req.params.id),cancelled=dbStore.cancelDisplayEnrollments(displayId);audit({kind:"admin.display-enrollment.cancel",displayId,cancelled});res.json({ok:true,cancelled})});
app.delete("/api/v1/admin/display-credentials/:id",requireAdmin,(req,res)=>{const id=String(req.params.id||""),revoked=dbStore.revokeDisplayCredential(id);if(revoked)disconnectRevokedDisplayCredentials([id]);audit({kind:"admin.display-credential.revoke",credentialId:id,revoked});res.status(revoked?200:404).json({ok:revoked,error:revoked?undefined:"Active credential not found"})});
app.get("/api/v1/admin/lab-agent-credentials",requireAdmin,(_req,res)=>res.json({ok:true,...dbStore.listLabAgentCredentials()}));
app.put("/api/v1/admin/lab-agent-credentials/policy",requireAdmin,(req,res)=>{try{const policy=dbStore.setLabAgentCredentialPolicy(req.body||{});audit({kind:"admin.lab-agent-credentials.policy",policy});res.json({ok:true,policy})}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.post("/api/v1/admin/lab-agents/:id/enrollment",requireAdmin,(req,res)=>{try{
  const agentId=cleanLabAgentId(req.params.id),host=effectiveHost(req);if(!host)throw Error("A valid canonical Host header is required");
  const issued=dbStore.createLabAgentEnrollment(agentId,{ttlMinutes:req.body?.ttlMinutes});
  const proto=req.secure||req.protocol==="https"?"https":"http",origin=`${proto}://${host}`,script=`${origin}/lab-agent/Install-Agent.ps1`,allowHttp=proto==="https"?"":" -AllowHttp";
  const command=`$i=Join-Path $env:TEMP 'Install-ClassroomHubAgent.ps1'; irm ${powerShellLiteral(script)} -OutFile $i; & $i -HubUrl ${powerShellLiteral(origin)} -AgentId ${powerShellLiteral(agentId)} -EnrollmentToken ${powerShellLiteral(issued.token)}${allowHttp}`;
  audit({kind:"admin.lab-agent-enrollment.issue",agentId,expiresAt:issued.expiresAt});res.status(201).json({ok:true,enrollment:{id:issued.id,agentId,token:issued.token,expiresAt:issued.expiresAt,installerUrl:script,installCommand:command}})
}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.delete("/api/v1/admin/lab-agent-credentials/:id",requireAdmin,(req,res)=>{const id=String(req.params.id||""),revoked=dbStore.revokeLabAgentCredential(id);if(revoked)disconnectRevokedLabAgentCredentials([id]);audit({kind:"admin.lab-agent-credential.revoke",credentialId:id,revoked});res.status(revoked?200:404).json({ok:revoked,error:revoked?undefined:"Active credential not found"})});
app.put("/api/v1/admin/hardware",requireAdmin,(req,res)=>{
  try{const value=req.body||{};dbStore.writeNormalized("hardware",value);audit({kind:"admin.config.hardware"});res.json({ok:true,hardware:value,restartRecommended:true})}catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.put("/api/v1/admin/integration-connections",requireAdmin,async(req,res)=>{
  try{
    const body=req.body||{},next=normalizedIntegrationConnections(body,currentIntegrationConnections());
    if(body.mqtt?.password){dbStore.putSecret("integration.mqtt.password",String(body.mqtt.password),{type:"integration-password",integration:"mqtt"})}
    if(body.veyon?.privateKey){
      const key=String(body.veyon.privateKey).trim();
      if(!key.includes("BEGIN")||!key.includes("PRIVATE KEY"))throw Error("Veyon private key must be PEM-formatted private-key material");
      dbStore.putSecret("veyon.private-key",key,{type:"private-key",integration:"veyon",keyName:next.veyon.keyName});
    }
    dbStore.setPreference("integrations.connections",next);
    applyIntegrationConnections(next);
    runtime.hardware.pluto={...runtime.hardware.pluto,configured:Boolean(PLUTO_URL),url:PLUTO_URL,lastError:null};
    veyonConnectionCache.clear();veyonAuthInFlight.clear();
    reconnectMqtt();
    audit({kind:"admin.integrations.connections",mqttConfigured:Boolean(MQTT_URL),plutoConfigured:Boolean(PLUTO_URL),veyonConfigured:Boolean(VEYON_WEBAPI_URL)});
    res.json({ok:true,integrationConnections:integrationConnectionsView(),applied:true});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.get("/api/v1/admin/secrets",requireAdmin,(_req,res)=>res.json({ok:true,secrets:dbStore.listSecrets(),certificates:dbStore.listCertificates()}));
app.put("/api/v1/admin/secrets/:name",requireAdmin,(req,res)=>{
  try{const name=String(req.params.name||"").trim(),value=req.body?.value;if(!name||value===undefined)return res.status(400).json({ok:false,error:"Secret name and value are required"});dbStore.putSecret(name,String(value),req.body?.metadata||{});audit({kind:"admin.secret.update",name});res.json({ok:true,name})}catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.delete("/api/v1/admin/secrets/:name",requireAdmin,(req,res)=>{dbStore.deleteSecret(req.params.name);audit({kind:"admin.secret.delete",name:req.params.name});res.json({ok:true})});
app.put("/api/v1/admin/certificates/:name",requireAdmin,(req,res)=>{
  try{const pem=String(req.body?.pem||"");if(!pem.includes("BEGIN CERTIFICATE"))throw Error("A PEM certificate is required");dbStore.putCertificate(req.params.name,pem,req.body?.metadata||{});audit({kind:"admin.certificate.update",name:req.params.name});res.json({ok:true,name:req.params.name})}catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.get("/api/v1/admin/access-profiles",requireAdmin,(_req,res)=>res.json({ok:true,profiles:dbStore.listAccessProfiles()}));
app.put("/api/v1/admin/access-profiles/:id",requireAdmin,(req,res)=>{try{
  const id=String(req.params.id||""),before=dbStore.listAccessProfiles().find(x=>x.id===id)||null;
  const profile=dbStore.putAccessProfile({...req.body,id});
  const authorizationChanged=!before||before.role!==profile.role||before.enabled!==profile.enabled||JSON.stringify(before.config)!==JSON.stringify(profile.config);
  let revokedSessions=0;
  if(authorizationChanged){for(const user of dbStore.listUsers().filter(x=>x.profileId===id)){revokedSessions+=dbStore.deleteAllUserSessions(user.id);disconnectInvalidUserWebSockets(user.id)}}
  audit({kind:"admin.access-profile.update",id,role:profile.role,enabled:profile.enabled,revokedSessions});res.json({ok:true,profile,revokedSessions})
}catch(err){res.status(400).json({ok:false,error:err.message})}});
app.delete("/api/v1/admin/access-profiles/:id",requireAdmin,(req,res)=>{try{dbStore.deleteAccessProfile(req.params.id);audit({kind:"admin.access-profile.delete",id:req.params.id});res.json({ok:true})}catch(err){res.status(409).json({ok:false,error:err.message})}});


// Music Assistant integration - server-side token proxy. The long-lived MA token is
// encrypted in Classroom Control Hub and is never returned to controller browsers.
function musicAssistantConfig(){const p=dbStore.getPreference("musicassistant.config",{})||{};const url=serviceUrl(p.url||process.env.MUSIC_ASSISTANT_URL||"http://127.0.0.1:8095", ["music-assistant", "music-assistant-server"]).replace(/\/$/,"");let host="127.0.0.1";try{host=new URL(url).hostname||host}catch{};return {url,tvBridgeEnabled:p.tvBridgeEnabled!==false,sendspinHost:serviceHost(p.sendspinHost||host,["music-assistant","music-assistant-server"]),sendspinPort:p.sendspinPort??8927}}
function musicAssistantToken(){try{return String(dbStore.getSecret("musicassistant.token")||"")}catch{return ""}}

const MUSIC_ASSISTANT_TV_DEFAULT_VOLUME=20;
function musicAssistantTvDeviceIdFromPlayerId(playerId){const m=/^classroom-hub-(tv\d+)$/i.exec(String(playerId||""));return m?m[1].toLowerCase():null}
function musicAssistantTvAudioState(deviceId){const all=dbStore.getPreference("musicassistant.tvAudioState",{})||{},saved=all&&typeof all==="object"?all[String(deviceId||"").toLowerCase()]||{}:{};const raw=Number(saved.volume);return {volume:Number.isFinite(raw)?Math.max(0,Math.min(100,raw)):MUSIC_ASSISTANT_TV_DEFAULT_VOLUME,muted:!!saved.muted,updatedAt:saved.updatedAt||null}}
function setMusicAssistantTvAudioState(deviceId,patch={}){deviceId=String(deviceId||"").toLowerCase();const all=dbStore.getPreference("musicassistant.tvAudioState",{})||{},current=musicAssistantTvAudioState(deviceId),next={...current,...patch,updatedAt:new Date().toISOString()};if(patch.volume!==undefined){const n=Number(patch.volume);next.volume=Number.isFinite(n)?Math.max(0,Math.min(100,n)):current.volume}if(patch.muted!==undefined)next.muted=!!patch.muted;dbStore.setPreference("musicassistant.tvAudioState",{...(all&&typeof all==="object"?all:{}),[deviceId]:next});return next}
function musicAssistantTvAttachPayload(deviceId,issued,extra={}){const audio=musicAssistantTvAudioState(deviceId);return {transport:"authenticated-ma-sendspin-proxy",proxyUrl:musicAssistantProxyPath(issued.ticket),playerId:issued.playerId,sdkVersion:"3.2.0",desiredVolume:audio.volume,desiredMuted:audio.muted,...extra}}
async function restoreMusicAssistantTvAudioState(deviceId,ws){const playerId=`classroom-hub-${deviceId}`,desired=musicAssistantTvAudioState(deviceId);for(let attempt=1;attempt<=8;attempt++){if(ws&&ws.readyState!==WebSocket.OPEN)return false;try{await musicAssistantCommand("players/cmd/volume_set",{player_id:playerId,volume_level:desired.volume});await musicAssistantCommand("players/cmd/volume_mute",{player_id:playerId,muted:desired.muted});if(ws)ws.maAudioRestored=true;audit({kind:"musicassistant.tv-audio.restore",deviceId,playerId,volume:desired.volume,muted:desired.muted,attempt});return true}catch(e){if(attempt===8){diagnosticError(e,{component:"music-assistant",operation:"tv-audio-restore",deviceId,playerId});return false}await new Promise(r=>setTimeout(r,700))}}return false}

// Persistent Music Assistant WebSocket API client. Music Assistant's WebSocket API is
// the authoritative realtime control surface; REST remains a compatibility fallback.
let maApiSocket=null,maApiConnectPromise=null,maApiAuthenticated=false,maApiServerInfo=null,maApiLastError=null,maApiLastConnectedAt=null;
const maApiPending=new Map();
function musicAssistantApiWsUrl(){const u=new URL(musicAssistantConfig().url);u.protocol=u.protocol==="https:"?"wss:":"ws:";u.pathname=(u.pathname.replace(/\/$/,"")+"/ws").replace(/\/{2,}/g,"/");u.search="";u.hash="";return u.toString()}
function musicAssistantApiClose(reason="reset"){const ws=maApiSocket;maApiSocket=null;maApiAuthenticated=false;maApiConnectPromise=null;if(ws){try{ws.close(1000,reason)}catch{}}for(const [id,p] of maApiPending){clearTimeout(p.timer);p.reject(new Error(`Music Assistant API disconnected: ${reason}`));maApiPending.delete(id)}}
function musicAssistantApiHandleMessage(raw){let msg;try{msg=JSON.parse(Buffer.isBuffer(raw)?raw.toString("utf8"):String(raw))}catch{return}
  if(msg&&msg.server_id&&msg.schema_version!==undefined&&!msg.message_id){maApiServerInfo=msg;return}
  const mid=msg?.message_id;if(mid&&maApiPending.has(mid)){const p=maApiPending.get(mid);if(msg.partial){if(Array.isArray(msg.result))p.parts.push(...msg.result);else if(msg.result!==undefined)p.parts.push(msg.result);return}clearTimeout(p.timer);maApiPending.delete(mid);if(msg.error_code!==undefined||msg.error){const detail=msg.details||msg.error?.message||msg.error||`Music Assistant API error ${msg.error_code}`;p.reject(new Error(String(detail)));return}let result=msg.result;if(p.parts.length){if(Array.isArray(result))result=[...p.parts,...result];else if(result!==undefined)result=[...p.parts,result];else result=p.parts}p.resolve(result);return}
  // Events are intentionally not returned to callers. The status endpoint refreshes player
  // inventory through this same persistent socket, while the socket stays alive between calls.
}
async function musicAssistantApiRawCommand(command,args={},timeoutMs=15000){await ensureMusicAssistantApi();if(!maApiSocket||maApiSocket.readyState!==WebSocket.OPEN)throw new Error("Music Assistant WebSocket API is not connected");const message_id=`hub-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{maApiPending.delete(message_id);reject(new Error(`Music Assistant command timed out: ${command}`))},timeoutMs);maApiPending.set(message_id,{resolve,reject,timer,parts:[]});try{maApiSocket.send(JSON.stringify({message_id,command,args}))}catch(e){clearTimeout(timer);maApiPending.delete(message_id);reject(e)}})}
async function ensureMusicAssistantApi(){if(maApiSocket&&maApiSocket.readyState===WebSocket.OPEN&&maApiAuthenticated)return maApiSocket;if(maApiConnectPromise)return maApiConnectPromise;const token=musicAssistantToken();if(!token)throw new Error("Music Assistant token is not configured. Create a long-lived token in Music Assistant and save it in Classroom Control Hub Music settings.");maApiConnectPromise=new Promise((resolve,reject)=>{let settled=false,helloSeen=false;const ws=new WebSocket(musicAssistantApiWsUrl());maApiSocket=ws;const fail=(err)=>{maApiLastError=String(err?.message||err);if(!settled){settled=true;reject(err instanceof Error?err:new Error(String(err)))}musicAssistantApiClose("connection-failed")};const auth=()=>{if(!helloSeen||ws.readyState!==WebSocket.OPEN)return;const message_id=`hub-auth-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;const timer=setTimeout(()=>{maApiPending.delete(message_id);fail(new Error("Music Assistant authentication timed out"))},10000);maApiPending.set(message_id,{parts:[],timer,resolve:(result)=>{if(!result)return fail(new Error("Music Assistant authentication was rejected"));maApiAuthenticated=true;maApiLastError=null;maApiLastConnectedAt=new Date().toISOString();if(!settled){settled=true;resolve(ws)}},reject:fail});ws.send(JSON.stringify({message_id,command:"auth",args:{token}}))};ws.on("open",()=>{});ws.on("message",data=>{let parsed=null;try{parsed=JSON.parse(Buffer.isBuffer(data)?data.toString("utf8"):String(data))}catch{};if(parsed&&parsed.server_id&&parsed.schema_version!==undefined&&!parsed.message_id){maApiServerInfo=parsed;helloSeen=true;auth();return}musicAssistantApiHandleMessage(data)});ws.on("error",fail);ws.on("close",(code,reason)=>{maApiSocket=null;maApiAuthenticated=false;maApiConnectPromise=null;const why=`closed ${code}${reason?.length?`: ${reason.toString()}`:""}`;maApiLastError=why;for(const [id,p] of maApiPending){clearTimeout(p.timer);p.reject(new Error(`Music Assistant API ${why}`));maApiPending.delete(id)};if(!settled){settled=true;reject(new Error(`Music Assistant WebSocket API ${why}`))}});setTimeout(()=>{if(!helloSeen&&!settled)fail(new Error("Music Assistant WebSocket did not provide server information"))},10000)}).finally(()=>{maApiConnectPromise=null});return maApiConnectPromise}
async function musicAssistantHttpCommand(command,args={}){const cfg=musicAssistantConfig(),token=musicAssistantToken();const r=await fetch(cfg.url+"/api",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify({message_id:`hub-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,command,args}),signal:AbortSignal.timeout(15000)});const text=await r.text();let j;try{j=JSON.parse(text)}catch{throw Error(`Music Assistant returned HTTP ${r.status}: ${text.slice(0,500)}`)}if(!r.ok||j.error)throw Error(j.error?.message||j.error||`Music Assistant HTTP ${r.status}`);return j.result!==undefined?j.result:j}
async function musicAssistantCommand(command,args={}){try{return await musicAssistantApiRawCommand(command,args)}catch(wsErr){diagnosticError(wsErr,{component:"music-assistant",operation:"websocket-api",command});try{return await musicAssistantHttpCommand(command,args)}catch(httpErr){throw new Error(`Music Assistant command failed over WebSocket (${wsErr.message}) and HTTP (${httpErr.message})`)}}}


// -----------------------------------------------------------------------------
// Background Music — independent daily scheduler + audio priority arbitration
// -----------------------------------------------------------------------------
const BACKGROUND_MUSIC_DEFAULT_SCHEDULE={
  enabled:false,
  startTime:"07:00",
  endTime:"15:00",
  days:[1,2,3,4,5],
  schoolDaysOnly:true,
  playerId:"",
  favoriteId:"",
  volume:20,
  pauseForPriorityAudio:true
};
const backgroundMusicRuntime={
  scheduleActive:false,
  playing:false,
  paused:false,
  pausedForPriority:false,
  manualStopped:false,
  startedKey:null,
  lastAction:null,
  lastActionAt:null,
  lastError:null
};
const backgroundMusicPriorityTargets=new Set();
let backgroundMusicTickBusy=false;

function normalizeBackgroundMusicSchedule(input={},existing={}){
  const days=Array.isArray(input.days)?input.days.map(Number).filter(x=>Number.isInteger(x)&&x>=0&&x<=6):(existing.days||BACKGROUND_MUSIC_DEFAULT_SCHEDULE.days);
  if(input.startTime!==undefined&&!validTime(input.startTime))throw Error("Background Music start time must be a valid HH:MM value");
  if(input.endTime!==undefined&&!validTime(input.endTime))throw Error("Background Music end time must be a valid HH:MM value");
  return {
    ...BACKGROUND_MUSIC_DEFAULT_SCHEDULE,
    ...existing,
    enabled:input.enabled===undefined?(existing.enabled===true):!!input.enabled,
    startTime:validTime(input.startTime)?String(input.startTime):String(existing.startTime||BACKGROUND_MUSIC_DEFAULT_SCHEDULE.startTime),
    endTime:validTime(input.endTime)?String(input.endTime):String(existing.endTime||BACKGROUND_MUSIC_DEFAULT_SCHEDULE.endTime),
    days:[...new Set(days)],
    schoolDaysOnly:input.schoolDaysOnly===undefined?(existing.schoolDaysOnly!==false):!!input.schoolDaysOnly,
    playerId:String(input.playerId===undefined?(existing.playerId||""):input.playerId||"").trim(),
    favoriteId:String(input.favoriteId===undefined?(existing.favoriteId||""):input.favoriteId||"").trim(),
    volume:Math.max(0,Math.min(100,Number(input.volume===undefined?(existing.volume??20):input.volume)||0)),
    pauseForPriorityAudio:input.pauseForPriorityAudio===undefined?(existing.pauseForPriorityAudio!==false):!!input.pauseForPriorityAudio
  };
}
function backgroundMusicSchedule(){return normalizeBackgroundMusicSchedule({},dbStore.getPreference("musicassistant.background.schedule",{})||{})}
function backgroundMusicFavorites(){const x=dbStore.getPreference("musicassistant.background.favorites",[])||[];return Array.isArray(x)?x:[]}
function backgroundMusicFavoriteById(id){return backgroundMusicFavorites().find(x=>String(x.id)===String(id))||null}
function backgroundMusicWindowActive(cfg,now=new Date()){
  if(!cfg.enabled)return false;
  const n=localMinutesNow(now),a=minutesFromHHMM(cfg.startTime),b=minutesFromHHMM(cfg.endTime);
  const scheduleDate=new Date(now);
  if(a>b&&n<b)scheduleDate.setDate(scheduleDate.getDate()-1);
  if(!cfg.days.includes(scheduleDate.getDay()))return false;
  if(isAutomationSuppressed(scheduleDate).blocked)return false;
  if(cfg.schoolDaysOnly&&!schoolCycleForDate(scheduleDate).isStudentSchoolDay)return false;
  return a<=b?(n>=a&&n<b):(n>=a||n<b);
}
function backgroundMusicWindowKey(cfg,now=new Date()){
  // For overnight windows, times after midnight belong to the prior day's start window.
  const a=minutesFromHHMM(cfg.startTime),b=minutesFromHHMM(cfg.endTime),n=localMinutesNow(now);
  const d=new Date(now);
  if(a>b&&n<b)d.setDate(d.getDate()-1);
  return `${localDateKey(d)}@${cfg.startTime}`;
}
function backgroundMusicPriorityState(){return {active:backgroundMusicPriorityTargets.size>0,targets:[...backgroundMusicPriorityTargets]}}
let backgroundMusicPlayerProbe={at:0,playerId:null,state:null,error:null};
async function backgroundMusicActualPlayerState(cfg=backgroundMusicSchedule(),force=false){
  const pid=String(cfg.playerId||"").trim();
  if(!pid)return null;
  const now=Date.now();
  if(!force&&backgroundMusicPlayerProbe.playerId===pid&&(now-backgroundMusicPlayerProbe.at)<4000)return backgroundMusicPlayerProbe.state;
  try{
    let players=[];
    try{players=await musicAssistantCommand("players/all",{return_protocol_players:true})}catch{players=await musicAssistantCommand("players/all",{})}
    players=Array.isArray(players)?players:[];
    const p=players.find(x=>[x?.player_id,x?.playerId,x?.id,x?.provider_id].filter(Boolean).map(String).includes(pid))||null;
    const raw=String(p?.state||p?.playback_state||p?.playbackState||"").toLowerCase();
    const state=p?{found:true,playing:raw==="playing"||p?.is_playing===true||p?.isPlaying===true,paused:raw==="paused",raw,available:p?.available!==false,player:p}: {found:false,playing:false,paused:false,raw:"missing",available:false,player:null};
    backgroundMusicPlayerProbe={at:now,playerId:pid,state,error:null};
    return state;
  }catch(e){
    backgroundMusicPlayerProbe={at:now,playerId:pid,state:null,error:e.message};
    return null;
  }
}
async function backgroundMusicPause(reason="manual"){
  const cfg=backgroundMusicSchedule();if(!cfg.playerId)return false;
  await musicAssistantCommand("players/cmd/pause",{player_id:cfg.playerId});
  backgroundMusicRuntime.playing=false;backgroundMusicRuntime.paused=true;backgroundMusicRuntime.lastAction=`pause:${reason}`;backgroundMusicRuntime.lastActionAt=new Date().toISOString();return true;
}
async function backgroundMusicResume(reason="resume"){
  const cfg=backgroundMusicSchedule();if(!cfg.playerId)return false;
  await musicAssistantCommand("players/cmd/play",{player_id:cfg.playerId});
  backgroundMusicRuntime.playing=true;backgroundMusicRuntime.paused=false;backgroundMusicRuntime.pausedForPriority=false;backgroundMusicRuntime.lastAction=`play:${reason}`;backgroundMusicRuntime.lastActionAt=new Date().toISOString();return true;
}
async function backgroundMusicStop(reason="manual"){
  const cfg=backgroundMusicSchedule();if(cfg.playerId)await musicAssistantCommand("players/cmd/stop",{player_id:cfg.playerId});
  backgroundMusicRuntime.playing=false;backgroundMusicRuntime.paused=false;backgroundMusicRuntime.pausedForPriority=false;backgroundMusicRuntime.lastAction=`stop:${reason}`;backgroundMusicRuntime.lastActionAt=new Date().toISOString();return true;
}
async function backgroundMusicStart({favoriteId=null,playerId=null,reason="manual"}={}){
  const cfg=backgroundMusicSchedule(),pid=String(playerId||cfg.playerId||"").trim(),fav=backgroundMusicFavoriteById(favoriteId||cfg.favoriteId);
  if(!pid)throw new Error("Select a Background Music player first");
  if(!fav?.uri)throw new Error("Select a saved Background Music favorite first");
  await musicAssistantCommand("players/cmd/volume_set",{player_id:pid,volume_level:cfg.volume});
  await musicAssistantCommand("players/cmd/volume_mute",{player_id:pid,muted:false});
  await musicAssistantCommand("player_queues/play_media",{queue_id:pid,media:fav.uri});
  backgroundMusicRuntime.playing=true;backgroundMusicRuntime.paused=false;backgroundMusicRuntime.pausedForPriority=false;backgroundMusicRuntime.manualStopped=false;backgroundMusicRuntime.lastAction=`start:${reason}`;backgroundMusicRuntime.lastActionAt=new Date().toISOString();backgroundMusicRuntime.lastError=null;
  return {playerId:pid,favorite:fav};
}
async function backgroundMusicReconcilePriority(){
  const cfg=backgroundMusicSchedule();
  if(!cfg.pauseForPriorityAudio)return;
  const priority=backgroundMusicPriorityTargets.size>0;
  if(priority&&backgroundMusicRuntime.scheduleActive&&backgroundMusicRuntime.playing){
    try{await backgroundMusicPause("priority-audio");backgroundMusicRuntime.pausedForPriority=true}catch(e){backgroundMusicRuntime.lastError=e.message}
  }else if(!priority&&backgroundMusicRuntime.scheduleActive&&backgroundMusicRuntime.pausedForPriority&&!backgroundMusicRuntime.manualStopped){
    try{await backgroundMusicResume("priority-ended")}catch(e){backgroundMusicRuntime.lastError=e.message}
  }
}
function backgroundMusicObserveDisplayCommand(command,source="api"){
  const src=String(source||command?.source||"");
  const p=command?.payload||{},kind=String(p.contentKind||"");
  const eligible=src==="automation"||kind==="morning-announcements";
  if(!eligible)return;
  let targets=[];try{targets=resolveDisplayTargets(command.target)}catch{return}
  const type=String(command.type||"");
  let startsAudio=false,replacesAudio=false;
  if(type==="display.video"){replacesAudio=true;startsAudio=p.muted!==true}
  else if(type==="display.web"){replacesAudio=true;startsAudio=p.forceAudio===true||p.muted===false||kind==="morning-announcements"}
  else if(type==="display.web.audio"){startsAudio=p.unmute!==false}
  else if(type.startsWith("voice.")||type.startsWith("sfx.")){startsAudio=true}
  else if(["display.clear","display.image","display.pdf","display.document","display.presentation"].includes(type)){replacesAudio=true}
  if(replacesAudio)for(const id of targets){
    const announcementOwnsTarget=morningAnnouncementsRuntime.active&&(morningAnnouncementsRuntime.targets||[]).includes(id);
    if(!announcementOwnsTarget)backgroundMusicPriorityTargets.delete(id);
  }
  if(startsAudio)for(const id of targets)backgroundMusicPriorityTargets.add(id);
  backgroundMusicReconcilePriority().catch(()=>{});
}
async function backgroundMusicTick(){
  if(backgroundMusicTickBusy)return;backgroundMusicTickBusy=true;
  try{
    const cfg=backgroundMusicSchedule(),now=new Date(),active=backgroundMusicWindowActive(cfg,now),key=backgroundMusicWindowKey(cfg,now);
    if(!active){
      if(backgroundMusicRuntime.scheduleActive||backgroundMusicRuntime.startedKey){try{await backgroundMusicStop("schedule-ended")}catch(e){backgroundMusicRuntime.lastError=e.message}}
      backgroundMusicRuntime.scheduleActive=false;backgroundMusicRuntime.manualStopped=false;backgroundMusicRuntime.startedKey=null;return;
    }
    backgroundMusicRuntime.scheduleActive=true;
    if(backgroundMusicRuntime.startedKey!==key){backgroundMusicRuntime.startedKey=key;backgroundMusicRuntime.manualStopped=false}
    if(backgroundMusicRuntime.manualStopped)return;
    if(cfg.pauseForPriorityAudio&&backgroundMusicPriorityTargets.size){
      if(backgroundMusicRuntime.playing){await backgroundMusicPause("priority-audio");backgroundMusicRuntime.pausedForPriority=true}
      return;
    }

    // Reconcile against Music Assistant itself instead of trusting only the
    // process-local runtime flag. A display/player reconnect can leave MA idle
    // while Classroom Control Hub still remembers playing=true. This also works when
    // the configured Background Music player is a MA group rather than the
    // individual TV player that just reconnected.
    const actual=await backgroundMusicActualPlayerState(cfg);
    if(actual?.found){
      if(actual.playing){
        backgroundMusicRuntime.playing=true;
        backgroundMusicRuntime.paused=false;
        backgroundMusicRuntime.pausedForPriority=false;
      }else if(!backgroundMusicRuntime.manualStopped&&!backgroundMusicRuntime.pausedForPriority){
        backgroundMusicRuntime.playing=false;
        backgroundMusicRuntime.paused=false;
      }
    }

    if(!backgroundMusicRuntime.playing&&!backgroundMusicRuntime.paused){
      await backgroundMusicStart({reason:actual?.found?"schedule-player-idle":"schedule"});
      backgroundMusicPlayerProbe.at=0;
    }else if(backgroundMusicRuntime.pausedForPriority){
      await backgroundMusicResume("priority-ended");
      backgroundMusicPlayerProbe.at=0;
    }
  }catch(e){backgroundMusicRuntime.lastError=e.message;diagnosticError(e,{component:"background-music",operation:"schedule-tick"})}
  finally{backgroundMusicTickBusy=false}
}

app.get("/api/v1/music-assistant/background",requireControl,async(_req,res)=>{const cfg=backgroundMusicSchedule();const actualPlayer=await backgroundMusicActualPlayerState(cfg,true).catch(()=>null);res.json({ok:true,schedule:cfg,favorites:backgroundMusicFavorites(),runtime:{...backgroundMusicRuntime,priority:backgroundMusicPriorityState(),actualPlayer,playerProbeError:backgroundMusicPlayerProbe.error}})});
app.put("/api/v1/music-assistant/background/schedule",requireControl,(req,res)=>{try{const cfg=normalizeBackgroundMusicSchedule(req.body||{},backgroundMusicSchedule());dbStore.setPreference("musicassistant.background.schedule",cfg);backgroundMusicRuntime.lastError=null;audit({kind:"musicassistant.background.schedule.update",enabled:cfg.enabled,startTime:cfg.startTime,endTime:cfg.endTime,playerId:cfg.playerId,favoriteId:cfg.favoriteId});backgroundMusicTick().catch(()=>{});res.json({ok:true,schedule:cfg})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post("/api/v1/music-assistant/background/favorites",requireControl,(req,res)=>{try{const uri=String(req.body?.uri||"").trim(),name=String(req.body?.name||"").trim(),detail=String(req.body?.detail||"").trim();if(!uri||!name)return res.status(400).json({ok:false,error:"Favorite name and media URI are required"});const list=backgroundMusicFavorites(),existing=list.find(x=>x.uri===uri);if(existing){existing.name=name;existing.detail=detail}else list.push({id:`bgm-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,name,uri,detail,createdAt:new Date().toISOString()});dbStore.setPreference("musicassistant.background.favorites",list.slice(-100));res.json({ok:true,favorites:list})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.delete("/api/v1/music-assistant/background/favorites/:id",requireControl,(req,res)=>{const id=String(req.params.id||""),list=backgroundMusicFavorites().filter(x=>String(x.id)!==id);dbStore.setPreference("musicassistant.background.favorites",list);const cfg=backgroundMusicSchedule();if(cfg.favoriteId===id){cfg.favoriteId="";dbStore.setPreference("musicassistant.background.schedule",cfg)}res.json({ok:true,favorites:list})});
app.post("/api/v1/music-assistant/background/control",requireControl,async(req,res)=>{try{const action=String(req.body?.action||"");if(action==="play"){const r=await backgroundMusicStart({favoriteId:req.body?.favoriteId,playerId:req.body?.playerId,reason:"manual"});return res.json({ok:true,action,...r})}if(action==="pause"){await backgroundMusicPause("manual");backgroundMusicRuntime.manualStopped=true;return res.json({ok:true,action})}if(action==="stop"){await backgroundMusicStop("manual");backgroundMusicRuntime.manualStopped=true;return res.json({ok:true,action})}if(action==="resume"){backgroundMusicRuntime.manualStopped=false;await backgroundMusicResume("manual");return res.json({ok:true,action})}return res.status(400).json({ok:false,error:"Unknown Background Music action"})}catch(e){res.status(502).json({ok:false,error:e.message})}});

// Appliance-wide budgets keep polling separate from configuration/attachment writes.
// Fixed keys prevent forwarding headers or rotating addresses from multiplying quotas.
const musicAssistantStatusLimit=rateLimit({
  windowMs:60_000,limit:120,keyGenerator:()=>"music-assistant-status",
  standardHeaders:"draft-8",legacyHeaders:false,
  message:{ok:false,error:"Music Assistant status polling limit reached; retry later"}
});
const musicAssistantMutationLimit=rateLimit({
  windowMs:60_000,limit:30,keyGenerator:()=>"music-assistant-mutations",
  standardHeaders:"draft-8",legacyHeaders:false,
  message:{ok:false,error:"Music Assistant configuration/attachment limit reached; retry later"}
});
app.get("/api/v1/music-assistant/status",musicAssistantStatusLimit,requireControl,async(_req,res)=>{const cfg=musicAssistantConfig(),configured=!!musicAssistantToken();try{let players=[];if(configured){try{players=await musicAssistantCommand("players/all",{return_protocol_players:true})}catch{players=await musicAssistantCommand("players/all",{})}}players=Array.isArray(players)?players:[];const playerIds=new Set(players.flatMap(p=>[p?.player_id,p?.id,p?.provider_id].filter(Boolean).map(String)));const bridgeStatus=Object.fromEntries(Object.entries(runtime.displays||{}).map(([id,v])=>{const m=v?.musicAssistant||null;if(!m)return [id,null];const keys=[m.clientId].filter(Boolean).map(String);return [id,{...m,registered:keys.some(k=>playerIds.has(k))}]}));res.json({ok:true,configured,url:cfg.url,tvBridgeEnabled:cfg.tvBridgeEnabled,sendspinBaseUrl:sendspinEndpoint(cfg).replace(/^ws:/,"http:").replace(/\/sendspin$/,""),sendspinWebSocket:sendspinEndpoint(cfg),upstreamTransport:"dedicated-sendspin",sdkIdentity:"music-assistant-stable-2.9-compatible-sendspin-js-3.2.0",transport:"authenticated-ma-sendspin-proxy",apiTransport:maApiAuthenticated?"persistent-websocket":"http-fallback",apiServerInfo:maApiServerInfo,apiLastConnectedAt:maApiLastConnectedAt,apiLastError:maApiLastError,attachedTargets:dbStore.getPreference("musicassistant.tvBridgeTargets",[])||[],tvDefaultVolume:MUSIC_ASSISTANT_TV_DEFAULT_VOLUME,tvAudioState:dbStore.getPreference("musicassistant.tvAudioState",{})||{},bridgeStatus,online:configured,players})}catch(e){res.json({ok:true,configured,url:cfg.url,tvBridgeEnabled:cfg.tvBridgeEnabled,online:false,error:e.message,players:[]})}});
app.put("/api/v1/music-assistant/config",musicAssistantMutationLimit,requireAdmin,(req,res)=>{try{const current=musicAssistantConfig(),url=String(req.body?.url||current.url).trim().replace(/\/$/,"");if(!/^https?:\/\//i.test(url))return res.status(400).json({ok:false,error:"Music Assistant URL must begin with http:// or https://"});const prior=musicAssistantConfig(),next={url,tvBridgeEnabled:req.body?.tvBridgeEnabled!==false,sendspinHost:String(req.body?.sendspinHost??prior.sendspinHost),sendspinPort:req.body?.sendspinPort??prior.sendspinPort??8927};sendspinEndpoint(next);dbStore.setPreference("musicassistant.config",next);if(req.body?.token)dbStore.putSecret("musicassistant.token",String(req.body.token),{integration:"Music Assistant",type:"long-lived-access-token"});musicAssistantApiClose("configuration-changed");audit({kind:"musicassistant.config.update",url});res.json({ok:true,url,tokenStored:!!musicAssistantToken()})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post("/api/v1/music-assistant/command",requireControl,async(req,res)=>{try{const command=String(req.body?.command||""),args=req.body?.args||{};const allowed=new Set(["players/all","players/cmd/play_pause","players/cmd/play","players/cmd/pause","players/cmd/stop","players/cmd/volume_set","players/cmd/volume_mute","player_queues/all","player_queues/items","player_queues/play_media","music/search","music/recently_played_items"]);if(!allowed.has(command))return res.status(400).json({ok:false,error:"Music Assistant command is not approved by Classroom Control Hub"});const result=await musicAssistantCommand(command,args);const tvId=musicAssistantTvDeviceIdFromPlayerId(args.player_id);if(tvId&&command==="players/cmd/volume_set")setMusicAssistantTvAudioState(tvId,{volume:args.volume_level});if(tvId&&command==="players/cmd/volume_mute")setMusicAssistantTvAudioState(tvId,{muted:args.muted});audit({kind:"musicassistant.command",command});res.json({ok:true,result})}catch(e){res.status(502).json({ok:false,error:e.message})}});
const musicAssistantProxyTickets=new Map();
function issueMusicAssistantProxyTicket(deviceId){const ticket=crypto.randomBytes(24).toString("base64url"),playerId=`classroom-hub-${cleanId(deviceId)}`;musicAssistantProxyTickets.set(ticket,{deviceId:cleanId(deviceId),playerId,expiresAt:Date.now()+60000});return {ticket,playerId}}
function consumeMusicAssistantProxyTicket(ticket){const item=musicAssistantProxyTickets.get(String(ticket||""));musicAssistantProxyTickets.delete(String(ticket||""));if(!item||item.expiresAt<Date.now())return null;return item}
function musicAssistantProxyPath(ticket){return `/music-assistant/sendspin-proxy?ticket=${encodeURIComponent(ticket)}`}
app.post("/api/v1/music-assistant/tv-bridge",musicAssistantMutationLimit,requireControl,async(req,res)=>{try{const cfg=musicAssistantConfig(),token=musicAssistantToken();if(!token)return res.status(409).json({ok:false,error:"Configure the Music Assistant token first"});const targets=resolveDisplayTargets(req.body?.targets||req.body?.target||[]);const action=String(req.body?.action||"attach");let attached=dbStore.getPreference("musicassistant.tvBridgeTargets",[])||[];attached=Array.isArray(attached)?attached:[];if(action==="detach")attached=attached.filter(x=>!targets.includes(x));else attached=[...new Set([...attached,...targets])];dbStore.setPreference("musicassistant.tvBridgeTargets",attached);const deliveries=[];if(action==="detach"){const result=await executeCommand({type:"music.assistant.detach",target:targets,payload:{}},"music-assistant-bridge");deliveries.push(...(result.deliveries?.websocket||[]))}else{for(const target of targets){const issued=issueMusicAssistantProxyTicket(target);const result=await executeCommand({type:"music.assistant.attach",target,payload:musicAssistantTvAttachPayload(target,issued)},"music-assistant-bridge");deliveries.push(...(result.deliveries?.websocket||[]))}}res.json({ok:true,action,attachedTargets:attached,deliveries,musicAssistantUrl:cfg.url,note:"Ticketed Hub bridge: the backend relays raw Sendspin to the dedicated configured endpoint (normally port 8927). The long-lived token is used only by the separate Music Assistant control API."})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.get("/api/v1/database/status",requireAdmin,(_req,res)=>{res.json({ok:true,database:dbStore.databaseInfo(),secrets:dbStore.listSecrets(),certificates:dbStore.listCertificates()})});
app.get("/api/v1/database/schema",requireAdmin,(_req,res)=>{const info=dbStore.databaseInfo();res.json({ok:true,schemaVersion:info.schemaVersion,normalized:info.normalized,migrations:dbStore.db.prepare("SELECT version,name,applied_at appliedAt FROM schema_migrations ORDER BY version").all()})});
app.get("/api/v1/database/telemetry",requireAdmin,(req,res)=>{const limit=Math.max(1,Math.min(5000,Number(req.query.limit||500)));res.json({ok:true,count:dbStore.databaseInfo().telemetry||0,telemetry:dbStore.telemetryState(limit)})});
app.get("/api/v1/database/audit",requireAdmin,(req,res)=>{res.json({ok:true,events:dbStore.recentAudit(req.query.limit||250,{kind:req.query.kind||null})})});

app.get("/api/v1/diagnostics",requireCapability("diagnostics.read"),async(_req,res)=>{
  try{res.json(await buildDiagnosticsSnapshot())}
  catch(err){diagnosticError(err,{component:"diagnostics",operation:"snapshot"});res.status(500).json({ok:false,error:err.message})}
});

app.get("/api/v1/diagnostics/events",requireCapability("diagnostics.read"),(req,res)=>{
  res.json({ok:true,events:diagnosticsEventSlice({
    limit:req.query.limit||500,
    kind:req.query.kind||null,
    errorsOnly:String(req.query.errorsOnly||"false")==="true"
  })});
});

app.get("/api/v1/diagnostics/export",requireAdmin,async(_req,res)=>{
  try{
    const snapshot=await buildDiagnosticsSnapshot();
    res.setHeader("Content-Disposition",`attachment; filename="classroom-hub-diagnostics-${new Date().toISOString().replace(/[:.]/g,"-")}.json"`);
    res.type("application/json").send(JSON.stringify(snapshot,null,2));
  }catch(err){res.status(500).json({ok:false,error:err.message})}
});

app.post("/api/v1/diagnostics/test",requireCapability("diagnostics.run"),async(req,res)=>{
  const test=String(req.body?.test||"all");
  const results={};
  const perform=async(name,fn)=>{
    const started=Date.now();
    try{results[name]={ok:true,durationMs:Date.now()-started,result:diagnosticSanitize(await fn())}}
    catch(err){results[name]={ok:false,durationMs:Date.now()-started,error:err.message};diagnosticError(err,{component:"diagnostics.test",operation:name})}
  };

  if(test==="all"||test==="hub")await perform("hub",async()=>({version:APPLICATION_VERSION,uptime:process.uptime()}));
  if(test==="all"||test==="mqtt")await perform("mqtt",async()=>{
    if(!runtime.mqtt.connected)throw new Error("MQTT is not connected");
    return {connected:true,url:MQTT_URL};
  });
  if(test==="all"||test==="pluto")await perform("pluto",async()=>directPluto({action:"raw",body:{comhead:"get video status"}}));
  if(test==="all"||test==="veyon")await perform("veyon",async()=>{
    const r=await veyonFetch("/",{timeoutMs:3000});
    return {httpStatus:r.status,url:VEYON_WEBAPI_URL,poolSize:veyonConnectionCache.size,poolMax:VEYON_POOL_MAX};
  });
  if(test==="all"||test==="displays")await perform("displays",async()=>{
    const status=publicRuntime().displays;
    return {configured:Object.keys(status).length,online:Object.values(status).filter(x=>x.online).length,status};
  });
  if(test==="all"||test==="scheduler")await perform("scheduler",async()=>({
    ...schedulerStatus(),classes:classScheduleStore.classes.length,automations:classroomAutomations.events.length
  }));

  audit({kind:"diagnostics.test",test,results:diagnosticSanitize(results)});
  res.json({ok:Object.values(results).every(x=>x.ok),test,results});
});


// -----------------------------------------------------------------------------
// v0.6 Session API
// -----------------------------------------------------------------------------
app.use("/api/v1/sessions",(req,res,next)=>{
  // The legacy participation API trusted caller-supplied student/session IDs
  // and is intentionally retired until signed, teacher-created sessions exist.
  return res.status(410).json({ok:false,error:"Legacy anonymous classroom participation has been retired"});
});
app.get("/api/v1/sessions/:id", (req,res) => {
  const session=getSession(req.params.id);
  res.json({ok:true,state:publicSessionState(session)});
});

app.post("/api/v1/sessions/:id/join", (req,res) => {
  const session=getSession(req.params.id);
  const studentId=cleanId(req.body?.studentId) || crypto.randomUUID();
  const name=cleanShort(req.body?.name || "Student",40);
  if (!session.students[studentId]) session.stats.joins=(session.stats.joins||0)+1;
  session.students[studentId]={
    id:studentId,
    name,
    joinedAt:session.students[studentId]?.joinedAt || new Date().toISOString(),
    lastSeen:new Date().toISOString()
  };
  session.updatedAt=new Date().toISOString();
  persistSessions();
  broadcastSession(session.id,{type:"session.state",state:publicSessionState(session)});
  res.json({ok:true,studentId,state:publicSessionState(session)});
});

app.post("/api/v1/sessions/:id/topic", (req,res) => {
  const session=getSession(req.params.id),studentId=cleanId(req.body?.studentId),topic=cleanId(req.body?.topic);
  if (!studentId || !OPENING_TOPICS[topic]) return res.status(400).json({ok:false,error:"studentId and valid topic required"});
  if (!allowStudentEvent(session,studentId,650)) return res.status(429).json({ok:false,error:"Please wait a moment before sending another room interaction."});
  session.topicVotes[studentId]=topic;
  session.stats.events=(session.stats.events||0)+1;
  session.updatedAt=new Date().toISOString();
  enqueueSessionEffect(session,{kind:"topic",topic});
  res.json({ok:true,state:publicSessionState(session),topic:OPENING_TOPICS[topic]});
});

app.post("/api/v1/sessions/:id/intro", (req,res) => {
  const session=getSession(req.params.id),studentId=cleanId(req.body?.studentId);
  if (!studentId) return res.status(400).json({ok:false,error:"studentId required"});
  if (!allowStudentEvent(session,studentId,1000)) return res.status(429).json({ok:false,error:"Please wait a moment before submitting again."});
  const intro={
    preferredName:cleanShort(req.body?.preferredName,40),
    color:validHexColor(req.body?.color),
    colorName:cleanShort(req.body?.colorName,30),
    activity:cleanShort(req.body?.activity,70),
    interest:cleanShort(req.body?.interest,70),
    goal:cleanShort(req.body?.goal,160)
  };
  session.responses[studentId]={...(session.responses[studentId]||{}),intro};
  if (!session.spotlights) session.spotlights={};
  if (!session.spotlightOrder) session.spotlightOrder=[];
  session.spotlights[studentId]={
    studentId,
    name:intro.preferredName || session.students[studentId]?.name || "Student",
    color:intro.color,
    colorName:intro.colorName,
    activity:intro.activity,
    interest:intro.interest
  };
  if (!session.spotlightOrder.includes(studentId)) session.spotlightOrder.push(studentId);
  session.stats.events=(session.stats.events||0)+1;
  session.updatedAt=new Date().toISOString();
  session.queue=(session.queue||[]).filter(x=>!(x.kind==="student-intro"&&x.studentId===studentId));
  enqueueSessionEffect(session,{kind:"student-intro",...session.spotlights[studentId]});
  res.json({ok:true,state:publicSessionState(session)});
});

app.post("/api/v1/sessions/:id/poll", (req,res) => {
  const session=getSession(req.params.id),studentId=cleanId(req.body?.studentId),questionId=cleanId(req.body?.questionId);
  const answer=cleanShort(req.body?.answer,100),title=cleanShort(req.body?.title || questionId,80);
  if (!studentId || !questionId || !answer) return res.status(400).json({ok:false,error:"studentId, questionId and answer required"});
  if (!allowStudentEvent(session,studentId,350)) return res.status(429).json({ok:false,error:"Please wait a moment before answering again."});
  if (!session.responses.polls) session.responses.polls={};
  if (!session.responses.polls[questionId]) session.responses.polls[questionId]={};
  session.responses.polls[questionId][studentId]=answer;
  const tallies={};
  for (const a of Object.values(session.responses.polls[questionId])) tallies[a]=(tallies[a]||0)+1;
  session.stats.events=(session.stats.events||0)+1;
  session.updatedAt=new Date().toISOString();
  // Coalesce this question's poll display into one latest queue item.
  session.queue=(session.queue||[]).filter(x=>!(x.kind==="poll"&&x.questionId===questionId));
  enqueueSessionEffect(session,{kind:"poll",questionId,title,tallies});
  res.json({ok:true,tallies,state:publicSessionState(session)});
});

app.post("/api/v1/sessions/:id/light", (req,res) => {
  const session=getSession(req.params.id),studentId=cleanId(req.body?.studentId);
  if (!studentId) return res.status(400).json({ok:false,error:"studentId required"});
  if (!allowStudentEvent(session,studentId,800)) return res.status(429).json({ok:false,error:"Please wait a moment before changing the room color again."});
  const color=validHexColor(req.body?.color);
  const colorName=cleanShort(req.body?.colorName || color,30);
  const name=session.students?.[studentId]?.name || "Student";
  session.queue=(session.queue||[]).filter(x=>!(x.kind==="light-color"&&x.studentId===studentId));
  enqueueSessionEffect(session,{kind:"light-color",studentId,name,color,colorName});
  session.stats.events=(session.stats.events||0)+1;
  persistSessions();
  res.json({ok:true,state:publicSessionState(session)});
});

app.post("/api/v1/sessions/:id/game", (req,res) => {
  const session=getSession(req.params.id),studentId=cleanId(req.body?.studentId),questionId=cleanId(req.body?.questionId);
  const team=cleanShort(req.body?.team,40),correct=!!req.body?.correct;
  if (!studentId || !questionId || !team) return res.status(400).json({ok:false,error:"studentId, questionId and team required"});
  if (!session.responses.game) session.responses.game={};
  if (!session.responses.game[questionId]) session.responses.game[questionId]={};
  if (!(studentId in session.responses.game[questionId])) {
    session.responses.game[questionId][studentId]=correct;
    if (correct) session.gameScores[team]=(session.gameScores[team]||0)+1;
  }
  session.stats.events=(session.stats.events||0)+1;
  session.queue=(session.queue||[]).filter(x=>x.kind!=="scoreboard");
  enqueueSessionEffect(session,{kind:"scoreboard",scores:session.gameScores});
  res.json({ok:true,scores:session.gameScores,state:publicSessionState(session)});
});


app.get("/api/v1/sessions/:id/export.json", requireControl, (req,res) => {
  const session=getSession(req.params.id);
  res.setHeader("Content-Disposition", `attachment; filename="${session.id}-session.json"`);
  res.json({
    session:{
      id:session.id,
      name:session.name,
      createdAt:session.createdAt,
      updatedAt:session.updatedAt
    },
    students:session.students || {},
    introductions:Object.fromEntries(
      Object.entries(session.responses || {})
        .filter(([k,v]) => k !== "polls" && k !== "game" && v?.intro)
        .map(([k,v]) => [k,v.intro])
    ),
    polls:session.responses?.polls || {},
    gameResponses:session.responses?.game || {},
    gameScores:session.gameScores || {},
    topicVotes:session.topicVotes || {},
    spotlights:session.spotlights || {},
    recentEffects:session.recentEffects || []
  });
});

app.get("/api/v1/sessions/:id/export.csv", requireControl, (req,res) => {
  const session=getSession(req.params.id);
  const rows=[[
    "student_id","name","preferred_name","favorite_color_hex","favorite_color_name",
    "favorite_activity","it_interest","learning_goal","joined_at","last_seen","team_score_data"
  ]];
  for (const [studentId,student] of Object.entries(session.students || {})) {
    const intro=session.responses?.[studentId]?.intro || {};
    rows.push([
      studentId,
      student.name || "",
      intro.preferredName || "",
      intro.color || "",
      intro.colorName || "",
      intro.activity || "",
      intro.interest || "",
      intro.goal || "",
      student.joinedAt || "",
      student.lastSeen || "",
      JSON.stringify(session.gameScores || {})
    ]);
  }
  const csv=rows.map(r=>r.map(csvCell).join(",")).join("\n");
  res.setHeader("Content-Type","text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${session.id}-student-introductions.csv"`);
  res.send(csv);
});

app.post("/api/v1/sessions/:id/teacher/light-test", requireControl, async (req,res) => {
  try {
    const color=validHexColor(req.body?.color || "#ff0000");
    const result=await applySessionLighting(color);
    res.json({ok:true,color,result});
  } catch (err) {
    res.status(502).json({ok:false,error:err.message});
  }
});


app.post("/api/v1/classroom/clear-all", requireControl, async (_req,res) => {
  try {
    const clearedSessions=[];

    for (const session of Object.values(classroomSessions)) {
      session.paused=true;
      session.queue=[];
      session.currentEffect=null;
      session.spotlightRotation=false;
      session.updatedAt=new Date().toISOString();
      clearedSessions.push(session.id);
      broadcastSession(session.id,{type:"session.state",state:publicSessionState(session)});
    }

    persistSessions();

    // Master classroom clear is an eight-display operation. Resolve the
    // configured `all` display group at runtime so disabled/renamed devices are
    // respected and every enabled classroom receiver is blanked immediately.
    const clearedDisplays=resolveDisplayTargets("all");
    const displayResult=await executeCommand({type:"display.clear",target:"all",payload:{}}, "classroom-clear");

    audit({
      kind:"classroom.clear-all",
      sessions:clearedSessions,
      targets:clearedDisplays,
      deliveries:displayResult.deliveries
    });

    res.json({
      ok:true,
      message:`Classroom cleared on ${clearedDisplays.length} display(s); all session queues paused.`,
      clearedSessions,
      targets:clearedDisplays,
      displayResult
    });
  } catch (err) {
    res.status(500).json({ok:false,error:err.message});
  }
});

app.post("/api/v1/classroom/resume-sessions", requireControl, (_req,res) => {
  const resumed=[];
  for (const session of Object.values(classroomSessions)) {
    session.paused=false;
    session.spotlightRotation=true;
    session.updatedAt=new Date().toISOString();
    resumed.push(session.id);
    broadcastSession(session.id,{type:"session.state",state:publicSessionState(session)});
  }
  persistSessions();
  res.json({ok:true,resumed});
});

app.post("/api/v1/sessions/:id/teacher/topic", requireControl, (req,res) => {
  const session=getSession(req.params.id),topic=cleanId(req.body?.topic);
  if (!OPENING_TOPICS[topic]) return res.status(400).json({ok:false,error:"Unknown topic"});
  enqueueSessionEffect(session,{kind:"topic",topic});
  res.json({ok:true,state:publicSessionState(session)});
});

app.post("/api/v1/sessions/:id/teacher/effect", requireControl, (req,res) => {
  const session=getSession(req.params.id);
  enqueueSessionEffect(session,{kind:"teacher",title:cleanShort(req.body?.title,80),subtitle:cleanShort(req.body?.subtitle,100),body:cleanShort(req.body?.body,500),color:validHexColor(req.body?.color)});
  res.json({ok:true,state:publicSessionState(session)});
});

app.post("/api/v1/sessions/:id/teacher/control", requireControl, (req,res) => {
  const session=getSession(req.params.id),action=cleanId(req.body?.action);
  if (action==="pause") session.paused=true;
  else if (action==="resume") session.paused=false;
  else if (action==="clear") session.queue=[];
  else if (action==="spotlight-on") session.spotlightRotation=true;
  else if (action==="spotlight-off") session.spotlightRotation=false;
  else if (action==="dashboard") {
    showClassDashboard(session).catch(err=>audit({kind:"session.dashboard.error",error:err.message}));
  }
  else if (action==="reset") {
    classroomSessions[session.id]={...getSession(session.id),students:{},responses:{},topicVotes:{},gameScores:{},queue:[],recentEffects:[],currentEffect:null,spotlights:{},spotlightOrder:[],spotlightIndex:0,spotlightRotation:true,stats:{joins:0,events:0},updatedAt:new Date().toISOString()};
  }
  persistSessions();
  res.json({ok:true,state:publicSessionState(getSession(session.id))});
});



// Lab Computer Management API

// Veyon-powered Lab Computers API
app.get("/api/v1/veyon/status",requireCapability("lab.read"),async(_req,res)=>{
  try{
    const response=await veyonFetch("/");
    res.json({ok:true,webapi:true,httpStatus:response.status,url:VEYON_WEBAPI_URL,keyName:VEYON_KEY_NAME,keyFileReadable:dbStore.hasSecret("veyon.private-key")||fs.existsSync(VEYON_PRIVATE_KEY_FILE),scanSubnet:VEYON_SCAN_SUBNET,pool:{size:veyonConnectionCache.size,max:VEYON_POOL_MAX}});
  }catch(err){
    res.status(503).json({ok:false,webapi:false,error:err.message,url:VEYON_WEBAPI_URL,keyName:VEYON_KEY_NAME,keyFileReadable:dbStore.hasSecret("veyon.private-key")||fs.existsSync(VEYON_PRIVATE_KEY_FILE)});
  }
});
app.get("/api/v1/veyon/computers",requireCapability("lab.read"),async(req,res)=>{
  try{
    const includeInfo=String(req.query.info||"1")!=="0";
    const records=Object.values(veyonComputerStore.computers);
    const computers=await mapLimit(records,10,rec=>veyonStatusFor(rec,{includeInfo}));
    computers.sort((a,b)=>String(a.name||a.ip).localeCompare(String(b.name||b.ip),undefined,{numeric:true}));
    res.json({ok:true,computers,summary:{
      total:computers.length,
      online:computers.filter(x=>x.online).length,
      authenticated:computers.filter(x=>x.authenticated).length,
      students:computers.filter(x=>x.role!=="teacher").length,
      teachers:computers.filter(x=>x.role==="teacher").length
    }});
  }catch(err){res.status(500).json({ok:false,error:err.message})}
});
app.post("/api/v1/veyon/discover",requireCapability("lab.control"),async(req,res)=>{
  try{
    const computers=await veyonDiscover(req.body||{});
    res.json({ok:true,computers,summary:{found:computers.length,authenticated:computers.filter(x=>x.authenticated).length}});
  }catch(err){res.status(500).json({ok:false,error:err.message})}
});
app.post("/api/v1/veyon/computers",requireCapability("lab.control"),(req,res)=>{
  try{
    const ip=String(req.body?.ip||"").trim();
    if(!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip))throw new Error("Valid IPv4 address required");
    const role=req.body?.role==="teacher"?"teacher":"student";
    res.json({ok:true,computer:upsertVeyonComputer(ip,{name:String(req.body?.name||ip).slice(0,120),hostname:String(req.body?.hostname||"").slice(0,120),role})});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.put("/api/v1/veyon/computers/:id",requireCapability("lab.control"),(req,res)=>{
  try{
    const id=veyonComputerId(req.params.id),rec=veyonComputerStore.computers[id];
    if(!rec)return res.status(404).json({ok:false,error:"Computer not found"});
    const patch={name:String(req.body?.name||rec.name).slice(0,120)};
    if(req.body?.role==="teacher"||req.body?.role==="student")patch.role=req.body.role;
    res.json({ok:true,computer:upsertVeyonComputer(rec.ip,patch)});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.post("/api/v1/veyon/computers/role",requireCapability("lab.control"),(req,res)=>{
  try{
    const ids=Array.isArray(req.body?.ids)?req.body.ids:[];
    const role=req.body?.role;
    if(!["teacher","student"].includes(role))throw new Error("Role must be teacher or student");
    const updated=[];
    for(const rawId of ids){
      const id=veyonComputerId(rawId),rec=veyonComputerStore.computers[id];
      if(rec)updated.push(upsertVeyonComputer(rec.ip,{role}));
    }
    res.json({ok:true,updated});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.delete("/api/v1/veyon/computers/:id",requireCapability("lab.control"),(req,res)=>{
  const id=veyonComputerId(req.params.id),rec=veyonComputerStore.computers[id];
  if(!rec)return res.status(404).json({ok:false,error:"Computer not found"});
  delete veyonComputerStore.computers[id];veyonConnectionCache.delete(rec.ip);persistVeyonComputers();
  res.json({ok:true,id});
});
app.get("/api/v1/veyon/computers/:id/info",requireCapability("lab.read"),async(req,res)=>{
  try{
    const rec=veyonComputerStore.computers[veyonComputerId(req.params.id)];
    if(!rec)return res.status(404).json({ok:false,error:"Computer not found"});
    res.json({ok:true,computer:await veyonStatusFor(rec,{includeInfo:true})});
  }catch(err){res.status(502).json({ok:false,error:err.message})}
});
app.get("/api/v1/veyon/computers/:id/framebuffer",requireCapability("lab.sensitive.read"),async(req,res)=>{
  try{
    const rec=veyonComputerStore.computers[veyonComputerId(req.params.id)];
    if(!rec)return res.status(404).json({ok:false,error:"Computer not found"});
    if(rec.online===false)return res.status(409).json({ok:false,error:"Computer is offline"});
    if(rec.authenticated===false)return res.status(409).json({ok:false,error:"Computer is not authenticated"});
    const uid=await veyonAuthenticate(rec.ip);
    const qs=new URLSearchParams();
    qs.set("format",String(req.query.format||"jpeg")==="png"?"png":"jpeg");
    if(req.query.width)qs.set("width",String(Math.max(160,Math.min(3840,Number(req.query.width)||480))));
    if(req.query.height)qs.set("height",String(Math.max(90,Math.min(2160,Number(req.query.height)||270))));
    if(qs.get("format")==="jpeg")qs.set("quality",String(Math.max(20,Math.min(95,Number(req.query.quality)||60))));
    const response=await veyonFetch(`/api/v1/framebuffer?${qs.toString()}`,{headers:{"Connection-Uid":uid},timeoutMs:10000});
    if(!response.ok){
      if(response.status===401)veyonConnectionCache.delete(rec.ip);
      const body=await response.text();return res.status(response.status).send(body);
    }
    res.setHeader("Cache-Control","no-store");
    res.type(qs.get("format")==="png"?"image/png":"image/jpeg");
    const buf=Buffer.from(await response.arrayBuffer());
    res.send(buf);
  }catch(err){res.status(502).json({ok:false,error:err.message})}
});

app.get("/api/v1/veyon/computers/:id/features",requireCapability("lab.read"),async(req,res)=>{
  try{
    const rec=veyonComputerStore.computers[veyonComputerId(req.params.id)];
    if(!rec)return res.status(404).json({ok:false,error:"Computer not found"});
    res.json({ok:true,features:await veyonAvailableFeatures(rec.ip)});
  }catch(err){res.status(502).json({ok:false,error:err.message})}
});
app.get("/api/v1/veyon/computers/:id/feature/:feature",requireCapability("lab.read"),async(req,res)=>{
  try{
    const rec=veyonComputerStore.computers[veyonComputerId(req.params.id)];
    if(!rec)return res.status(404).json({ok:false,error:"Computer not found"});
    res.json({ok:true,feature:req.params.feature,...await veyonFeatureStatus(rec.ip,req.params.feature)});
  }catch(err){res.status(502).json({ok:false,error:err.message})}
});
app.get("/api/v1/veyon/connections",requireCapability("lab.read"),(_req,res)=>{
  const now=Math.floor(Date.now()/1000);
  res.json({ok:true,max:VEYON_POOL_MAX,size:veyonConnectionCache.size,connections:[...veyonConnectionCache.entries()].map(([host,r])=>({
    host,validUntil:r.validUntil,secondsRemaining:Math.max(0,Number(r.validUntil||0)-now),idleSeconds:Math.floor((Date.now()-Number(r.lastUsed||0))/1000)
  }))});
});
app.post("/api/v1/veyon/connections/close",requireCapability("lab.control"),async(req,res)=>{
  try{
    const ids=Array.isArray(req.body?.ids)?req.body.ids:[];
    if(!ids.length||ids.includes("all")){
      for(const [host,rec] of [...veyonConnectionCache.entries()])await veyonCloseConnection(host,rec);
      return res.json({ok:true,closed:"all",poolSize:veyonConnectionCache.size});
    }
    for(const id of ids){const rec=veyonComputerStore.computers[veyonComputerId(id)];if(rec)await veyonCloseConnection(rec.ip)}
    res.json({ok:true,closed:ids.length,poolSize:veyonConnectionCache.size});
  }catch(err){res.status(500).json({ok:false,error:err.message})}
});
app.post("/api/v1/veyon/demo/start",requireCapability("lab.control"),async(req,res)=>{
  try{
    const teacher=veyonComputerStore.computers[veyonComputerId(req.body?.teacherId||"")];
    if(!teacher)throw new Error("Teacher computer not found");
    const students=(Array.isArray(req.body?.studentIds)?req.body.studentIds:[])
      .map(id=>veyonComputerStore.computers[veyonComputerId(id)]).filter(Boolean);
    if(!students.length)throw new Error("At least one student computer is required");
    const mode=req.body?.mode==="window"?"window":"fullscreen";
    const token=require("crypto").randomBytes(24).toString("base64url");
    await veyonFeature(teacher.ip,"demoServer",true,{demoAccessToken:token});
    const clientFeature=mode==="window"?"windowDemoClient":"fullScreenDemoClient";
    const results=await mapLimit(students,6,async rec=>{
      try{
        await veyonFeature(rec.ip,clientFeature,true,{demoAccessToken:token,demoServerHost:teacher.ip});
        return {id:rec.id,ip:rec.ip,ok:true};
      }catch(err){return {id:rec.id,ip:rec.ip,ok:false,error:err.message}}
    });
    res.json({ok:results.every(x=>x.ok),teacherId:teacher.id,teacherIp:teacher.ip,mode,results});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.post("/api/v1/veyon/demo/stop",requireCapability("lab.control"),async(req,res)=>{
  try{
    const teacher=veyonComputerStore.computers[veyonComputerId(req.body?.teacherId||"")];
    const students=(Array.isArray(req.body?.studentIds)?req.body.studentIds:[])
      .map(id=>veyonComputerStore.computers[veyonComputerId(id)]).filter(Boolean);
    const results=await mapLimit(students,6,async rec=>{
      for(const feature of ["fullScreenDemoClient","windowDemoClient"]){try{await veyonFeature(rec.ip,feature,false,{})}catch{}}
      return {id:rec.id,ip:rec.ip,ok:true};
    });
    if(teacher){try{await veyonFeature(teacher.ip,"demoServer",false,{})}catch{}}
    res.json({ok:true,results});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.post("/api/v1/veyon/feature",requireCapability("lab.control"),async(req,res)=>{
  try{
    const targets=Array.isArray(req.body?.targets)?req.body.targets:[req.body?.target].filter(Boolean);
    if(!targets.length)throw new Error("At least one target is required");
    const feature=String(req.body?.feature||""),active=req.body?.active!==false;
    const args=req.body?.arguments&&typeof req.body.arguments==="object"?req.body.arguments:{};
    const selected=[];
    for(const target of targets){
      if(target==="all")selected.push(...Object.values(veyonComputerStore.computers));
      else{const rec=veyonComputerStore.computers[veyonComputerId(target)];if(rec)selected.push(rec)}
    }
    const uniq=[...new Map(selected.map(x=>[x.id,x])).values()];
    const checks=await mapLimit(uniq,6,async rec=>({rec,check:await veyonCommandEligibility(rec,feature,active)}));
    const eligible=checks.filter(x=>x.check.eligible).map(x=>x.rec);
    const skipped=checks.filter(x=>!x.check.eligible).map(({rec,check})=>({
      id:rec.id,ip:rec.ip,name:rec.name||rec.ip,ok:false,skipped:true,reason:check.reason,
      message:check.reason==="offline"?"Skipped — offline":check.reason==="no-user-session"?"Skipped — no logged-in user":`Skipped — ${check.error||check.reason}`
    }));
    const results=await mapLimit(eligible,4,async rec=>{
      try{await veyonFeature(rec.ip,feature,active,args);return {id:rec.id,ip:rec.ip,name:rec.name||rec.ip,ok:true,skipped:false}}
      catch(err){return {id:rec.id,ip:rec.ip,name:rec.name||rec.ip,ok:false,skipped:false,error:err.message}}
    });
    const failed=results.filter(x=>!x.ok);
    res.json({ok:failed.length===0,summary:{
      requested:uniq.length,sent:results.length,succeeded:results.filter(x=>x.ok).length,skipped:skipped.length,failed:failed.length,
      skippedOffline:skipped.filter(x=>x.reason==="offline").length,skippedNoUser:skipped.filter(x=>x.reason==="no-user-session").length
    },results:[...results,...skipped]});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.get("/api/v1/lab/computers",requireCapability("lab.read"),(_req,res)=>res.json(publicLabInventory()));
app.get("/api/v1/lab/computers/:id/history",requireCapability("lab.sensitive.read"),(req,res)=>{
  try{
    const id=cleanLabAgentId(req.params.id);
    if(!labComputerStore.computers[id])return res.status(404).json({ok:false,error:"Lab computer not found"});
    const result=labHistoryQuery(id,req.query||{});
    res.json({ok:true,id,total:result.total,offset:result.offset,limit:result.limit,history:result.items});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.get("/api/v1/lab/computers/:id/history/export",requireCapability("lab.sensitive.read"),(req,res)=>{
  try{
    const id=cleanLabAgentId(req.params.id);
    if(!labComputerStore.computers[id])return res.status(404).json({ok:false,error:"Lab computer not found"});
    const result=labHistoryQuery(id,{...(req.query||{}),limit:5000,offset:0});
    const format=String(req.query?.format||"csv").toLowerCase();
    const safeName=String(labComputerStore.computers[id]?.name||id).replace(/[^a-z0-9._-]+/gi,"-");
    const stamp=new Date().toISOString().replace(/[:.]/g,"-");

    if(format==="json"){
      res.setHeader("Content-Type","application/json; charset=utf-8");
      res.setHeader("Content-Disposition",`attachment; filename="${safeName}-browser-history-${stamp}.json"`);
      return res.send(JSON.stringify({computer:publicLabComputer(id),exportedAt:new Date().toISOString(),filters:req.query||{},history:result.items},null,2));
    }

    const cols=[
      ["URL","url"],["Title","title"],["Visit Time","visitTime"],["Visit Count","visitCount"],
      ["Visited From","visitedFrom"],["Visit Type","visitType"],["Visit Duration","visitDuration"],
      ["Web Browser","browser"],["User Profile","profile"],["Browser Profile","browserProfile"],
      ["URL Length","urlLength"],["Typed Count","typedCount"],["History File","historyFile"],["Record ID","recordId"]
    ];
    const lines=[cols.map(c=>csvCell(c[0])).join(",")];
    for(const row of result.items)lines.push(cols.map(c=>csvCell(row[c[1]])).join(","));
    res.setHeader("Content-Type","text/csv; charset=utf-8");
    res.setHeader("Content-Disposition",`attachment; filename="${safeName}-browser-history-${stamp}.csv"`);
    return res.send("\uFEFF"+lines.join("\r\n"));
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.put("/api/v1/lab/computers/:id",requireCapability("lab.control"),(req,res)=>{
  try{const id=cleanLabAgentId(req.params.id),rec=labComputerStore.computers[id];if(!rec)return res.status(404).json({ok:false,error:"Lab computer not found"});
    if(req.body?.name!==undefined)rec.name=String(req.body.name||"").trim().slice(0,120)||rec.hostname||id;
    if(req.body?.groups!==undefined)rec.groups=[...new Set((Array.isArray(req.body.groups)?req.body.groups:[]).map(x=>String(x).trim().toLowerCase().replace(/[^a-z0-9._-]+/g,"-")).filter(Boolean))].slice(0,20);
    rec.updatedAt=new Date().toISOString();persistLabComputers();res.json({ok:true,computer:publicLabComputer(id)})}
  catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.delete("/api/v1/lab/computers/:id",requireCapability("lab.control"),(req,res)=>{
  try{const id=cleanLabAgentId(req.params.id);if(labOnline(id))return res.status(409).json({ok:false,error:"Disconnect/uninstall the agent before removing an online computer"});
    const accessRevoked=dbStore.revokeLabAgentAccess(id);const socket=labAgentSockets.get(id);if(socket){try{socket.close(1008,"Lab computer removed")}catch{}labAgentSockets.delete(id)}
    delete labComputerStore.computers[id];delete labHistoryStore.computers[id];labAiAlertsStore.alerts=labAiAlertsStore.alerts.filter(alert=>alert.agentId!==id);fs.rmSync(path.join(LAB_SCREENSHOT_DIR,id),{recursive:true,force:true});persistLabComputers();persistLabHistory();persistLabAiAlerts();audit({kind:"lab.computer.delete",id,accessRevoked});res.json({ok:true,id,accessRevoked})}
  catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.delete("/api/v1/lab/computers/:id/history",requireCapability("lab.control"),(req,res)=>{
  try{const id=cleanLabAgentId(req.params.id);labHistoryStore.computers[id]=[];persistLabHistory();res.json({ok:true,id})}
  catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.post("/api/v1/lab/command",requireCapability("lab.control"),(req,res)=>{
  try{const action=String(req.body?.action||"").toLowerCase();let payload=req.body?.payload&&typeof req.body.payload==="object"?req.body.payload:{};
    if(action==="message"){payload={...payload,text:String(payload.text||"").slice(0,100000),title:String(payload.title||"Classroom Message").slice(0,120)};if(!payload.text.trim())throw new Error("Message text is required")}
    res.json(sendLabAgentCommand(req.body?.targets||req.body?.target||[],action,payload))}
  catch(err){res.status(400).json({ok:false,error:err.message})}
});


function safeScreenshotPath(id,rel){
  const base=path.resolve(LAB_SCREENSHOT_DIR,id);
  const full=path.resolve(LAB_SCREENSHOT_DIR,rel);
  if(!full.startsWith(base+path.sep))throw new Error("Invalid screenshot path");
  return full;
}

app.get("/api/v1/lab/computers/:id/screenshot",requireCapability("lab.sensitive.read"),(req,res)=>{
  try{
    const id=cleanLabAgentId(req.params.id),rec=labComputerStore.computers[id];
    if(!rec?.screenshotFile)return res.status(404).json({ok:false,error:"No screenshot available"});
    const p=safeScreenshotPath(id,rec.screenshotFile);
    if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Screenshot file missing"});
    res.setHeader("Cache-Control","no-store");
    res.sendFile(p);
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.get("/api/v1/lab/computers/:id/screenshot/download",requireCapability("lab.sensitive.read"),(req,res)=>{
  try{
    const id=cleanLabAgentId(req.params.id),rec=labComputerStore.computers[id];
    if(!rec?.screenshotFile)return res.status(404).json({ok:false,error:"No screenshot available"});
    const p=safeScreenshotPath(id,rec.screenshotFile);
    if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Screenshot file missing"});
    const stamp=(rec.screenshotAt||new Date().toISOString()).replace(/[:.]/g,"-");
    res.download(p,`${id}-${stamp}.jpg`);
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.get("/api/v1/lab/computers/:id/screenshots",requireCapability("lab.sensitive.read"),(req,res)=>{
  try{
    const id=cleanLabAgentId(req.params.id),rec=labComputerStore.computers[id];
    if(!rec)return res.status(404).json({ok:false,error:"Lab computer not found"});
    const items=(Array.isArray(rec.screenshotHistory)?rec.screenshotHistory:[])
      .filter(x=>{
        try{return fs.existsSync(safeScreenshotPath(id,x.file))}catch{return false}
      })
      .slice(0,Math.max(1,Math.min(500,Number(req.query.limit)||100)))
      .map(x=>({
        ...x,
        url:`/api/v1/lab/computers/${encodeURIComponent(id)}/screenshots/file?file=${encodeURIComponent(x.file)}`,
        downloadUrl:`/api/v1/lab/computers/${encodeURIComponent(id)}/screenshots/download?file=${encodeURIComponent(x.file)}`
      }));
    res.json({ok:true,id,retentionDays:LAB_SCREENSHOT_RETENTION_DAYS,screenshots:items});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.get("/api/v1/lab/computers/:id/screenshots/file",requireCapability("lab.sensitive.read"),(req,res)=>{
  try{
    const id=cleanLabAgentId(req.params.id),rel=String(req.query.file||"");
    const p=safeScreenshotPath(id,rel);
    if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Screenshot file missing"});
    res.setHeader("Cache-Control","no-store");
    res.sendFile(p);
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.get("/api/v1/lab/computers/:id/screenshots/download",requireCapability("lab.sensitive.read"),(req,res)=>{
  try{
    const id=cleanLabAgentId(req.params.id),rel=String(req.query.file||"");
    const p=safeScreenshotPath(id,rel);
    if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Screenshot file missing"});
    res.download(p,`${id}-${path.basename(rel)}`);
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.get("/api/v1/lab/presets",requireCapability("lab.read"),(_req,res)=>res.json({
  ok:true,
  presets:[
    {id:"gpupdate",name:"Group Policy Update",description:"Runs gpupdate /force"},
    {id:"flushdns",name:"Flush DNS Cache",description:"Runs Clear-DnsClientCache"},
    {id:"renew-network",name:"Renew DHCP",description:"Releases and renews DHCP"},
    {id:"restart-explorer",name:"Restart Explorer",description:"Restarts the interactive Explorer shell"},
    {id:"clear-temp",name:"Clear Temporary Files",description:"Removes Windows temp files that are not in use"},
    {id:"system-info",name:"Collect System Info",description:"Returns Windows/system/network summary"}
  ]
}));


app.get("/api/v1/lab/ai-monitor",requireCapability("lab.sensitive.read"),(req,res)=>{
  try{
    const status=String(req.query.status||"").trim();
    const profile=String(req.query.profile||"").trim().toLowerCase();
    const search=String(req.query.search||"").trim().toLowerCase();
    const hours=Math.max(0,Number(req.query.hours||0)||0);
    let alerts=[...labAiAlertsStore.alerts];
    if(status)alerts=alerts.filter(a=>a.status===status);
    if(profile)alerts=alerts.filter(a=>String(a.profile||a.windowsUser||"").toLowerCase().includes(profile));
    if(hours>0){
      const cutoff=Date.now()-hours*3600000;
      alerts=alerts.filter(a=>Date.parse(a.createdAt||0)>=cutoff);
    }
    if(search)alerts=alerts.filter(a=>[
      a.profile,a.windowsUser,a.hostname,a.computerName,a.domain,a.url,a.title,a.rule
    ].some(v=>String(v||"").toLowerCase().includes(search)));
    const limit=Math.max(1,Math.min(1000,Number(req.query.limit)||200));
    res.json({
      ok:true,
      enabled:LAB_AI_MONITOR_ENABLED&&labAiRulesStore.enabled!==false,
      cooldownMinutes:LAB_AI_ALERT_COOLDOWN_MINUTES,
      rules:labAiRulesStore,
      summary:{
        total:labAiAlertsStore.alerts.length,
        new:labAiAlertsStore.alerts.filter(a=>a.status==="new").length,
        acknowledged:labAiAlertsStore.alerts.filter(a=>a.status==="acknowledged").length
      },
      alerts:alerts.slice(0,limit)
    });
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.put("/api/v1/lab/ai-monitor/rules",requireCapability("lab.control"),(req,res)=>{
  try{
    const body=req.body||{};
    if(typeof body.enabled==="boolean")labAiRulesStore.enabled=body.enabled;
    for(const key of ["domains","keywords","excludeDomains"]){
      if(Array.isArray(body[key])){
        labAiRulesStore[key]=[...new Set(body[key].map(x=>String(x).trim().toLowerCase()).filter(Boolean))].slice(0,500);
      }
    }
    persistLabAiRules();
    res.json({ok:true,rules:labAiRulesStore});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});


app.post("/api/v1/lab/ai-monitor/:id/capture",requireCapability("lab.control"),(req,res)=>{
  try{
    const alert=labAiAlertsStore.alerts.find(a=>a.id===String(req.params.id));
    if(!alert)return res.status(404).json({ok:false,error:"Alert not found"});
    const ws=labAgentSockets.get(alert.agentId);
    if(!ws||ws.readyState!==WebSocket.OPEN)
      return res.status(409).json({ok:false,error:"Lab computer is offline"});
    const command={
      id:crypto.randomUUID(),
      action:"screenshot",
      issuedAt:new Date().toISOString(),
      payload:{quality:85,save:true,alertId:alert.id}
    };
    const rec=labComputerStore.computers[alert.agentId];
    if(rec){
      rec.lastCommand={...command,status:"sent"};
      persistLabComputers();
    }
    wsSend(ws,{type:"lab.command",command});
    res.json({ok:true,commandId:command.id});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.put("/api/v1/lab/ai-monitor/:id",requireCapability("lab.control"),(req,res)=>{
  try{
    const alert=labAiAlertsStore.alerts.find(a=>a.id===String(req.params.id));
    if(!alert)return res.status(404).json({ok:false,error:"Alert not found"});
    const status=String(req.body?.status||"").trim();
    if(!["new","acknowledged","dismissed"].includes(status))
      return res.status(400).json({ok:false,error:"Invalid status"});
    alert.status=status;
    alert.updatedAt=new Date().toISOString();
    persistLabAiAlerts();
    broadcastControllers({type:"lab.ai.alert.updated",alert});
    res.json({ok:true,alert});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});


app.get("/api/v1/lab/lock-presets",requireCapability("lab.read"),(_req,res)=>res.json({
  ok:true,
  browsers:[
    {id:"edge",name:"Microsoft Edge",exe:"msedge.exe"},
    {id:"chrome",name:"Google Chrome",exe:"chrome.exe"}
  ],
  examples:[
    {name:"Learning Platform",type:"browser",browser:"edge",url:"https://example.edu/"}
  ]
}));

// Classroom Presentation Mode API
const presentationUploadStorage=multer.diskStorage({
  destination:(_req,_file,cb)=>cb(null,PRESENTATION_UPLOAD_TMP),
  filename:(_req,file,cb)=>{
    const ext=path.extname(file.originalname||"").toLowerCase().slice(0,10);
    cb(null,`${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});
const presentationUpload=multer({
  storage:presentationUploadStorage,
  limits:{fileSize:MAX_UPLOAD_MB*1024*1024},
  fileFilter:(_req,file,cb)=>{
    const ext=path.extname(file.originalname||"").toLowerCase();
    const allowed=new Set([".ppt",".pptx",".odp",".pdf"]);
    cb(allowed?null:new Error("Presentation Mode accepts .ppt, .pptx, .odp, or .pdf"),allowed.has(ext));
  }
});

app.get("/api/v1/presentations",requireClassroomRead,(_req,res)=>{
  res.json({
    ok:true,
    folders:Object.values(presentationLibrary.folders).sort((a,b)=>a.name.localeCompare(b.name)),
    presentations:Object.values(presentationLibrary.presentations).map(presentationPublicRecord).sort((a,b)=>String(a.name).localeCompare(String(b.name))),
    state:presentationStatePublic(),
    displays:Object.entries(devices).filter(([,d])=>d.enabled!==false).map(([id,d])=>({id,name:d.name||id}))
  });
});
app.get("/api/v1/presentations/state",requireClassroomRead,(_req,res)=>res.json({ok:true,state:presentationStatePublic()}));

app.post("/api/v1/presentations/folders",requireCapability("media.manage"),(req,res)=>{
  try{
    const name=cleanPresentationLabel(req.body?.name,100);
    const parentId=normalizePresentationFolderId(req.body?.parentId||"root");
    const id=presentationFolderId(),now=new Date().toISOString();
    presentationLibrary.folders[id]={id,name,parentId,createdAt:now,updatedAt:now};
    persistPresentationLibrary();
    res.json({ok:true,folder:presentationLibrary.folders[id]});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.put("/api/v1/presentations/folders/:id",requireCapability("media.manage"),(req,res)=>{
  try{
    const id=String(req.params.id),folder=presentationLibrary.folders[id];
    if(!folder||id==="root")return res.status(404).json({ok:false,error:"Folder not found or cannot be changed"});
    if(req.body?.name!==undefined)folder.name=cleanPresentationLabel(req.body.name,100);
    if(req.body?.parentId!==undefined){
      const parentId=normalizePresentationFolderId(req.body.parentId);
      if(presentationFolderWouldCycle(id,parentId))throw new Error("Folder cannot be moved into itself or a child folder");
      folder.parentId=parentId;
    }
    folder.updatedAt=new Date().toISOString();
    persistPresentationLibrary();
    res.json({ok:true,folder});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.delete("/api/v1/presentations/folders/:id",requireCapability("media.manage"),(req,res)=>{
  try{
    const id=String(req.params.id);
    if(id==="root"||!presentationLibrary.folders[id])return res.status(400).json({ok:false,error:"Root folder cannot be deleted"});
    const recursive=String(req.query.recursive||"0")==="1";
    const folders=presentationDescendantFolderIds(id);
    const pres=Object.values(presentationLibrary.presentations).filter(p=>folders.has(p.folderId));
    if(!recursive&&(folders.size>1||pres.length))return res.status(409).json({ok:false,error:"Folder is not empty; use recursive delete"});
    for(const p of pres)deletePresentationRecord(p.id);
    for(const fid of folders)delete presentationLibrary.folders[fid];
    persistPresentationLibrary();
    res.json({ok:true,removedFolders:[...folders],removedPresentations:pres.map(p=>p.id)});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.post("/api/v1/presentations/upload",requireCapability("media.manage"),presentationUpload.single("presentation"),async(req,res)=>{
  if(!req.file)return res.status(400).json({ok:false,error:"No presentation uploaded"});
  const id=presentationId();
  const dir=path.join(PRESENTATIONS_DIR,id);
  fs.mkdirSync(dir,{recursive:true});
  try{
    const ext=path.extname(req.file.originalname||"").toLowerCase();
    const originalFile=`original${ext}`;
    fs.renameSync(req.file.path,path.join(dir,originalFile));
    const now=new Date().toISOString();
    const rec={
      id,
      name:cleanPresentationLabel(path.basename(req.file.originalname,ext)||"Presentation",140),
      originalName:req.file.originalname,
      originalFile,
      folderId:normalizePresentationFolderId(req.body?.folderId||"root"),
      mime:req.file.mimetype||"",
      size:req.file.size||0,
      slideCount:0,
      notes:[],
      pdfFile:null,
      conversionStatus:"converting",
      conversionError:null,
      createdAt:now,
      updatedAt:now
    };
    presentationLibrary.presentations[id]=rec;
    persistPresentationLibrary();
    try{
      await buildPresentationSlides(id);
      audit({kind:"presentation.upload",id,name:rec.name,slides:rec.slideCount,folderId:rec.folderId});
      res.json({ok:true,presentation:presentationPublicRecord(rec)});
    }catch(err){
      rec.conversionStatus="failed";rec.conversionError=err.message;rec.updatedAt=new Date().toISOString();
      persistPresentationLibrary();
      res.status(500).json({ok:false,error:err.message,presentation:presentationPublicRecord(rec)});
    }
  }catch(err){
    fs.rmSync(dir,{recursive:true,force:true});
    if(fs.existsSync(req.file.path))fs.rmSync(req.file.path,{force:true});
    res.status(400).json({ok:false,error:err.message});
  }
});
app.post("/api/v1/presentations/:id/rebuild",requireCapability("media.manage"),async(req,res)=>{
  let rec=null,prior=null;
  try{
    const id=String(req.params.id);rec=presentationLibrary.presentations[id];
    if(!rec)return res.status(404).json({ok:false,error:"Presentation not found"});
    prior={conversionStatus:rec.conversionStatus,conversionError:rec.conversionError};
    rec.conversionStatus="converting";rec.conversionError=null;persistPresentationLibrary();
    await buildPresentationSlides(id);
    res.json({ok:true,presentation:presentationPublicRecord(rec)});
  }catch(err){if(rec){rec.conversionStatus=prior?.conversionStatus||"failed";rec.conversionError=prior?.conversionError||null;rec.lastRebuildError=err.message;rec.updatedAt=new Date().toISOString();persistPresentationLibrary()}res.status(500).json({ok:false,error:err.message,presentation:rec?presentationPublicRecord(rec):null})}
});
app.put("/api/v1/presentations/:id",requireCapability("media.manage"),(req,res)=>{
  try{
    const id=String(req.params.id),rec=presentationLibrary.presentations[id];
    if(!rec)return res.status(404).json({ok:false,error:"Presentation not found"});
    if(req.body?.name!==undefined)rec.name=cleanPresentationLabel(req.body.name,140);
    if(req.body?.folderId!==undefined)rec.folderId=normalizePresentationFolderId(req.body.folderId);
    rec.updatedAt=new Date().toISOString();persistPresentationLibrary();
    res.json({ok:true,presentation:presentationPublicRecord(rec)});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.delete("/api/v1/presentations/:id",requireCapability("media.manage"),async(req,res)=>{
  try{
    const id=String(req.params.id);
    if(!presentationLibrary.presentations[id])return res.status(404).json({ok:false,error:"Presentation not found"});
    if(presentationState.active&&presentationState.presentationId===id)await stopPresentation({clear:true});
    deletePresentationRecord(id);persistPresentationLibrary();
    audit({kind:"presentation.delete",id});
    res.json({ok:true,id});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.post("/api/v1/presentations/:id/start",requireCapability("media.manage"),async(req,res)=>{
  try{
    const id=String(req.params.id),rec=presentationLibrary.presentations[id];
    if(!rec)return res.status(404).json({ok:false,error:"Presentation not found"});
    if(rec.conversionStatus!=="ready"||!rec.slideCount)return res.status(409).json({ok:false,error:"Presentation rendering is not ready"});
    if(presentationState.active)await stopPresentation({clear:false});
    const targets=resolveDisplayTargets(req.body?.targets?.length?req.body.targets:(req.body?.target||"all"));
    if(!targets.length)throw new Error("Select at least one display");
    const now=new Date().toISOString();
    presentationState={
      ...defaultPresentationState(),
      active:true,presentationId:id,
      slide:Math.max(1,Math.min(Number(req.body?.slide)||1,rec.slideCount)),
      targets,
      paused:false,black:false,startedAt:now,slideStartedAt:now,
      autoAdvanceSeconds:Math.max(0,Math.min(3600,Number(req.body?.autoAdvanceSeconds)||0)),
      loop:!!req.body?.loop,
      targetSeconds:Math.max(0,Math.min(3600,Number(req.body?.targetSeconds)||0)),
      timings:{},
      sessionId:crypto.randomUUID()
    };
    persistPresentationState();
    await sendPresentationSlide();
    audit({kind:"presentation.start",id,name:rec.name,targets,slide:presentationState.slide});
    broadcastControllers({type:"presentation.state",state:presentationStatePublic()});
    res.json({ok:true,state:presentationStatePublic()});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});
app.post("/api/v1/presentations/control",requireCapability("media.manage"),async(req,res)=>{
  try{res.json({ok:true,state:await controlPresentation(req.body?.action,req.body||{})})}
  catch(err){res.status(400).json({ok:false,error:err.message})}
});

// Media Library uploads / documents
const storage = multer.diskStorage({
  destination: (_req,_file,cb)=>cb(null,MEDIA_DIR),
  filename: (_req,file,cb)=>{
    const ext=path.extname(file.originalname||"").toLowerCase().slice(0,15);
    const base=path.basename(file.originalname||"media",ext)
      .replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,100);
    cb(null,`${crypto.randomUUID()}-${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits:{fileSize:MAX_UPLOAD_MB*1024*1024},
  fileFilter:(_req,file,cb)=>{
    const mime=String(file.mimetype||"").toLowerCase();
    const ext=path.extname(file.originalname||"").toLowerCase();
    const allowedExt=new Set([
      ".png",".jpg",".jpeg",".gif",".webp",".bmp",
      ".mp4",".webm",".mov",".m4v",
      ".pdf",".ppt",".pptx",".odp",".doc",".docx",".odt",".rtf"
    ]);
    const allowedMime=
      mime.startsWith("image/")||mime.startsWith("video/")||
      mime==="application/pdf"||
      mime.includes("presentation")||mime.includes("powerpoint")||
      mime.includes("word")||mime.includes("officedocument")||
      mime.includes("opendocument")||mime==="application/rtf"||
      mime==="application/octet-stream";
    const allowed=allowedExt.has(ext)&&allowedMime;
    cb(allowed?null:new Error(`Unsupported file type: ${file.originalname} (${mime||"unknown mime"})`),allowed);
  }
});

app.post("/api/v1/media",requireCapability("media.manage"),upload.single("media"),async(req,res)=>{
  if(!req.file)return res.status(400).json({ok:false,error:"No file uploaded"});
  const stored=req.file.filename,type=classifyMedia(stored,req.file.mimetype);
  const rec={
    originalName:req.file.originalname,
    storedName:stored,
    mime:req.file.mimetype,
    type,
    uploadedAt:new Date().toISOString(),
    generatedPdf:null,
    conversionStatus:null,
    conversionError:null
  };
  mediaLibrary.files[stored]=rec;
  persistMediaLibrary();

  if(officeConvertible(stored)){
    rec.conversionStatus="converting";
    persistMediaLibrary();
    try{
      rec.generatedPdf=await convertOfficeToPdf(stored);
      rec.conversionStatus="ready";
      rec.conversionError=null;
    }catch(err){
      rec.conversionStatus="failed";
      rec.conversionError=err.message;
    }
    persistMediaLibrary();
  }

  audit({kind:"media.upload",name:req.file.originalname,stored,mime:req.file.mimetype,size:req.file.size,type,generatedPdf:rec.generatedPdf});
  res.json({ok:true,file:libraryRecordFromDisk(stored)});
});

app.post("/api/v1/media/:name/convert",requireCapability("media.manage"),async(req,res)=>{
  let rec=null,prior=null,name="";
  try{
    name=safeStoredName(req.params.name);rec=mediaLibrary.files[name]||{};
    if(!fs.existsSync(path.join(MEDIA_DIR,name)))return res.status(404).json({ok:false,error:"File not found"});
    if(!officeConvertible(name))return res.status(400).json({ok:false,error:"Only Word/PowerPoint/OpenDocument files require conversion"});
    prior={generatedPdf:rec.generatedPdf,conversionStatus:rec.conversionStatus,conversionError:rec.conversionError};rec.originalName=rec.originalName||name;rec.storedName=name;rec.type=classifyMedia(name);rec.conversionStatus="converting";rec.conversionError=null;
    mediaLibrary.files[name]=rec;persistMediaLibrary();
    rec.generatedPdf=await convertOfficeToPdf(name);rec.conversionStatus="ready";persistMediaLibrary();
    res.json({ok:true,file:libraryRecordFromDisk(name)});
  }catch(err){if(rec&&name){rec.generatedPdf=prior?.generatedPdf||null;rec.conversionStatus=prior?.generatedPdf?"ready":"failed";rec.conversionError=err.message;mediaLibrary.files[name]=rec;persistMediaLibrary()}res.status(500).json({ok:false,error:err.message})}
});

app.delete("/api/v1/media/:name",requireCapability("media.manage"),(req,res)=>{
  try{
    const name=safeStoredName(req.params.name),rec=mediaLibrary.files[name]||{};
    const removed=[];
    for(const n of [name,rec.generatedPdf].filter(Boolean)){
      const full=path.join(MEDIA_DIR,safeStoredName(n));
      if(fs.existsSync(full)){fs.rmSync(full,{force:true});removed.push(n)}
    }
    delete mediaLibrary.files[name];
    persistMediaLibrary();
    audit({kind:"media.delete",name,removed});
    res.json({ok:true,removed});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.post("/api/v1/media/:name/display",requireCapability("media.manage"),async(req,res)=>{
  try{
    const name=safeStoredName(req.params.name),full=path.join(MEDIA_DIR,name);
    if(!fs.existsSync(full))return res.status(404).json({ok:false,error:"File not found"});
    const rec=mediaLibrary.files[name]||{},type=rec.type||classifyMedia(name,rec.mime||"");
    const target=cleanId(req.body?.target||"tv1");
    const payload=req.body||{};
    let command;

    if(type==="image")command={type:"display.image",target,payload:{url:mediaUrl(name),fit:payload.fit||"contain"}};
    else if(type==="video")command={type:"display.video",target,payload:{url:mediaUrl(name),fit:payload.fit||"contain",autoplay:true,muted:!!payload.muted,loop:!!payload.loop}};
    else if(type==="pdf"){
      const viewer=documentViewerUrl(name,payload);
      command={type:"display.pdf",target,payload:{url:viewer,sourceUrl:mediaUrl(name)}};
    }else if(type==="presentation"||type==="document"){
      if(!rec.generatedPdf || !fs.existsSync(path.join(MEDIA_DIR,rec.generatedPdf))){
        return res.status(409).json({ok:false,error:"Document conversion is not ready",conversionStatus:rec.conversionStatus,conversionError:rec.conversionError});
      }
      const viewer=documentViewerUrl(rec.generatedPdf,payload);
      command={type:"display.document",target,payload:{url:viewer,sourceUrl:mediaUrl(name),pdfUrl:mediaUrl(rec.generatedPdf),originalName:rec.originalName||name}};
    }else{
      return res.status(400).json({ok:false,error:"This file type cannot be displayed"});
    }
    const result=await executeCommand(command,"media-library");
    res.json({ok:true,file:libraryRecordFromDisk(name),command,result});
  }catch(err){res.status(400).json({ok:false,error:err.message})}
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ ok: false, error: err.message || "Request failed" });
});

// -----------------------------------------------------------------------------
// HTTP server + WebSocket server
// -----------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });
const WS_MAX_CONNECTIONS=Math.max(25,Math.min(5000,Number(process.env.WS_MAX_CONNECTIONS||500)));
const WS_MAX_CONNECTIONS_PER_IP=Math.max(5,Math.min(250,Number(process.env.WS_MAX_CONNECTIONS_PER_IP||40)));

// TVs connect only to the ticketed Hub proxy. The backend relays raw Sendspin
// to the configured dedicated endpoint (normally :8927/sendspin), not the MA
// web-player route on :8095. The long-lived token belongs to API control only.
const maSendspinProxyWss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });
function boundedWsObject(value,label,maxBytes=64*1024){
  if(!value||typeof value!=="object"||Array.isArray(value))return {};
  const encoded=JSON.stringify(value);
  if(Buffer.byteLength(encoded)>maxBytes)throw Error(`${label} exceeds ${Math.floor(maxBytes/1024)} KB`);
  return JSON.parse(encoded);
}
function websocketMessageAllowed(ws){
  const now=Date.now(),windowMs=10000,maxMessages=120;
  if(!ws.messageWindowAt||now-ws.messageWindowAt>=windowMs){ws.messageWindowAt=now;ws.messageWindowCount=0}
  ws.messageWindowCount=(ws.messageWindowCount||0)+1;
  return ws.messageWindowCount<=maxMessages;
}
server.on("upgrade",(req,socket,head)=>{
  let pathname="";try{pathname=new URL(req.url||"/","http://classroom-hub.local").pathname}catch{}
  const target=pathname==="/ws"?wss:pathname==="/music-assistant/sendspin-proxy"?maSendspinProxyWss:null;
  if(!target){socket.destroy();return}
  const remote=clientAddress(req),all=[...wss.clients,...maSendspinProxyWss.clients];
  if(all.length>=WS_MAX_CONNECTIONS||all.filter(client=>client.remoteAddress===remote).length>=WS_MAX_CONNECTIONS_PER_IP){socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");socket.destroy();return}
  target.handleUpgrade(req,socket,head,ws=>target.emit("connection",ws,req));
});
maSendspinProxyWss.on("connection",(client,req)=>{
  client.remoteAddress=clientAddress(req);
  client.on("error",()=>{}); // Also cover rejected tickets during the close handshake.
  const reject=(code,reason)=>{if(client.readyState===WebSocket.OPEN)client.close(code,reason)};
  try{
    const u=new URL(req.url||"/","http://classroom-hub.local"),ticket=consumeMusicAssistantProxyTicket(u.searchParams.get("ticket"));
    if(!ticket)return reject(1008,"Invalid or expired Music Assistant bridge ticket");
    const attached=dbStore.getPreference("musicassistant.tvBridgeTargets",[])||[];
    if(!Array.isArray(attached)||!attached.includes(ticket.deviceId))return reject(1008,"Display is not attached to Music Assistant bridge");
    const cfg=musicAssistantConfig();
    if(!cfg.tvBridgeEnabled)return reject(1008,"Music Assistant TV bridge is disabled");
    relaySendspin(client,{
      WebSocket,config:cfg,maxPayload:WS_MAX_PAYLOAD_BYTES,
      onConnected:upstreamUrl=>audit({kind:"musicassistant.sendspin.proxy.connected",deviceId:ticket.deviceId,playerId:ticket.playerId,upstreamUrl}),
      onError:e=>diagnosticError(e,{component:"music-assistant",operation:"sendspin-proxy",deviceId:ticket.deviceId})
    });
  }catch(e){diagnosticError(e,{component:"music-assistant",operation:"sendspin-proxy-setup"});reject(1011,"Music Assistant Sendspin proxy setup failed")}
});

wss.on("connection", (ws, req) => {
  ws.connectionId = crypto.randomUUID();
  ws.role = "unknown";
  ws.deviceId = "";
  ws.isAlive = true;
  ws.sessionToken = "";
  ws.remoteAddress=clientAddress(req);
  ws.helloTimer=setTimeout(()=>{if(ws.role==="unknown"&&ws.readyState===WebSocket.OPEN)ws.close(1008,"Authentication timeout")},10000);
  wsClients.add(ws);
  runtime.websocketClients = wsClients.size;

  ws.on("pong", () => {
    ws.isAlive = true;
    if (ws.role === "display") markDisplaySeen(ws);
  });

  ws.on("message", async (raw) => {
    if(!websocketMessageAllowed(ws)){ws.close(1008,"Message rate limit exceeded");return}
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return wsSend(ws, { type: "error", error: "Invalid JSON" });
    }

    try {
      if (msg.type === "hello") {
        if(ws.role!=="unknown")throw new Error("WebSocket identity is already established");
        const role = cleanId(msg.role);

        if (role === "controller" || role === "admin") {
          if(!browserWebSocketOriginAllowed(req))throw new Error("Untrusted WebSocket origin");
          if(dbStore.authEnabled()){
            const user=requestUser(req);
            if(role==="admin"?(!hasRole(user,"admin")||!hasCapability(user,"*")):!hasCapability(user,"classroom.control"))throw new Error(role==="admin"?"Enabled administrator profile required":"Permission required: classroom.control");
            ws.authUser=user;
            ws.sessionToken=cookieValue(req,"classroom_hub_session");
          }else if(!CONTROL_TOKEN||!secureTokenEqual(msg.token,CONTROL_TOKEN)){
            throw new Error("Unauthorized controller");
          }
          ws.role = role;
          clearTimeout(ws.helloTimer);
          wsSend(ws, {
            type: "hello.ack",
            role,
            room: deviceConfig.room || ROOM_NAME,
            devices,
            groups: displayGroups,
            runtime: publicRuntime(),
            state: persistentState
          });
          return;
        }

        if (role === "preview") {
          if(!browserWebSocketOriginAllowed(req))throw new Error("Untrusted WebSocket origin");
          if(dbStore.authEnabled()){
            const user=requestUser(req);if(!hasCapability(user,"classroom.read"))throw new Error("Permission required: classroom.read");
            ws.authUser=user;ws.sessionToken=cookieValue(req,"classroom_hub_session");
          }else if(!CONTROL_TOKEN||!secureTokenEqual(msg.token,CONTROL_TOKEN))throw new Error("Unauthorized preview");
          const deviceId = cleanId(msg.deviceId);
          if (!devices[deviceId] || devices[deviceId].enabled === false) {
            throw new Error("Unknown or disabled preview display");
          }

          ws.role = "preview";
          ws.deviceId = deviceId;
          clearTimeout(ws.helloTimer);

          wsSend(ws, {
            type: "hello.ack",
            role: "preview",
            version: APPLICATION_VERSION,
            deviceId,
            room: deviceConfig.room || ROOM_NAME,
            config: devices[deviceId],
            state: persistentState.displays[deviceId] || null,
            displayGatewayHosts:DISPLAY_GATEWAY_HOSTS
          });
          return;
        }

        if (role === "display") {
          const deviceId = cleanId(msg.deviceId);
          if (!devices[deviceId] || devices[deviceId].enabled === false) {
            throw new Error("Unknown or disabled display");
          }

          let displayCredential=dbStore.authenticateDisplay(deviceId,msg.credential||""),issuedCredential=null,authMode="credential";
          if(!displayCredential&&msg.enrollmentToken){
            issuedCredential=dbStore.consumeDisplayEnrollment(deviceId,msg.enrollmentToken,{label:String(msg.meta?.userAgent||req.headers["user-agent"]||"Classroom display")});
            if(issuedCredential)displayCredential={id:issuedCredential.id,displayId:deviceId};
          }
          if(!displayCredential){
            const policy=dbStore.displayCredentialPolicy();
            if(!policy.authenticationRequired){displayCredential={id:"direct",displayId:deviceId};authMode="configured-display"}
            else if(policy.legacySharedTokenAllowed&&DISPLAY_TOKEN&&secureTokenEqual(msg.token,DISPLAY_TOKEN))authMode="legacy-shared-token";
            else throw new Error("Unauthorized display");
          }else if(issuedCredential)authMode="new-enrollment";

          ws.role = "display";
          ws.deviceId = deviceId;
          ws.displayCredentialId=displayCredential?.id||"";
          ws.displayAuthMode=authMode;
          clearTimeout(ws.helloTimer);
          ws.maAudioRestored = false;
          ws.maAudioRestorePending = false;
          markDisplaySeen(ws, {
            userAgent: req.headers["user-agent"] || "",
            meta: boundedWsObject(msg.meta,"Display metadata")
          });

          wsSend(ws, {
            type: "hello.ack",
            role: "display",
            version: APPLICATION_VERSION,
            deviceId,
            room: deviceConfig.room || ROOM_NAME,
            config: devices[deviceId],
            state: persistentState.displays[deviceId] || null,
            authMode,
            credential:issuedCredential?.credential||undefined,
            credentialId:displayCredential?.id||undefined,
            assetAccessToken:issueAssetAccessToken(deviceId,displayCredential?.id||""),
            displayGatewayHosts:DISPLAY_GATEWAY_HOSTS
          });

          // Re-attach persistent Music Assistant browser player bridge after display reconnect/reload.
          try{
            const maTargets=dbStore.getPreference("musicassistant.tvBridgeTargets",[])||[];
            if(Array.isArray(maTargets)&&maTargets.includes(deviceId)){
              const maToken=musicAssistantToken();
              if(maToken){const issued=issueMusicAssistantProxyTicket(deviceId);setTimeout(()=>{if(ws.readyState===WebSocket.OPEN)wsSend(ws,{type:"command",command:{type:"music.assistant.attach",target:deviceId,payload:musicAssistantTvAttachPayload(deviceId,issued)}})},1200)};
            }
          }catch{}

          // Server-driven renderer convergence. Older display clients already understand
          // display.reload even when they do not yet report clientVersion. This makes a
          // Hub upgrade automatically refresh legacy/stale kiosk browsers without requiring
          // a manual visit to every TV.
          const clientVersion=String(msg.clientVersion||msg.meta?.build||"");
          if(clientVersion!==APPLICATION_VERSION) {
            audit({kind:"display.renderer.refresh-required",deviceId,clientVersion:clientVersion||null,serverVersion:APPLICATION_VERSION});
            setTimeout(()=>{
              if(ws.readyState===WebSocket.OPEN){
                wsSend(ws,{type:"command",command:{type:"display.reload",target:deviceId,payload:{reason:"renderer-version-mismatch",serverVersion:APPLICATION_VERSION}}});
              }
            },700);
          }

          audit({ kind: "display.connected", deviceId, clientVersion:clientVersion||null });
          return;
        }

        if (role === "lab-agent") {
          const agentId=cleanLabAgentId(msg.agentId||msg.deviceId||msg.hostname);
          let agentCredential=dbStore.authenticateLabAgent(agentId,msg.credential||""),issuedCredential=null,authMode="credential";
          if(!agentCredential&&msg.enrollmentToken){issuedCredential=dbStore.consumeLabAgentEnrollment(agentId,msg.enrollmentToken,{label:String(msg.hostname||req.headers["user-agent"]||"Windows classroom agent")});if(issuedCredential)agentCredential={id:issuedCredential.id,agentId}}
          if(!agentCredential){const policy=dbStore.labAgentCredentialPolicy();if(policy.legacySharedTokenAllowed&&LAB_AGENT_TOKEN&&secureTokenEqual(msg.token,LAB_AGENT_TOKEN))authMode="legacy-shared-token";else throw new Error("Unauthorized lab agent")}
          else if(issuedCredential)authMode="new-enrollment";
          ws.role="lab-agent";ws.labAgentId=agentId;ws.deviceId=agentId;
          ws.labAgentCredentialId=agentCredential?.id||"";ws.labAgentAuthMode=authMode;
          clearTimeout(ws.helloTimer);
          const old=labAgentSockets.get(agentId);if(old&&old!==ws&&old.readyState===WebSocket.OPEN){try{old.close(4001,"Replaced by newer agent connection")}catch{}}
          labAgentSockets.set(agentId,ws);
          const helloMeta=boundedWsObject(msg.meta,"Lab agent metadata");
          const capabilities=[...new Set((Array.isArray(msg.capabilities)?msg.capabilities:Array.isArray(helloMeta.capabilities)?helloMeta.capabilities:[]).map(x=>String(x).slice(0,80)))].slice(0,100);
          const helloIp=String(msg.ip||helloMeta.ip||(Array.isArray(helloMeta.ipv4)?helloMeta.ipv4[0]:"")||"").slice(0,80);
          upsertLabComputer(agentId,{hostname:String(msg.hostname||helloMeta.hostname||agentId).slice(0,120),agentVersion:String(msg.agentVersion||helloMeta.agentVersion||"").slice(0,40),
            ip:helloIp,capabilities,meta:{...helloMeta,capabilities},connectedAt:new Date().toISOString()});
          const privacy=privacyRetentionPolicy();
          wsSend(ws,{type:"hello.ack",role:"lab-agent",agentId,room:deviceConfig.room||ROOM_NAME,historyEnabled:privacy.browserHistoryEnabled,historyRetentionHours:privacy.browserHistoryHours,heartbeatSeconds:15,historyPollSeconds:privacy.browserHistoryEnabled?30:0,authMode,credential:issuedCredential?.credential||undefined,credentialId:agentCredential?.id||undefined});
          broadcastControllers({type:"lab.status",computer:publicLabComputer(agentId)});audit({kind:"lab.connected",id:agentId,hostname:msg.hostname||agentId});return;
        }

        if (role === "student" || role === "session-teacher") {
          throw new Error("Legacy anonymous classroom participation has been retired");
        }

        throw new Error("Role must be controller, admin, preview, display, lab-agent, student, or session-teacher");
      }

      if (msg.type === "display.media.ended" && ws.role === "display") {
        backgroundMusicPriorityTargets.delete(ws.deviceId);
        backgroundMusicReconcilePriority().catch(()=>{});
        audit({kind:"display.media.ended",deviceId:ws.deviceId,mediaType:String(msg.mediaType||"unknown")});
        return;
      }

      if (msg.type === "music.assistant.status" && ws.role === "display") {
        const previous=runtime.displays[ws.deviceId]||{},status=boundedWsObject(msg.status,"Music Assistant status");
        runtime.displays[ws.deviceId]={...previous,musicAssistant:{...status,desiredAudio:musicAssistantTvAudioState(ws.deviceId),updatedAt:new Date().toISOString()}};
        broadcastControllers({type:"device.status",deviceId:ws.deviceId,status:publicDisplayStatus(ws.deviceId)});
        if(status.protocolActive===true&&!ws.maAudioRestored&&!ws.maAudioRestorePending){ws.maAudioRestorePending=true;setTimeout(async()=>{try{await restoreMusicAssistantTvAudioState(ws.deviceId,ws)}finally{ws.maAudioRestorePending=false}},250)}
        if(ws.maAudioRestored){const desired=musicAssistantTvAudioState(ws.deviceId),patch={};const n=Number(status.volume);if(Number.isFinite(n)&&Math.max(0,Math.min(100,n))!==desired.volume)patch.volume=n;if(status.muted!==undefined&&!!status.muted!==desired.muted)patch.muted=!!status.muted;if(Object.keys(patch).length)setMusicAssistantTvAudioState(ws.deviceId,patch)}

        // Reconcile scheduled Background Music after a display's persistent
        // Music Assistant/Sendspin player comes back from a renderer reload or
        // reconnect. The bridge can be protocol-active but idle; without this
        // hook the scheduler may not restart the selected favorite promptly.
        if(status.protocolActive===true){
          try{
            const bgCfg=backgroundMusicSchedule();
            const reportedPlayer=String(status.clientId||status.playerId||`classroom-hub-${ws.deviceId}`);
            if(bgCfg.enabled&&String(bgCfg.playerId||'')===reportedPlayer&&!backgroundMusicRuntime.manualStopped&&!backgroundMusicPriorityTargets.size&&status.isPlaying!==true){
              backgroundMusicRuntime.playing=false;
              if(!backgroundMusicRuntime.pausedForPriority)backgroundMusicRuntime.paused=false;
            }
            setTimeout(()=>backgroundMusicTick().catch(()=>{}),500);
          }catch{}
        }
        return;
      }

      if (msg.type === "music.assistant.reconnect.request" && ws.role === "display") {
        const attached=dbStore.getPreference("musicassistant.tvBridgeTargets",[])||[];
        if(Array.isArray(attached)&&attached.includes(ws.deviceId)&&musicAssistantToken()){
          ws.maAudioRestored=false;ws.maAudioRestorePending=false;
          const issued=issueMusicAssistantProxyTicket(ws.deviceId);
          wsSend(ws,{type:"command",command:{type:"music.assistant.attach",target:ws.deviceId,payload:musicAssistantTvAttachPayload(ws.deviceId,issued,{reconnect:true})}});
          audit({kind:"musicassistant.sendspin.reconnect-issued",deviceId:ws.deviceId});
        }
        return;
      }

      if (msg.type === "heartbeat" && ws.role === "display") {
        markDisplaySeen(ws, { meta: boundedWsObject(msg.meta,"Display heartbeat metadata") });
        return wsSend(ws, { type: "heartbeat.ack", at: Date.now(),assetAccessToken:ws.role==="display"?issueAssetAccessToken(ws.deviceId,ws.displayCredentialId):undefined });
      }

      if (msg.type === "display.state" && ws.role === "display") {
        const reportedState=boundedWsObject(msg.state,"Display state",256*1024);
        markDisplaySeen(ws, { state: reportedState });
        if (msg.state && typeof msg.state === "object") {
          setDisplayState(ws.deviceId, { reportedState });
          persistState();
        }
        return;
      }

      if (msg.type === "heartbeat" && ws.role === "lab-agent") {
        const id=ws.labAgentId,meta=boundedWsObject(msg.meta,"Lab agent heartbeat metadata"),memory=boundedWsObject(msg.memory||meta.memory,"Lab agent memory",8*1024),capabilities=[...new Set((Array.isArray(msg.capabilities)?msg.capabilities:Array.isArray(meta.capabilities)?meta.capabilities:labComputerStore.computers[id]?.capabilities||[]).map(x=>String(x).slice(0,80)))].slice(0,100);upsertLabComputer(id,{hostname:String(msg.hostname||meta.hostname||labComputerStore.computers[id]?.hostname||id).slice(0,120),
          user:String(msg.user||meta.user||"").slice(0,160),ip:String(msg.ip||meta.ip||(Array.isArray(meta.ipv4)?meta.ipv4[0]:"")||"").slice(0,80),os:String(msg.os||meta.os||"").slice(0,200),capabilities,
          uptimeSeconds:Number(msg.uptimeSeconds||meta.uptimeSeconds||0)||0,memory,
          agentVersion:String(msg.agentVersion||meta.agentVersion||labComputerStore.computers[id]?.agentVersion||"").slice(0,40),meta});
        broadcastControllers({type:"lab.status",computer:publicLabComputer(id)});return wsSend(ws,{type:"heartbeat.ack",at:Date.now()});
      }
      if (msg.type === "lab.agent.event" && ws.role === "lab-agent") {
        const event={category:String(msg.category||"agent").slice(0,80),severity:String(msg.severity||"info").toLowerCase().slice(0,20),message:String(msg.message||"").slice(0,4000),details:boundedWsObject(msg.details||{},"Lab agent event details",32*1024),occurredAt:String(msg.occurredAt||new Date().toISOString()).slice(0,50)};
        audit({kind:"lab.agent.event",id:ws.labAgentId,...event});broadcastControllers({type:"lab.agent.event",id:ws.labAgentId,event});return wsSend(ws,{type:"lab.agent.event.ack",ok:true});
      }
      if (msg.type === "lab.history" && ws.role === "lab-agent") {
        const result=ingestLabHistory(ws.labAgentId,msg.items||[]);upsertLabComputer(ws.labAgentId,{lastHistoryAt:new Date().toISOString()});
        if(!result.disabled)broadcastControllers({type:"lab.history",id:ws.labAgentId,latest:result.latest||null,added:result.added});return wsSend(ws,{type:"lab.history.ack",...result});
      }
      if (msg.type === "lab.screenshot" && ws.role === "lab-agent") {
        try{
          const id=ws.labAgentId;
          const b64=String(msg.data||"");
          if(!b64)throw new Error("Empty screenshot");
          const bytes=Buffer.from(b64,"base64");
          if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)throw new Error("Screenshot is not a valid JPEG image");
          if(bytes.length>8*1024*1024)throw new Error("Screenshot exceeds 8 MB");

          const now=new Date();
          const save=msg.save===true;
          const alertId=String(msg.alertId||"").trim();
          const linkedAlert=alertId?labAiAlertsStore.alerts.find(a=>a.id===alertId):null;
          if(alertId&&(!linkedAlert||linkedAlert.agentId!==id))throw new Error("Alert does not belong to this lab agent");
          const dir=path.join(LAB_SCREENSHOT_DIR,id);
          fs.mkdirSync(dir,{recursive:true});

          // Live-view frames always overwrite one transient file.
          // Explicit screenshots get their own timestamped retained file.
          const file=save
            ? `${now.toISOString().replace(/[:.]/g,"-")}.jpg`
            : `live.jpg`;
          const rel=path.join(id,file);
          const full=path.join(dir,file);
          fs.writeFileSync(full,bytes,{mode:0o600});

          const rec=labComputerStore.computers[id];
          if(rec){
            rec.screenshotFile=rel;
            rec.screenshotAt=now.toISOString();
            rec.screenshotWidth=Number(msg.width||0)||null;
            rec.screenshotHeight=Number(msg.height||0)||null;
            rec.screenshotBytes=bytes.length;

            if(save){
              if(!Array.isArray(rec.screenshotHistory))rec.screenshotHistory=[];
              rec.screenshotHistory.unshift({
                file:rel,
                capturedAt:now.toISOString(),
                bytes:bytes.length,
                width:rec.screenshotWidth,
                height:rec.screenshotHeight
              });
              const dropped=rec.screenshotHistory.slice(500);rec.screenshotHistory=rec.screenshotHistory.slice(0,500);
              for(const old of dropped){try{fs.rmSync(safeScreenshotPath(id,old.file),{force:true})}catch{}}
            }

            persistLabComputers();
          }

          if(alertId){
            const alert=linkedAlert;
            if(alert){
              alert.screenshotUrl=`/api/v1/lab/computers/${encodeURIComponent(id)}/screenshots/file?file=${encodeURIComponent(rel)}`;
              alert.screenshotAt=now.toISOString();
              alert.screenshotFile=rel;
              persistLabAiAlerts();
              broadcastControllers({type:"lab.ai.alert.updated",alert});
            }
          }

          broadcastControllers({
            type:"lab.screenshot",
            id,
            screenshotUrl:`/api/v1/lab/computers/${encodeURIComponent(id)}/screenshot?t=${Date.now()}`
          });

          return wsSend(ws,{type:"lab.screenshot.ack",ok:true,saved:save});
        }catch(err){
          return wsSend(ws,{type:"lab.screenshot.ack",ok:false,error:err.message});
        }
      }

      if (msg.type === "lab.command.result" && ws.role === "lab-agent") {
        const id=ws.labAgentId,rec=labComputerStore.computers[id];if(rec){rec.lastCommand={...(rec.lastCommand||{}),
          id:String(msg.commandId||rec.lastCommand?.id||""),
          action:String(msg.action||rec.lastCommand?.action||""),
          status:msg.ok===false?"failed":"completed",
          completedAt:new Date().toISOString(),
          message:String(msg.message||"").slice(0,4000),
          result:msg.result&&typeof msg.result==="object"?msg.result:null
        };persistLabComputers()}
        audit({kind:"lab.command.result",id,commandId:msg.commandId,action:msg.action,ok:msg.ok!==false,message:msg.message||""});broadcastControllers({type:"lab.status",computer:publicLabComputer(id)});return;
      }

      if (msg.type === "command" && (ws.role === "controller" || ws.role === "admin")) {
        if(dbStore.authEnabled()){
          const user=dbStore.sessionUser(ws.sessionToken);
          if(ws.role==="admin"?(!hasRole(user,"admin")||!hasCapability(user,"*")):!hasCapability(user,"classroom.control"))throw new Error("Session expired, was revoked, or no longer has the required permission");
        }
        const result = await executeCommand(msg.command || msg, "websocket");
        return wsSend(ws, { type: "command.ack", result });
      }

      if (msg.type === "ping") {
        return wsSend(ws, { type: "pong", at: Date.now() });
      }

      throw new Error("Unknown WebSocket message");
    } catch (err) {
      wsSend(ws, { type: "error", error: err.message });
      if(msg?.type==="hello"&&ws.role==="unknown")setTimeout(()=>{try{ws.close(1008,"Authentication failed")}catch{}},25);
    }
  });

  ws.on("close", () => {
    clearTimeout(ws.helloTimer);
    wsClients.delete(ws);
    runtime.websocketClients = wsClients.size;

    if (ws.role === "lab-agent" && ws.labAgentId) markLabSocketDisconnected(ws);

    if (ws.role === "display" && ws.deviceId) {
      const current=runtime.displays[ws.deviceId]||{};

      // Ignore stale close events from an older replaced/reconnected socket.
      if (current.connectionId === ws.connectionId) {
        runtime.displays[ws.deviceId] = {
          ...current,
          disconnectedAt: new Date().toISOString()
        };

        broadcastControllers({
          type: "device.status",
          deviceId: ws.deviceId,
          status: publicDisplayStatus(ws.deviceId)
        });

        audit({ kind: "display.disconnected", deviceId: ws.deviceId, connectionId: ws.connectionId });
      } else {
        audit({
          kind: "display.stale-disconnect-ignored",
          deviceId: ws.deviceId,
          closingConnectionId: ws.connectionId,
          currentConnectionId: current.connectionId || null
        });
      }
    }
  });
});

const heartbeatTimer = setInterval(() => {
  for (const ws of wsClients) {
    if(dbStore.authEnabled()&&["controller","admin","preview"].includes(ws.role)&&(!ws.sessionToken||!dbStore.sessionUser(ws.sessionToken))){ws.close(1008,"Session expired or revoked");continue}
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

server.on("close", () => clearInterval(heartbeatTimer));


// Conditional Morning Announcements watcher. Runs independently from fixed-time events.
// It only probes during the configured school-day window and releases the displays back to
// the normal scheduler as soon as the live stream ends (with offline confirmation debounce).
restartMorningAnnouncementsWatcher();

// Background Music has its own scheduler and is intentionally independent of Classroom Automation.
const backgroundMusicTimer=setInterval(()=>backgroundMusicTick().catch(error=>diagnosticError(error,{component:"music-assistant",operation:"background-music-tick"})),5000);backgroundMusicTimer.unref();
const backgroundMusicStartupTimer=setTimeout(()=>backgroundMusicTick().catch(error=>diagnosticError(error,{component:"music-assistant",operation:"background-music-startup"})),3500);backgroundMusicStartupTimer.unref();

// Unified Classroom Automation scheduler
// Uses configured classroom timezone and a short restart/outage catch-up window.
let automationSchedulerBusy=false;
setInterval(async()=>{
  if(automationSchedulerBusy)return;automationSchedulerBusy=true;
  try{
  const now=new Date();
  const dateKey=localDateKey(now);
  const nowMinutes=now.getHours()*60+now.getMinutes();
  let changed=false;

  for(const storedEvent of classroomAutomations.events){
    if(!storedEvent?.enabled)continue;
    const referenceDates=[-1,0,1].map(offset=>{const d=new Date(now);d.setDate(d.getDate()+offset);return d});
    const occurrences=automationClassIds(storedEvent).length
      ? referenceDates.flatMap(referenceDate=>resolveAutomationOccurrences(storedEvent,referenceDate)).filter(event=>event._scheduledDateKey===dateKey)
      : [storedEvent];
    for(const event of occurrences){
      const dateMatch=event._sourceDateMatched?{match:true,reason:"Class occurrence"}:automationMatchesDate(event,now);
      if(!dateMatch.match)continue;
      const [eventHour,eventMinute]=String(event.time||"00:00").split(":").map(Number);
      const scheduledMinutes=eventHour*60+eventMinute,deltaMinutes=nowMinutes-scheduledMinutes;
      if(deltaMinutes<0||deltaMinutes>SCHEDULER_CATCHUP_MINUTES)continue;
      const occurrenceKey=event.classId||"manual";
      const scheduledMinuteKey=`${dateKey} ${event.time}`;
      storedEvent.lastExecByClass=storedEvent.lastExecByClass||{};
      if(storedEvent.lastExecByClass[occurrenceKey]===scheduledMinuteKey)continue;
      if(morningAnnouncementsRuntime.active){
        queueAutomationDuringAnnouncements(storedEvent,event,dateKey,scheduledMinuteKey,deltaMinutes);changed=true;continue;
      }
      storedEvent.lastExecByClass[occurrenceKey]=scheduledMinuteKey;
      storedEvent.lastExec=scheduledMinuteKey;changed=true;
      try{
        const runResult=await runClassroomAutomation(event);
        storedEvent.lastRun={at:new Date().toISOString(),scheduledFor:`${dateKey} ${event.time}`,resolvedClassId:event.classId||null,delayMinutes:deltaMinutes,ok:runResult.ok!==false,message:runResult.ok===false?"Completed with action errors":(deltaMinutes>0?`Completed (${deltaMinutes} min catch-up)`:"Completed"),resultSummary:{action:event.action,actions:[event.action,...(event.actions||[]).map(x=>x.action)],targets:event.targets,failures:automationRunFailures(runResult)}};
      }catch(err){
        storedEvent.lastRun={at:new Date().toISOString(),scheduledFor:`${dateKey} ${event.time}`,resolvedClassId:event.classId||null,delayMinutes:deltaMinutes,ok:false,message:err.message};
        audit({kind:"automation.error",automationId:storedEvent.id,name:storedEvent.name,error:err.message});
      }
      storedEvent.updatedAt=new Date().toISOString();
    }
  }
  if(changed)persistAutomations();
  }catch(error){diagnosticError(error,{component:"automation",operation:"scheduler-tick"})}
  finally{automationSchedulerBusy=false}
},15000);

// Legacy per-output Pluto schedules retained for migration/backward compatibility.
// Direct Pluto schedule executor (replaces Node-RED schedule tick)
setInterval(async()=>{
  const now=new Date(),hhmm=String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
  const day=now.getDay(),minuteKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${hhmm}`;
  let changed=false;
  if(isAutomationSuppressed(now).blocked)return;
  for(const sch of Object.values(plutoSchedules)){
    if(!sch?.enabled||!Array.isArray(sch.days)||!sch.days.map(Number).includes(day))continue;
    sch.lastExec=sch.lastExec||{};sch.lastRun=sch.lastRun||{};
    for(const [kind,time,index] of [["on",sch.onTime,0],["off",sch.offTime,1]]){
      if(time===hhmm&&sch.lastExec[kind]!==minuteKey){
        sch.lastExec[kind]=minuteKey;
        try{
          await directPluto({action:"cecOutput",output:Number(sch.index),connection:sch.type,index});
          sch.lastRun={text:`${kind==="on"?"On":"Off"} ${now.toLocaleString()}`,stamp:Date.now(),ok:true};
        }catch(e){
          sch.lastRun={text:`ERROR ${now.toLocaleString()}: ${e.message}`,stamp:Date.now(),ok:false};
        }
        changed=true;
      }
    }
  }
  if(changed)persistPlutoSchedules();
},15000);

connectMqtt();

try{
  const result=dbStore.importAuditJsonl(AUDIT_FILE,{archive:true});
  if(result.imported)console.log(`Imported ${result.imported} legacy audit events into SQLite`);
}catch(err){console.warn(`Legacy audit migration skipped: ${err.message}`)}

server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`Classroom Control Hub Backend v${APPLICATION_VERSION} listening on ${BIND_ADDRESS}:${PORT}`);
  console.log(`Scheduler timezone: ${SCHEDULER_TIMEZONE}; local time: ${schedulerLocalTimestamp()}; catch-up: ${SCHEDULER_CATCHUP_MINUTES} minute(s)`);
  console.log(`Room: ${deviceConfig.room || ROOM_NAME}`);
  console.log(`MQTT: ${MQTT_URL || "disabled"}`);
  console.log("Node-RED: not required (v0.8 direct hardware mode)");
});
const goveeReconcileTimer=setInterval(()=>reconcileGoveeDiscovery(),60000);
function gracefulShutdown(signal){
  if(shuttingDown)return;shuttingDown=true;console.log(`${signal} received; draining Classroom Control Hub`);
  clearInterval(heartbeatTimer);clearInterval(veyonPoolTimer);clearInterval(goveeReconcileTimer);clearInterval(automaticUpdateTimer);clearInterval(updateJobSyncTimer);clearInterval(studentDataPruneTimer);if(morningAnnouncementsTimer)clearTimeout(morningAnnouncementsTimer);
  for(const ws of wsClients)try{ws.close(1001,"Server shutting down")}catch{};
  try{wss.close()}catch{};try{maSendspinProxyWss.close()}catch{};try{musicAssistantApiClose("server shutdown")}catch{};try{if(mqttClient)mqttClient.end(true)}catch{};
  const force=setTimeout(()=>process.exit(1),10000);force.unref();
  server.close(()=>{try{dbStore.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");dbStore.db.close()}catch{};clearTimeout(force);process.exit(0)});
}
process.once("SIGTERM",()=>gracefulShutdown("SIGTERM"));process.once("SIGINT",()=>gracefulShutdown("SIGINT"));
