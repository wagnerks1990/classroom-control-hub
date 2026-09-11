"use strict";

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

module.exports={DIAGNOSTIC_BACKUP_FILES,diagnosticBackupEntryAllowed,backupContainsSensitiveData,diagnosticSupportDocuments};
