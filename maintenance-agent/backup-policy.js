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

const FULL_RECOVERY_SERVICE_ROOTS=Object.freeze(["govee2mqtt","mosquitto","music-assistant","nodered","veyon-webapi"]);
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

function normalizedArchivePath(value){return String(value||"").replace(/\\/g,"/").replace(/^\.\//,"").replace(/\/$/,"")}

// The portable export contains runtime state, never the application checkout or
// host-local deployment configuration. Adding a new top-level path therefore
// requires an explicit policy change and a matching recovery test.
function fullRecoveryEntryAllowed(value,isDirectory=false){
  const normalized=normalizedArchivePath(value),parts=normalized.split("/").filter(Boolean);
  if(!normalized||normalized.startsWith("/")||parts.includes(".."))return false;
  if(normalized==="backup-manifest.json")return !isDirectory;
  if(normalized==="recovery-secrets/classroom-hub-master.key")return !isDirectory;
  if(FULL_RECOVERY_SIGNING_FILES.has(normalized))return !isDirectory;
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
  return false;
}

function recoveryRole(name){
  if(name==="recovery-secrets/classroom-hub-master.key")return "master-key";
  if(FULL_RECOVERY_SIGNING_FILES.has(name))return "android-signing";
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
    return {path:name,role:recoveryRole(name),size:data.length,sha256:crypto.createHash("sha256").update(data).digest("hex"),mode:"0600"};
  }).sort((a,b)=>a.path.localeCompare(b.path));
}

function verifyArchiveInventory(entries,manifest){
  if(!manifest||manifest.scope!=="full"||Number(manifest.version)<5)throw Error("Portable recovery archive requires a version 5 full manifest");
  if(manifest.integrityAlgorithm!=="sha256"||!Array.isArray(manifest.files))throw Error("Portable recovery archive is missing its SHA-256 file inventory");
  const seen=new Set(),folded=new Set();
  for(const entry of entries){
    const name=normalizedArchivePath(entry.entryName),lower=name.toLowerCase();
    if(seen.has(name)||folded.has(lower))throw Error(`Portable recovery archive contains a duplicate or case-colliding entry: ${name}`);
    seen.add(name);folded.add(lower);
    if(!fullRecoveryEntryAllowed(name,entry.isDirectory))throw Error(`Unexpected portable recovery entry: ${name}`);
  }
  const actual=archiveInventory(entries),declared=[...manifest.files].sort((a,b)=>String(a?.path||"").localeCompare(String(b?.path||"")));
  if(actual.length!==declared.length)throw Error("Portable recovery archive file set does not match its manifest");
  for(let i=0;i<actual.length;i++){
    const expected=declared[i]||{},observed=actual[i];
    if(expected.path!==observed.path||expected.role!==observed.role||expected.mode!==observed.mode||Number(expected.size)!==observed.size||!/^([a-f0-9]{64})$/.test(String(expected.sha256||""))||!crypto.timingSafeEqual(Buffer.from(expected.sha256,"hex"),Buffer.from(observed.sha256,"hex"))){
      throw Error(`Portable recovery integrity check failed for ${observed.path}`);
    }
  }
  const actualPaths=new Set(actual.map(file=>file.path));
  for(const required of ["classroom-hub/data/classroom-control-hub.db","recovery-secrets/classroom-hub-master.key"]){
    if(!actualPaths.has(required))throw Error(`Portable recovery archive is missing indispensable entry: ${required}`);
  }
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

module.exports={DIAGNOSTIC_BACKUP_FILES,diagnosticBackupEntryAllowed,backupContainsSensitiveData,diagnosticSupportDocuments,FULL_RECOVERY_SERVICE_ROOTS,fullRecoveryEntryAllowed,archiveInventory,verifyArchiveInventory,parseMasterKey};
