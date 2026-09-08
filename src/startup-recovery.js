"use strict";

const fs=require("fs");
const path=require("path");
const {DatabaseSync}=require("node:sqlite");

function canonicalDatabaseFile(){
  const configured=String(process.env.DATABASE_FILE||"").trim();
  if(configured)return configured;
  const dataDir=path.resolve(process.env.DATA_DIR||path.join(__dirname,"..","data"));
  const canonical=path.join(dataDir,"classroom-control-hub.db");
  const alpha70=path.join(dataDir,"classroom-hub.db");
  if(fs.existsSync(canonical))return canonical;
  if(fs.existsSync(alpha70))return alpha70;
  return canonical;
}

function validCapabilityArray(value){return Array.isArray(value)&&value.length>0&&value.every(x=>typeof x==="string"&&x.trim())}

function reconcileBuiltInProfiles(db){
  const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='access_profiles'").get();
  if(!table)return;
  const defaults={
    administrator:{description:"Full Classroom Hub administration and system management.",capabilities:["*"]},
    technician:{description:"Classroom operations, student-computer diagnostics and integrations.",capabilities:["classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","lab.sensitive.read","diagnostics.read","diagnostics.run"]},
    teacher:{description:"Daily classroom, display, lighting, AV and schedule operations.",capabilities:["classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","diagnostics.read"]},
    "read-only":{description:"View classroom status without student browsing history or screenshots.",capabilities:["classroom.read"]}
  };
  const select=db.prepare("SELECT id,config_json FROM access_profiles WHERE id=?");
  const update=db.prepare("UPDATE access_profiles SET config_json=?,updated_at=? WHERE id=?");
  for(const [id,def] of Object.entries(defaults)){
    const row=select.get(id);if(!row)continue;
    let config={};try{config=JSON.parse(row.config_json||"{}")||{}}catch{}
    if(validCapabilityArray(config.capabilities))continue;
    config.description=String(config.description||def.description);
    config.capabilities=def.capabilities;
    update.run(JSON.stringify(config),new Date().toISOString(),id);
    console.warn(`Startup recovery restored capabilities for built-in access profile ${id}.`);
  }
}

function veyonInventory(value){
  if(!value||typeof value!=="object")return {version:2,computers:{}};
  const computers=value.computers&&typeof value.computers==="object"?value.computers:{};
  return {version:Math.max(2,Number(value.version)||2),computers};
}

function migrateLegacyVeyonInventory(db,dbFile){
  const legacy=path.join(path.dirname(dbFile),"veyon-computers.json");
  if(!fs.existsSync(legacy))return;
  const hasObjectStore=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='object_store'").get();
  if(!hasObjectStore)return;
  let legacyValue;
  try{legacyValue=veyonInventory(JSON.parse(fs.readFileSync(legacy,"utf8")))}catch(error){console.warn(`Legacy Veyon inventory was not migrated: ${error.message}`);return}
  const existing=db.prepare("SELECT value_json FROM object_store WHERE namespace='veyon-computers'").get();
  let databaseValue={version:2,computers:{}};
  if(existing?.value_json){try{databaseValue=veyonInventory(JSON.parse(existing.value_json))}catch{}}
  const merged={version:2,computers:{...legacyValue.computers,...databaseValue.computers}};
  const now=new Date().toISOString();
  db.prepare(`INSERT INTO object_store(namespace,value_json,source_file,created_at,updated_at)
    VALUES('veyon-computers',?,?,?,?)
    ON CONFLICT(namespace) DO UPDATE SET value_json=excluded.value_json,source_file=NULL,updated_at=excluded.updated_at`)
    .run(JSON.stringify(merged),null,now,now);
  const verified=veyonInventory(JSON.parse(db.prepare("SELECT value_json FROM object_store WHERE namespace='veyon-computers'").get().value_json));
  const expectedCount=Object.keys(merged.computers).length,actualCount=Object.keys(verified.computers).length;
  if(actualCount!==expectedCount)throw Error(`Veyon inventory migration verification failed (${actualCount}/${expectedCount})`);
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='migration_history'").get()){
    const already=db.prepare("SELECT 1 FROM migration_history WHERE source=? AND target=? LIMIT 1").get(legacy,"sqlite:object_store/veyon-computers");
    if(!already)db.prepare("INSERT INTO migration_history(source,target,records,details_json,migrated_at) VALUES(?,?,?,?,?)")
      .run(legacy,"sqlite:object_store/veyon-computers",actualCount,JSON.stringify({type:"json",authoritative:"sqlite",legacyFileRemoved:true}),now);
  }
  fs.rmSync(legacy,{force:true});
  console.warn(`Startup recovery migrated ${actualCount} Veyon computers into SQLite and retired the legacy JSON file.`);
}

