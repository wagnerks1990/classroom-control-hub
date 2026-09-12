"use strict";

const crypto=require("crypto");

// Diagnostic archives are intended to be safe to attach to a support case.
// Keep this as an explicit allowlist: a newly added runtime-data directory must
// not silently become part of a diagnostic bundle.
// Diagnostic archives contain generated, field-allowlisted JSON only. Raw
// project files are deliberately excluded because even a package manifest or
// Compose override can contain a site-local credential or private endpoint.
const DIAGNOSTIC_BACKUP_FILES=Object.freeze([]);

function diagnosticBackupEntryAllowed(relativePath,isDirectory=false){
  const normalized=String(relativePath||"").replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/$/,"");
  if(!normalized)return false;
  if(isDirectory)return DIAGNOSTIC_BACKUP_FILES.some(file=>file.startsWith(`${normalized}/`));
  return DIAGNOSTIC_BACKUP_FILES.includes(normalized);
}

// Every recovery scope except diagnostic can contain local deployment details,
// device identifiers, credentials, student information, or operational state.
function backupContainsSensitiveData(scope){return String(scope||"")!=="diagnostic"}

// Native Veyon is recovered through its bounded identity files under
// recovery-secrets/veyon.  /opt/services/veyon-webapi is not a RoomGoblin-owned
// Docker service and must not be archived as managed service state.
const FULL_RECOVERY_SERVICE_ROOTS=Object.freeze(["govee2mqtt","mosquitto","music-assistant","nodered"]);
const FULL_RECOVERY_SERVICE_SPECS=Object.freeze({
  govee2mqtt:{container:"govee2mqtt",image:"ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72"},
  mosquitto:{container:"mosquitto",image:"eclipse-mosquitto:2.0.22"},
  "music-assistant":{container:"music-assistant-server",image:"ghcr.io/music-assistant/server:2.9.13"},
  nodered:{container:"nodered",image:"nodered/node-red:4.1.14-22"}
});
const FULL_RECOVERY_EXCLUDED_SEGMENTS=new Set(["backups","cache","caches","file-trash","legacy","log","logs","tmp","convert-tmp","presentation-upload-tmp"]);
const FULL_RECOVERY_DATA_FILES=new Set([
  "classroom-hub/data/classroom-control-hub.db",
  // Transitional extension state: Android inventory is not yet normalized into
  // the main SQLite store and may contain Device Agent credentials.
  "classroom-hub/data/android-tv/devices.json",
  "classroom-hub/data/android-tv/.android/adbkey",
  "classroom-hub/data/android-tv/.android/adbkey.pub"
]);
const FULL_RECOVERY_DATA_ROOTS=Object.freeze([
  "classroom-hub/data/lab-screenshots",
  "classroom-hub/data/lab-updates",
  "classroom-hub/data/media",
  "classroom-hub/data/presentations"
]);
const FULL_RECOVERY_SIGNING_FILES=new Set([
  "recovery-secrets/android-agent-signing/android-agent/RoomGoblin-Display-Agent.keystore",
  "recovery-secrets/android-agent-signing/android-agent/password"
]);
const FULL_RECOVERY_VEYON_FILES=new Set([
  "recovery-secrets/veyon/private.pem",
  "recovery-secrets/veyon/key-name"
]);
const FULL_RECOVERY_REQUIRED_MODES=Object.freeze({
  "classroom-hub/data/classroom-control-hub.db":"0660",
  "classroom-hub/data/android-tv/devices.json":"0660",
  "classroom-hub/data/android-tv/.android/adbkey":"0600",
  "classroom-hub/data/android-tv/.android/adbkey.pub":"0644",
  "recovery-secrets/classroom-hub-master.key":"0640",
  "recovery-secrets/android-agent-signing/android-agent/RoomGoblin-Display-Agent.keystore":"0600",
  "recovery-secrets/android-agent-signing/android-agent/password":"0600",
  "recovery-secrets/veyon/private.pem":"0640",
  "recovery-secrets/veyon/key-name":"0644"
});

function normalizedArchivePath(value){return String(value||"").replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/$/,"")}
function canonicalArchivePath(value){const raw=String(value||"");return raw===normalizedArchivePath(raw)&&!raw.startsWith("/")&&!raw.endsWith("/")&&!raw.includes("//")&&raw.split("/").every(part=>part&&part!=="."&&part!=="..")}

