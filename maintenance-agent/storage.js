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

  readJson(file,fallback,{namespace=keyForFile(file),migrate=true}={}){
    if(NORMALIZED_NAMESPACES.has(namespace)&&this.hasNormalized(namespace))return this.readNormalized(namespace,fallback);
    if(this.hasObject(namespace))return this.getObject(namespace,fallback);
    if(migrate&&fs.existsSync(file)){try{const value=JSON.parse(fs.readFileSync(file,"utf8"));if(NORMALIZED_NAMESPACES.has(namespace))this.writeNormalized(namespace,value);else this.putObject(namespace,value,file);this.recordMigration(file,NORMALIZED_NAMESPACES.has(namespace)?`sqlite:normalized/${namespace}`:`sqlite:object_store/${namespace}`,1,{type:"json"});return value}catch(err){console.warn(`Legacy JSON import failed for ${file}: ${err.message}`)}}
    return fallback;
  }
  writeJson(file,value,{namespace=keyForFile(file)}={}){if(NORMALIZED_NAMESPACES.has(namespace))this.writeNormalized(namespace,value);else this.putObject(namespace,value,file);if(this.legacyMirror){ensureParent(file);fs.writeFileSync(file,JSON.stringify(value,null,2))}}

  appendAudit(entry){this.db.prepare("INSERT INTO audit_events(at,kind,payload_json) VALUES(?,?,?)").run(String(entry.at||iso()),String(entry.kind||""),JSON.stringify(entry))}
  recentAudit(limit=250,{kind=null}={}){limit=Math.max(1,Math.min(5000,Number(limit)||250));const rows=kind?this.db.prepare("SELECT payload_json FROM audit_events WHERE kind=? ORDER BY id DESC LIMIT ?").all(kind,limit):this.db.prepare("SELECT payload_json FROM audit_events ORDER BY id DESC LIMIT ?").all(limit);return rows.map(r=>parseJson(r.payload_json,{raw:r.payload_json})).reverse()}
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
