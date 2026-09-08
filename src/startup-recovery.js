"use strict";

const fs=require("fs");
const path=require("path");
const {DatabaseSync}=require("node:sqlite");

function canonicalDatabaseFile(){
  const configured=String(process.env.DATABASE_FILE||"").trim();
  if(configured)return configured;
  const dataDir=path.resolve(process.env.DATA_DIR||path.join(__dirname,"..","data"));
  const canonical=path.join(dataDir,"classroom-hub.db");
  const legacy=path.join(dataDir,"classroom-control-hub.db");
  if(fs.existsSync(canonical))return canonical;
  if(fs.existsSync(legacy))return legacy;
  return canonical;
}

function validCapabilityArray(value){return Array.isArray(value)&&value.length>0&&value.every(x=>typeof x==="string"&&x.trim())}

function reconcileBuiltInProfiles(db){
  const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='access_profiles'").get();
  if(!table)return;
  const defaults={
    administrator:{name:"Administrator",role:"admin",description:"Full Classroom Hub administration and system management.",capabilities:["*"]},
    technician:{name:"Technician",role:"operator",description:"Classroom operations, student-computer diagnostics and integrations.",capabilities:["classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","lab.sensitive.read","diagnostics.read","diagnostics.run"]},
    teacher:{name:"Teacher",role:"operator",description:"Daily classroom, display, lighting, AV and schedule operations.",capabilities:["classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","diagnostics.read"]},
    "read-only":{name:"Read Only",role:"viewer",description:"View classroom status without student browsing history or screenshots.",capabilities:["classroom.read"]}
  };
  const select=db.prepare("SELECT id,name,role,enabled,config_json FROM access_profiles WHERE id=?");
  const update=db.prepare("UPDATE access_profiles SET config_json=?,updated_at=? WHERE id=?");
  for(const [id,def] of Object.entries(defaults)){
    const row=select.get(id);
    if(!row)continue;
    let config={};try{config=JSON.parse(row.config_json||"{}")||{}}catch{}
    if(validCapabilityArray(config.capabilities))continue;
    config.description=String(config.description||def.description);
    config.capabilities=def.capabilities;
    update.run(JSON.stringify(config),new Date().toISOString(),id);
    console.warn(`Startup recovery restored capabilities for built-in access profile ${id}.`);
  }
}

const dbFile=canonicalDatabaseFile();
process.env.DATABASE_FILE=dbFile;
if(fs.existsSync(dbFile)){
  const db=new DatabaseSync(dbFile);
  try{reconcileBuiltInProfiles(db)}finally{db.close()}
}
require("./server");