// The portable export contains runtime state, never the application checkout or
// host-local deployment configuration. Adding a new top-level path therefore
// requires an explicit policy change and a matching recovery test.
function fullRecoveryEntryAllowed(value,isDirectory=false){
  const raw=String(value||""),normalized=normalizedArchivePath(raw),parts=normalized.split("/").filter(Boolean);
  if(!canonicalArchivePath(raw))return false;
  if(normalized==="backup-manifest.json")return !isDirectory;
  if(normalized==="recovery-secrets/classroom-hub-master.key")return !isDirectory;
  if(FULL_RECOVERY_SIGNING_FILES.has(normalized))return !isDirectory;
  if(FULL_RECOVERY_VEYON_FILES.has(normalized))return !isDirectory;
  if(FULL_RECOVERY_DATA_FILES.has(normalized))return !isDirectory;
  if(isDirectory&&["classroom-hub","classroom-hub/data","classroom-hub/data/android-tv","classroom-hub/data/android-tv/.android",...FULL_RECOVERY_DATA_ROOTS].includes(normalized))return true;
  if(FULL_RECOVERY_DATA_ROOTS.some(root=>normalized.startsWith(`${root}/`)))return !parts.some(part=>FULL_RECOVERY_EXCLUDED_SEGMENTS.has(part.toLowerCase()));
  if(parts[0]==="services"&&FULL_RECOVERY_SERVICE_ROOTS.includes(parts[1])&&parts.length>2){
    return !parts.slice(2).some(part=>FULL_RECOVERY_EXCLUDED_SEGMENTS.has(part.toLowerCase()));
  }
  // Root directories may be emitted by ZIP tooling, but may not contain data.
  if(isDirectory&&["services","recovery-secrets"].includes(normalized))return true;
  if(isDirectory&&parts[0]==="services"&&parts.length===2&&FULL_RECOVERY_SERVICE_ROOTS.includes(parts[1]))return true;
  if(isDirectory&&["recovery-secrets/android-agent-signing","recovery-secrets/android-agent-signing/android-agent"].includes(normalized))return true;
  if(isDirectory&&normalized==="recovery-secrets/veyon")return true;
  return false;
}

function recoveryRole(name){
  if(name==="recovery-secrets/classroom-hub-master.key")return "master-key";
  if(FULL_RECOVERY_SIGNING_FILES.has(name))return "android-signing";
  if(FULL_RECOVERY_VEYON_FILES.has(name))return "veyon-identity";
  if(name==="classroom-hub/data/classroom-control-hub.db")return "database";
  if(name==="classroom-hub/data/android-tv/devices.json")return "android-inventory";
  if(name==="classroom-hub/data/android-tv/.android/adbkey"||name==="classroom-hub/data/android-tv/.android/adbkey.pub")return "adb-trust";
  if(name.startsWith("classroom-hub/data/"))return "application-data";
  if(name.startsWith("services/"))return "service-state";
  throw Error(`Portable recovery entry has no declared role: ${name}`);
}

function archiveInventory(entries){
  return entries.filter(entry=>!entry.isDirectory&&normalizedArchivePath(entry.entryName)!=="backup-manifest.json").map(entry=>{
    const name=normalizedArchivePath(entry.entryName),data=entry.getData();
    if(!fullRecoveryEntryAllowed(name,false))throw Error(`Unexpected portable recovery entry: ${name}`);
    const mode=FULL_RECOVERY_REQUIRED_MODES[name]||(name.startsWith("services/")?"0660":"0660");
    return {path:name,role:recoveryRole(name),size:data.length,sha256:crypto.createHash("sha256").update(data).digest("hex"),mode};
  }).sort((a,b)=>a.path.localeCompare(b.path));
}

