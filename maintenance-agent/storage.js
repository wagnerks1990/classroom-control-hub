"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {DatabaseSync}=require("node:sqlite");

function iso(){return new Date().toISOString()}
function keyForFile(file){return path.basename(file).replace(/\.json$/i,"").replace(/\.jsonl$/i,"")}
function ensureParent(file){fs.mkdirSync(path.dirname(file),{recursive:true})}
function parseJson(value,fallback={}){try{return JSON.parse(value)}catch{return fallback}}
function bool(v){return v?1:0}
function targetDomain(action){const a=String(action||"").toLowerCase();if(a.startsWith("govee.")||a.startsWith("lighting."))return "lighting";if(a==="tv.power"||a.startsWith("display.")||a.startsWith("av."))return "display";return "other"}

const NORMALIZED_NAMESPACES=new Set(["devices","hardware","automations","class-schedules","scheduler-calendar","scenes","sessions"]);

class ClassroomHubStorage{
  constructor({dataDir,dbFile,masterKeyFile,legacyMirror=false}){
    this.dataDir=path.resolve(dataDir);
    this.dbFile=path.resolve(dbFile||path.join(this.dataDir,"classroom-control-hub.db"));
    this.masterKeyFile=masterKeyFile||"/run/secrets/classroom-control-hub-master-key";
    this.legacyMirror=!!legacyMirror;
    ensureParent(this.dbFile);
    this.db=new DatabaseSync(this.dbFile);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS object_store(namespace TEXT PRIMARY KEY,value_json TEXT NOT NULL,source_file TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,kind TEXT,payload_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events(at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_kind ON audit_events(kind,at DESC);
      CREATE TABLE IF NOT EXISTS telemetry_state(key TEXT PRIMARY KEY,kind TEXT NOT NULL,payload_json TEXT NOT NULL DEFAULT '{}',first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX IF NOT EXISTS idx_telemetry_state_kind ON telemetry_state(kind,last_seen DESC);
      CREATE TABLE IF NOT EXISTS secret_store(name TEXT PRIMARY KEY,cipher_text TEXT NOT NULL,iv TEXT NOT NULL,auth_tag TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS certificates(name TEXT PRIMARY KEY,certificate_pem TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migration_history(id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL,target TEXT NOT NULL,records INTEGER NOT NULL DEFAULT 0,details_json TEXT NOT NULL DEFAULT '{}',migrated_at TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS site_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS display_devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS device_groups(domain TEXT NOT NULL,name TEXT NOT NULL,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL,PRIMARY KEY(domain,name));
      CREATE TABLE IF NOT EXISTS device_group_members(domain TEXT NOT NULL,group_name TEXT NOT NULL,member_id TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(domain,group_name,member_id),FOREIGN KEY(domain,group_name) REFERENCES device_groups(domain,name) ON DELETE CASCADE);

      CREATE TABLE IF NOT EXISTS integrations(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS managed_modules(id TEXT PRIMARY KEY,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS integration_devices(integration_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL,PRIMARY KEY(integration_id,id),FOREIGN KEY(integration_id) REFERENCES integrations(id) ON DELETE CASCADE);

      CREATE TABLE IF NOT EXISTS class_schedules(id TEXT PRIMARY KEY,name TEXT NOT NULL,start_time TEXT,end_time TEXT,enabled INTEGER NOT NULL DEFAULT 1,data_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scheduler_calendar(id INTEGER PRIMARY KEY CHECK(id=1),skip_federal_holidays INTEGER NOT NULL DEFAULT 1,excluded_dates_json TEXT NOT NULL DEFAULT '[]',updated_at TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS automations(id TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,action TEXT,schedule_mode TEXT,data_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_actions(id TEXT PRIMARY KEY,automation_id TEXT NOT NULL,position INTEGER NOT NULL,action TEXT NOT NULL,target_domain TEXT NOT NULL,use_event_targets INTEGER NOT NULL DEFAULT 0,delay_seconds INTEGER NOT NULL DEFAULT 0,continue_on_error INTEGER NOT NULL DEFAULT 1,payload_json TEXT NOT NULL DEFAULT '{}',FOREIGN KEY(automation_id) REFERENCES automations(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS idx_automation_actions_parent ON automation_actions(automation_id,position);
      CREATE TABLE IF NOT EXISTS automation_targets(action_id TEXT NOT NULL,target_id TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(action_id,target_id),FOREIGN KEY(action_id) REFERENCES automation_actions(id) ON DELETE CASCADE);

      CREATE TABLE IF NOT EXISTS scenes(id TEXT PRIMARY KEY,name TEXT,data_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,data_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
    `);
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(1,'initial sqlite storage',?)").run(iso());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(2,'normalized classroom configuration tables',?)").run(iso());
    this.masterKey=this.loadMasterKey();
    this.migrateNormalizedObjects();
  }

  tx(fn){this.db.exec("BEGIN IMMEDIATE");try{const out=fn();this.db.exec("COMMIT");return out}catch(err){this.db.exec("ROLLBACK");throw err}}
  loadMasterKey(){try{const raw=fs.readFileSync(this.masterKeyFile),text=raw.toString("utf8").trim();if(/^[0-9a-f]{64}$/i.test(text))return Buffer.from(text,"hex");if(raw.length===32)return raw;if(text){const b=Buffer.from(text,"base64");if(b.length===32)return b}}catch{}return null}

  databaseInfo(){
    const count=t=>this.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    let size=0;try{size=fs.statSync(this.dbFile).size}catch{}
    return {file:this.dbFile,size,objects:count("object_store"),audits:count("audit_events"),telemetry:count("telemetry_state"),secrets:count("secret_store"),certificates:count("certificates"),encryptedSecrets:!!this.masterKey,journalMode:"WAL",schemaVersion:this.db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v||0,normalized:{displays:count("display_devices"),groups:count("device_groups"),integrations:count("integrations"),managedModules:count("managed_modules"),integrationDevices:count("integration_devices"),classes:count("class_schedules"),automations:count("automations"),automationActions:count("automation_actions"),automationTargets:count("automation_targets"),scenes:count("scenes"),sessions:count("sessions")}};
  }

  hasObject(namespace){return !!this.db.prepare("SELECT 1 ok FROM object_store WHERE namespace=?").get(namespace)}
  getObject(namespace,fallback){const row=this.db.prepare("SELECT value_json FROM object_store WHERE namespace=?").get(namespace);return row?parseJson(row.value_json,fallback):fallback}
  putObject(namespace,value,sourceFile=null){const now=iso(),json=JSON.stringify(value);this.db.prepare(`INSERT INTO object_store(namespace,value_json,source_file,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(namespace) DO UPDATE SET value_json=excluded.value_json,source_file=COALESCE(excluded.source_file,object_store.source_file),updated_at=excluded.updated_at`).run(namespace,json,sourceFile,now,now);return value}
  deleteObject(namespace){this.db.prepare("DELETE FROM object_store WHERE namespace=?").run(namespace)}

  hasNormalized(namespace){
    switch(namespace){
      case "devices": return !!this.db.prepare("SELECT 1 ok FROM site_settings WHERE key='devices.meta'").get();
      case "hardware": return !!this.db.prepare("SELECT 1 ok FROM site_settings WHERE key='hardware.meta'").get();
      case "automations": return !!this.db.prepare("SELECT 1 ok FROM site_settings WHERE key='automations.meta'").get();
      case "class-schedules": return !!this.db.prepare("SELECT 1 ok FROM site_settings WHERE key='class-schedules.meta'").get();
      case "scheduler-calendar": return !!this.db.prepare("SELECT 1 ok FROM scheduler_calendar WHERE id=1").get();
      case "scenes": return !!this.db.prepare("SELECT 1 ok FROM site_settings WHERE key='scenes.meta'").get();
      case "sessions": return !!this.db.prepare("SELECT 1 ok FROM site_settings WHERE key='sessions.meta'").get();
      default:return false;
    }
  }

  setSetting(key,value){this.db.prepare(`INSERT INTO site_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).run(key,JSON.stringify(value),iso())}
  getSetting(key,fallback=null){const r=this.db.prepare("SELECT value_json FROM site_settings WHERE key=?").get(key);return r?parseJson(r.value_json,fallback):fallback}

  readNormalized(namespace,fallback){
    if(namespace==="devices"){
      const meta=this.getSetting("devices.meta",{}),devices={};for(const r of this.db.prepare("SELECT * FROM display_devices ORDER BY id").all())devices[r.id]={...parseJson(r.config_json,{}),name:r.name,enabled:!!r.enabled};
      const displayGroups={};for(const g of this.db.prepare("SELECT domain,name FROM device_groups WHERE domain='display' ORDER BY name").all())displayGroups[g.name]=this.db.prepare("SELECT member_id FROM device_group_members WHERE domain='display' AND group_name=? ORDER BY position,member_id").all(g.name).map(x=>x.member_id);
      return {room:meta.room||fallback?.room,devices,displayGroups,lightingGroups:meta.lightingGroups||[]};
    }
    if(namespace==="hardware"){
      const meta=this.getSetting("hardware.meta",{}),out={...meta};
      for(const r of this.db.prepare("SELECT * FROM integrations ORDER BY id").all()){
        const cfg=parseJson(r.config_json,{});if(r.id==="pluto")out.pluto=cfg;
        if(r.id==="govee"){
          const devices={};for(const d of this.db.prepare("SELECT * FROM integration_devices WHERE integration_id='govee' ORDER BY id").all())devices[d.id]={...parseJson(d.config_json,{}),name:d.name||undefined};
          const groups={};for(const g of this.db.prepare("SELECT name FROM device_groups WHERE domain='lighting' ORDER BY name").all())groups[g.name]=this.db.prepare("SELECT member_id FROM device_group_members WHERE domain='lighting' AND group_name=? ORDER BY position,member_id").all(g.name).map(x=>x.member_id);
          out.govee={...cfg,devices,groups};
        }
      }
      return out;
    }
    if(namespace==="class-schedules"){const meta=this.getSetting("class-schedules.meta",{version:1});return {...meta,classes:this.db.prepare("SELECT data_json FROM class_schedules ORDER BY start_time,name").all().map(r=>parseJson(r.data_json,{}))}}
    if(namespace==="scheduler-calendar"){const r=this.db.prepare("SELECT * FROM scheduler_calendar WHERE id=1").get();return r?{excludedDates:parseJson(r.excluded_dates_json,[]),updatedAt:r.updated_at}:fallback}
    if(namespace==="automations"){
      const meta=this.getSetting("automations.meta",{version:1}),events=[];
      for(const r of this.db.prepare("SELECT * FROM automations ORDER BY id").all()){
        const event=parseJson(r.data_json,{}),steps=[];
        const rows=this.db.prepare("SELECT * FROM automation_actions WHERE automation_id=? AND position>0 ORDER BY position").all(r.id);
        for(const a of rows){const targets=this.db.prepare("SELECT target_id FROM automation_targets WHERE action_id=? ORDER BY position,target_id").all(a.id).map(x=>x.target_id);steps.push({id:a.id,action:a.action,targets,useEventTargets:!!a.use_event_targets,payload:parseJson(a.payload_json,{}),delaySeconds:a.delay_seconds,continueOnError:!!a.continue_on_error})}
        event.actions=steps;events.push(event);
      }
      return {...meta,events};
    }
    if(namespace==="scenes"){const out={};for(const r of this.db.prepare("SELECT * FROM scenes ORDER BY id").all())out[r.id]=parseJson(r.data_json,{});return out}
    if(namespace==="sessions"){const out={};for(const r of this.db.prepare("SELECT * FROM sessions ORDER BY id").all())out[r.id]=parseJson(r.data_json,{});return out}
    return fallback;
  }

  writeNormalized(namespace,value){
    const now=iso();
    if(namespace==="devices")return this.tx(()=>{
      this.db.exec("DELETE FROM device_group_members WHERE domain='display';DELETE FROM device_groups WHERE domain='display';DELETE FROM display_devices;");
      for(const [id,d] of Object.entries(value?.devices||{})){const cfg={...d};delete cfg.name;delete cfg.enabled;this.db.prepare("INSERT INTO display_devices(id,name,enabled,config_json,updated_at) VALUES(?,?,?,?,?)").run(id,String(d.name||id),bool(d.enabled!==false),JSON.stringify(cfg),now)}
      for(const [name,members] of Object.entries(value?.displayGroups||{})){this.db.prepare("INSERT INTO device_groups(domain,name,config_json,updated_at) VALUES('display',?,?,?)").run(name,"{}",now);(members||[]).forEach((m,i)=>this.db.prepare("INSERT INTO device_group_members(domain,group_name,member_id,position) VALUES('display',?,?,?)").run(name,String(m),i))}
      this.setSetting("devices.meta",{room:value?.room||"",lightingGroups:Array.isArray(value?.lightingGroups)?value.lightingGroups:[]});return value;
    });
    if(namespace==="hardware")return this.tx(()=>{
      const raw=value||{},g=raw.govee||{};this.db.prepare("DELETE FROM integration_devices WHERE integration_id='govee'").run();this.db.prepare("DELETE FROM device_group_members WHERE domain='lighting'").run();this.db.prepare("DELETE FROM device_groups WHERE domain='lighting'").run();
      const up=this.db.prepare(`INSERT INTO integrations(id,enabled,config_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,config_json=excluded.config_json,updated_at=excluded.updated_at`);
      if(raw.pluto)up.run("pluto",1,JSON.stringify(raw.pluto),now);
      const gcfg={...g};delete gcfg.devices;delete gcfg.groups;up.run("govee",1,JSON.stringify(gcfg),now);
      for(const [id,d] of Object.entries(g.devices||{})){const cfg={...d};delete cfg.name;this.db.prepare("INSERT INTO integration_devices(integration_id,id,name,config_json,updated_at) VALUES('govee',?,?,?,?)").run(id,d.name||id,JSON.stringify(cfg),now)}
      for(const [name,members] of Object.entries(g.groups||{})){this.db.prepare("INSERT INTO device_groups(domain,name,config_json,updated_at) VALUES('lighting',?,?,?)").run(name,"{}",now);(members||[]).forEach((m,i)=>this.db.prepare("INSERT INTO device_group_members(domain,group_name,member_id,position) VALUES('lighting',?,?,?)").run(name,String(m),i))}
      const meta={...raw};delete meta.pluto;delete meta.govee;this.setSetting("hardware.meta",meta);return value;
    });
    if(namespace==="class-schedules")return this.tx(()=>{this.db.exec("DELETE FROM class_schedules");for(const c of value?.classes||[])this.db.prepare("INSERT INTO class_schedules(id,name,start_time,end_time,enabled,data_json,updated_at) VALUES(?,?,?,?,?,?,?)").run(String(c.id),String(c.name||c.id),c.startTime||null,c.endTime||null,bool(c.enabled!==false),JSON.stringify(c),now);const meta={...value};delete meta.classes;this.setSetting("class-schedules.meta",meta);return value});
    if(namespace==="scheduler-calendar"){this.db.prepare(`INSERT INTO scheduler_calendar(id,skip_federal_holidays,excluded_dates_json,updated_at) VALUES(1,0,?,?) ON CONFLICT(id) DO UPDATE SET skip_federal_holidays=0,excluded_dates_json=excluded.excluded_dates_json,updated_at=excluded.updated_at`).run(JSON.stringify(value?.excludedDates||[]),String(value?.updatedAt||now));return value}
    if(namespace==="automations")return this.tx(()=>{
      this.db.exec("DELETE FROM automation_targets;DELETE FROM automation_actions;DELETE FROM automations;");
      for(const e of value?.events||[]){const id=String(e.id),base={...e};delete base.actions;this.db.prepare("INSERT INTO automations(id,name,enabled,action,schedule_mode,data_json,updated_at) VALUES(?,?,?,?,?,?,?)").run(id,String(e.name||id),bool(e.enabled!==false),e.action||null,e.scheduleMode||null,JSON.stringify(base),now);
        const primaryId=`${id}:primary`,primaryTargets=Array.isArray(e.targets)?e.targets:[];this.db.prepare("INSERT INTO automation_actions(id,automation_id,position,action,target_domain,use_event_targets,delay_seconds,continue_on_error,payload_json) VALUES(?,?,?,?,?,?,?,?,?)").run(primaryId,id,0,String(e.action||""),targetDomain(e.action),1,0,1,JSON.stringify(e.payload||{}));primaryTargets.forEach((t,i)=>this.db.prepare("INSERT INTO automation_targets(action_id,target_id,position) VALUES(?,?,?)").run(primaryId,String(t),i));
        (e.actions||[]).forEach((a,idx)=>{const aid=String(a.id||`${id}:step-${idx+1}`);this.db.prepare("INSERT INTO automation_actions(id,automation_id,position,action,target_domain,use_event_targets,delay_seconds,continue_on_error,payload_json) VALUES(?,?,?,?,?,?,?,?,?)").run(aid,id,idx+1,String(a.action||""),targetDomain(a.action),bool(a.useEventTargets!==false),Number(a.delaySeconds||0),bool(a.continueOnError!==false),JSON.stringify(a.payload||{}));(a.targets||[]).forEach((t,i)=>this.db.prepare("INSERT INTO automation_targets(action_id,target_id,position) VALUES(?,?,?)").run(aid,String(t),i))})}
      const meta={...value};delete meta.events;this.setSetting("automations.meta",meta);return value;
    });
    if(namespace==="scenes")return this.tx(()=>{this.db.exec("DELETE FROM scenes");for(const [id,s] of Object.entries(value||{}))this.db.prepare("INSERT INTO scenes(id,name,data_json,updated_at) VALUES(?,?,?,?)").run(id,String(s?.name||id),JSON.stringify(s),now);this.setSetting("scenes.meta",{normalized:true});return value});
    if(namespace==="sessions")return this.tx(()=>{this.db.exec("DELETE FROM sessions");for(const [id,s] of Object.entries(value||{}))this.db.prepare("INSERT INTO sessions(id,data_json,updated_at) VALUES(?,?,?)").run(id,JSON.stringify(s),now);this.setSetting("sessions.meta",{normalized:true});return value});
    return this.putObject(namespace,value);
  }

  migrateNormalizedObjects(){
    for(const ns of NORMALIZED_NAMESPACES){if(this.hasNormalized(ns))continue;const row=this.db.prepare("SELECT value_json,source_file FROM object_store WHERE namespace=?").get(ns);if(!row)continue;const value=parseJson(row.value_json,null);if(value===null)continue;try{this.writeNormalized(ns,value);this.recordMigration(`sqlite:object_store/${ns}`,`sqlite:normalized/${ns}`,Array.isArray(value)?value.length:1,{schemaVersion:2});this.deleteObject(ns)}catch(err){console.warn(`Normalized migration failed for ${ns}: ${err.message}`)}}
  }

  readJson(file,fallback,{namespace=keyForFile(file),migrate=true}={}){
    if(NORMALIZED_NAMESPACES.has(namespace)&&this.hasNormalized(namespace))return this.readNormalized(namespace,fallback);
    if(this.hasObject(namespace))return this.getObject(namespace,fallback);
    if(migrate&&fs.existsSync(file)){try{const value=JSON.parse(fs.readFileSync(file,"utf8"));if(NORMALIZED_NAMESPACES.has(namespace))this.writeNormalized(namespace,value);else this.putObject(namespace,value,file);this.recordMigration(file,NORMALIZED_NAMESPACES.has(namespace)?`sqlite:normalized/${namespace}`:`sqlite:object_store/${namespace}`,1,{type:"json"});return value}catch(err){console.warn(`Legacy JSON import failed for ${file}: ${err.message}`)}}
    return fallback;
  }
  writeJson(file,value,{namespace=keyForFile(file)}={}){if(NORMALIZED_NAMESPACES.has(namespace))this.writeNormalized(namespace,value);else this.putObject(namespace,value,file);if(this.legacyMirror){ensureParent(file);fs.writeFileSync(file,JSON.stringify(value,null,2))}}

  appendAudit(entry){this.db.prepare("INSERT INTO audit_events(at,kind,payload_json) VALUES(?,?,?)").run(String(entry.at||iso()),String(entry.kind||""),JSON.stringify(entry))}
  recentAudit(limit=250,{kind=null}={}){limit=Math.max(1,Math.min(5000,Number(limit)||250));const rows=kind?this.db.prepare("SELECT payload_json FROM audit_events WHERE kind=? ORDER BY id DESC LIMIT ?").all(kind,limit):this.db.prepare("SELECT payload_json FROM audit_events ORDER BY id DESC LIMIT ?").all(limit);return rows.map(r=>parseJson(r.payload_json,{raw:r.payload_json})).reverse()}
  importAuditJsonl(file,{archive=true}={}){if(this.migrationDone(file,"sqlite:audit_events")||!fs.existsSync(file))return {imported:0,skipped:true};const lines=fs.readFileSync(file,"utf8").split(/\r?\n/).filter(Boolean),stmt=this.db.prepare("INSERT INTO audit_events(at,kind,payload_json) VALUES(?,?,?)");this.db.exec("BEGIN");let imported=0;try{for(const line of lines){try{const e=JSON.parse(line);stmt.run(String(e.at||iso()),String(e.kind||""),JSON.stringify(e));imported++}catch{}}this.db.exec("COMMIT")}catch(err){this.db.exec("ROLLBACK");throw err}this.recordMigration(file,"sqlite:audit_events",imported,{type:"jsonl"});if(archive&&imported){const dir=path.join(this.dataDir,"legacy");fs.mkdirSync(dir,{recursive:true});fs.renameSync(file,path.join(dir,`audit-imported-${Date.now()}.jsonl`))}return {imported,skipped:false}}
  migrationDone(source,target){return !!this.db.prepare("SELECT 1 ok FROM migration_history WHERE source=? AND target=? LIMIT 1").get(String(source),String(target))}
  recordMigration(source,target,records=0,details={}){this.db.prepare("INSERT INTO migration_history(source,target,records,details_json,migrated_at) VALUES(?,?,?,?,?)").run(String(source),String(target),Number(records)||0,JSON.stringify(details||{}),iso())}

  getManagedIntegrations(){
    const modules={};for(const r of this.db.prepare("SELECT id,config_json FROM managed_modules ORDER BY id").all())modules[r.id]=parseJson(r.config_json,{});
    return {version:1,modules};
  }
  putManagedIntegrations(value){
    const modules=value?.modules||{},now=iso();return this.tx(()=>{this.db.exec("DELETE FROM managed_modules");const q=this.db.prepare("INSERT INTO managed_modules(id,config_json,updated_at) VALUES(?,?,?)");for(const [id,cfg] of Object.entries(modules))q.run(id,JSON.stringify(cfg||{}),now);return value});
  }

  requireMasterKey(){if(!this.masterKey)throw Error(`Encrypted secret storage unavailable; master key not readable at ${this.masterKeyFile}`);return this.masterKey}
  putSecret(name,value,metadata={}){const key=this.requireMasterKey(),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv),ciphertext=Buffer.concat([cipher.update(Buffer.isBuffer(value)?value:Buffer.from(String(value),"utf8")),cipher.final()]),tag=cipher.getAuthTag(),now=iso();this.db.prepare(`INSERT INTO secret_store(name,cipher_text,iv,auth_tag,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET cipher_text=excluded.cipher_text,iv=excluded.iv,auth_tag=excluded.auth_tag,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`).run(String(name),ciphertext.toString("base64"),iv.toString("base64"),tag.toString("base64"),JSON.stringify(metadata||{}),now,now)}
  getSecret(name,{asBuffer=false}={}){const row=this.db.prepare("SELECT * FROM secret_store WHERE name=?").get(String(name));if(!row)return null;const decipher=crypto.createDecipheriv("aes-256-gcm",this.requireMasterKey(),Buffer.from(row.iv,"base64"));decipher.setAuthTag(Buffer.from(row.auth_tag,"base64"));const plain=Buffer.concat([decipher.update(Buffer.from(row.cipher_text,"base64")),decipher.final()]);return asBuffer?plain:plain.toString("utf8")}
  hasSecret(name){return !!this.db.prepare("SELECT 1 ok FROM secret_store WHERE name=?").get(String(name))}
  listSecrets(){return this.db.prepare("SELECT name,metadata_json,created_at,updated_at FROM secret_store ORDER BY name").all().map(r=>({name:r.name,metadata:parseJson(r.metadata_json,{}),createdAt:r.created_at,updatedAt:r.updated_at}))}
  deleteSecret(name){this.db.prepare("DELETE FROM secret_store WHERE name=?").run(String(name))}
  importSecretFile(name,file,metadata={}){if(this.hasSecret(name)||!fs.existsSync(file))return false;this.putSecret(name,fs.readFileSync(file),{...metadata,importedFrom:file});this.recordMigration(file,`sqlite:secret_store/${name}`,1,{type:"encrypted-secret"});return true}

  putCertificate(name,pem,metadata={}){const now=iso();this.db.prepare(`INSERT INTO certificates(name,certificate_pem,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET certificate_pem=excluded.certificate_pem,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`).run(String(name),String(pem),JSON.stringify(metadata||{}),now,now)}
  getCertificate(name){return this.db.prepare("SELECT certificate_pem FROM certificates WHERE name=?").get(String(name))?.certificate_pem||null}
  listCertificates(){return this.db.prepare("SELECT name,metadata_json,created_at,updated_at FROM certificates ORDER BY name").all().map(r=>({name:r.name,metadata:parseJson(r.metadata_json,{}),createdAt:r.created_at,updatedAt:r.updated_at}))}
}

module.exports={ClassroomHubStorage,keyForFile,NORMALIZED_NAMESPACES};