function adoptSynchronizedVeyonKeyName(){
  const marker=String(process.env.VEYON_KEY_NAME_FILE||"").trim();
  if(!marker||!fs.existsSync(marker))return;
  let keyName="";
  try{keyName=fs.readFileSync(marker,"utf8").trim()}catch(error){console.warn(`Synchronized Veyon key-name marker could not be read: ${error.message}`);return}
  if(!/^[A-Za-z][A-Za-z0-9._-]*$/.test(keyName)){
    console.warn("Synchronized Veyon key-name marker was ignored because it is invalid.");
    return;
  }
  const previous=String(process.env.VEYON_KEY_NAME||"").trim();
  process.env.VEYON_KEY_NAME=keyName;
  if(previous&&previous!==keyName)console.warn(`Startup recovery adopted synchronized Veyon key '${keyName}' instead of stale configured key '${previous}'.`);
}

function reconcileVeyonSecretMetadata(db){
  const keyName=String(process.env.VEYON_KEY_NAME||"").trim();
  if(!keyName)return;
  const hasSecretStore=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='secret_store'").get();
  if(!hasSecretStore)return;
  const row=db.prepare("SELECT metadata_json FROM secret_store WHERE name='veyon.private-key'").get();
  if(!row)return;
  let metadata={};try{metadata=JSON.parse(row.metadata_json||"{}")||{}}catch{}
  if(metadata.keyName===keyName)return;
  metadata={...metadata,type:metadata.type||"private-key",integration:"veyon",keyName};
  db.prepare("UPDATE secret_store SET metadata_json=?,updated_at=? WHERE name='veyon.private-key'")
    .run(JSON.stringify(metadata),new Date().toISOString());
  console.warn(`Startup recovery reconciled Veyon private-key metadata to '${keyName}'.`);
}

function enableDirectDisplayAccess(){
  const {ClassroomHubStorage}=require("./storage");
  const previous=ClassroomHubStorage.prototype.authenticateDisplay;
  if(previous?.__directDisplayAccess)return;
  function authenticateConfiguredDisplay(displayId){
    const id=String(displayId||"").trim();
    if(!id)return null;
    const row=this.db.prepare("SELECT id,enabled FROM display_devices WHERE id=? LIMIT 1").get(id);
    if(!row||Number(row.enabled)===0)return null;
    return {id:`direct:${id}`,displayId:id,label:"Configured display URL",direct:true};
  }
  authenticateConfiguredDisplay.__directDisplayAccess=true;
  ClassroomHubStorage.prototype.authenticateDisplay=authenticateConfiguredDisplay;
  console.warn("Direct display URL access enabled: configured displays authenticate by stable display ID; enrollment credentials are no longer required.");
}

adoptSynchronizedVeyonKeyName();
const dbFile=canonicalDatabaseFile();
process.env.DATABASE_FILE=dbFile;
if(fs.existsSync(dbFile)){
  const db=new DatabaseSync(dbFile);
  try{
    reconcileBuiltInProfiles(db);
    migrateLegacyVeyonInventory(db,dbFile);
    reconcileVeyonSecretMetadata(db);
  }finally{db.close()}
}

enableDirectDisplayAccess();
// Register scoped maintenance-agent route mirrors before server.js creates the
// Express routes. Database writes and secret encryption still execute inside
// server.js handlers; the bridge only supplies maintenance-token authorization.
require("./maintenance-route-bridge");
require("./server");