function topologyPolicy(pathName,type,role){
  if(type==="file"){
    if(pathName==="classroom-hub/data/android-tv/devices.json")return {uid:0,gid:10001,mode:"0660"};
    if(pathName.startsWith("classroom-hub/data/android-tv/.android/"))return {uid:10001,gid:10001,mode:FULL_RECOVERY_REQUIRED_MODES[pathName]};
    if(pathName==="recovery-secrets/classroom-hub-master.key")return {uid:0,gid:10001,mode:"0640"};
    if(pathName.startsWith("recovery-secrets/android-agent-signing/"))return {uid:10001,gid:10001,mode:"0600"};
    if(pathName==="recovery-secrets/veyon/private.pem")return {uid:0,gid:10001,mode:"0640"};
    if(pathName==="recovery-secrets/veyon/key-name")return {uid:0,gid:0,mode:"0644"};
    return {uid:10001,gid:10001,mode:"0660"};
  }
  if(pathName==="classroom-hub/data")return {uid:0,gid:10001,mode:"0770"};
  if(pathName==="classroom-hub/data/android-tv")return {uid:0,gid:10001,mode:"02770"};
  if(pathName.startsWith("classroom-hub/data/android-tv/.android"))return {uid:10001,gid:10001,mode:"0700"};
  if(pathName==="recovery-secrets"||pathName==="recovery-secrets/veyon")return {uid:0,gid:10001,mode:"0750"};
  if(pathName.startsWith("recovery-secrets/android-agent-signing"))return {uid:10001,gid:10001,mode:"0700"};
  if(pathName==="services")return {uid:0,gid:10001,mode:"0770"};
  return {uid:10001,gid:10001,mode:"0770"};
}

function recoveryTopology(files){
  const paths=new Map();
  for(const file of files){
    let parent=file.path;
    while(parent.includes("/")){parent=parent.slice(0,parent.lastIndexOf("/"));if(parent==="classroom-hub")break;paths.set(parent,{path:parent,type:"directory",role:parent.startsWith("services")?"service-state":parent.startsWith("recovery-secrets")?"recovery-secrets":"application-data",...topologyPolicy(parent,"directory")})}
    paths.set(file.path,{path:file.path,type:"file",role:file.role,...topologyPolicy(file.path,"file",file.role)});
  }
  return [...paths.values()].sort((a,b)=>a.path.localeCompare(b.path));
}

function verifyArchiveInventory(entries,manifest){
  const manifestVersion=Number(manifest?.version);
  if(!manifest||manifest.scope!=="full"||![5,6].includes(manifestVersion))throw Error("Portable recovery archive requires a supported full manifest");
  if(manifestVersion===6&&Object.keys(manifest).sort().join(",")!=="applicationVersion,confidentiality,databaseSchemaVersion,files,integrityAlgorithm,managedServices,scope,topology,version")throw Error("Portable recovery archive manifest fields do not match the version 6 contract");
  if(manifestVersion===6&&(manifest.confidentiality!=="scrypt-aes-256-gcm"||typeof manifest.applicationVersion!=="string"||manifest.applicationVersion.length<1||manifest.applicationVersion.length>100||!Number.isSafeInteger(manifest.databaseSchemaVersion)||manifest.databaseSchemaVersion<1||!Array.isArray(manifest.topology)))throw Error("Portable recovery archive contains invalid version 6 compatibility metadata");
  if(manifest.integrityAlgorithm!=="sha256"||!Array.isArray(manifest.files))throw Error("Portable recovery archive is missing its SHA-256 file inventory");
  const seen=new Set(),folded=new Set();
  for(const entry of entries){
    const name=normalizedArchivePath(entry.entryName),lower=name.toLowerCase();
    if(!canonicalArchivePath(entry.entryName))throw Error(`Portable recovery archive contains a non-canonical entry: ${entry.entryName}`);
    if(seen.has(name)||folded.has(lower))throw Error(`Portable recovery archive contains a duplicate or case-colliding entry: ${name}`);
    seen.add(name);folded.add(lower);
    if(!fullRecoveryEntryAllowed(name,entry.isDirectory))throw Error(`Unexpected portable recovery entry: ${name}`);
  }
  const actual=archiveInventory(entries),declared=[...manifest.files].sort((a,b)=>String(a?.path||"").localeCompare(String(b?.path||"")));
  if(actual.length!==declared.length)throw Error("Portable recovery archive file set does not match its manifest");
  for(let i=0;i<actual.length;i++){
    const expected=declared[i]||{},observed=actual[i];
    if(!expected||Object.keys(expected).sort().join(",")!=="mode,path,role,sha256,size"||expected.path!==observed.path||expected.role!==observed.role||expected.mode!==observed.mode||Number(expected.size)!==observed.size||!/^([a-f0-9]{64})$/.test(String(expected.sha256||""))||!crypto.timingSafeEqual(Buffer.from(expected.sha256,"hex"),Buffer.from(observed.sha256,"hex"))){
      throw Error(`Portable recovery integrity check failed for ${observed.path}`);
    }
  }
  const actualPaths=new Set(actual.map(file=>file.path));
  for(const required of ["classroom-hub/data/classroom-control-hub.db","recovery-secrets/classroom-hub-master.key"]){
    if(!actualPaths.has(required))throw Error(`Portable recovery archive is missing indispensable entry: ${required}`);
  }
  if(manifestVersion===5)return actual;
  const pair=(left,right,label)=>{if(actualPaths.has(left)!==actualPaths.has(right))throw Error(`Portable recovery archive contains an incomplete ${label} pair`)};
  pair("classroom-hub/data/android-tv/.android/adbkey","classroom-hub/data/android-tv/.android/adbkey.pub","ADB trust");
  pair("recovery-secrets/android-agent-signing/android-agent/RoomGoblin-Display-Agent.keystore","recovery-secrets/android-agent-signing/android-agent/password","Android signing identity");
  pair("recovery-secrets/veyon/private.pem","recovery-secrets/veyon/key-name","Veyon identity");
  if(!Array.isArray(manifest.managedServices))throw Error("Portable recovery archive is missing its managed-service plan");
  const serviceIds=new Set();
  for(const service of manifest.managedServices){
    const spec=service&&FULL_RECOVERY_SERVICE_SPECS[service.id];
    if(!spec||Object.keys(service).sort().join(",")!=="container,deploymentOwnership,enabled,id,image,running"||serviceIds.has(service.id)||service.container!==spec.container||service.image!==spec.image||typeof service.enabled!=="boolean"||typeof service.running!=="boolean"||(service.running&&!service.enabled)||service.deploymentOwnership!=="roomgoblin")throw Error("Portable recovery archive contains an invalid managed-service plan");
    serviceIds.add(service.id);
  }
  const topology=recoveryTopology(actual);
  if(JSON.stringify(manifest.topology)!==JSON.stringify(topology))throw Error("Portable recovery archive topology does not match the fixed ownership policy");
  return actual;
}

function parseMasterKey(value){
  const raw=Buffer.isBuffer(value)?Buffer.from(value):Buffer.from(String(value||""));
  const trimmed=Buffer.from(raw.toString("utf8").trim());
  if(trimmed.length===64&&/^[a-fA-F0-9]{64}$/.test(trimmed.toString()))return Buffer.from(trimmed.toString(),"hex");
  if(raw.length===32)return raw;
  try{const decoded=Buffer.from(trimmed.toString(),"base64");if(decoded.length===32)return decoded}catch{}
  throw Error("Database encryption master key must decode to exactly 32 bytes");
}

function diagnosticText(value,max=200){return String(value||"").replace(/[^A-Za-z0-9._:/@+() -]/g,"?").slice(0,max)}

// Build support documents from explicit scalar allowlists. In particular, do
// not accept log text, Docker labels/environment, network addresses, database
// paths, record counts, or arbitrary error messages from the caller.
function diagnosticSupportDocuments({createdAt,agentVersion,application,containers,system}={}){
  const database=application?.database&&typeof application.database==="object"?application.database:null;
  const containerRows=(Array.isArray(containers)?containers:[]).slice(0,250);
  const states={};
  for(const row of containerRows){
    const state=diagnosticText(row?.State,40).toLowerCase()||"unknown";
    states[state]=(states[state]||0)+1;
  }
  return {
    summary:{
      format:2,createdAt:String(createdAt||new Date().toISOString()),agentVersion:diagnosticText(agentVersion,80),
      applicationReachable:application?.ok===true,
      database:database?{available:true,sizeBytes:Number(database.size)||0,schemaVersion:Number(database.schemaVersion)||0,journalMode:diagnosticText(database.journalMode,20),encryptedSecrets:database.encryptedSecrets===true}:{available:false},
      host:{platform:diagnosticText(system?.platform,30),architecture:diagnosticText(system?.architecture,30),cpuCount:Math.max(0,Number(system?.cpuCount)||0),memoryBytes:Math.max(0,Number(system?.memoryBytes)||0)},
      privacy:{rawLogsIncluded:false,studentDataIncluded:false,secretsIncluded:false,networkInventoryIncluded:false}
    },
    containers:{total:containerRows.length,states}
  };
}

module.exports={DIAGNOSTIC_BACKUP_FILES,diagnosticBackupEntryAllowed,backupContainsSensitiveData,diagnosticSupportDocuments,FULL_RECOVERY_SERVICE_ROOTS,FULL_RECOVERY_SERVICE_SPECS,FULL_RECOVERY_REQUIRED_MODES,fullRecoveryEntryAllowed,archiveInventory,recoveryTopology,verifyArchiveInventory,parseMasterKey};
