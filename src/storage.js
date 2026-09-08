"use strict";

const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {DatabaseSync}=require("node:sqlite");

// Database, credential and recovery material must never inherit a permissive
// umask from an interactive shell or container runtime.
process.umask(0o077);

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
    try{fs.chmodSync(path.dirname(this.dbFile),0o700)}catch{}
    this.db=new DatabaseSync(this.dbFile);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      PRAGMA busy_timeout=5000;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS object_store(namespace TEXT PRIMARY KEY,value_json TEXT NOT NULL,source_file TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,kind TEXT,payload_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events(at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_kind ON audit_events(kind,at DESC);
      CREATE TABLE IF NOT EXISTS telemetry_state(
        key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_telemetry_state_kind ON telemetry_state(kind,last_seen DESC);
      CREATE TABLE IF NOT EXISTS secret_store(name TEXT PRIMARY KEY,cipher_text TEXT NOT NULL,iv TEXT NOT NULL,auth_tag TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS certificates(name TEXT PRIMARY KEY,certificate_pem TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migration_history(id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT NOT NULL,target TEXT NOT NULL,records INTEGER NOT NULL DEFAULT 0,details_json TEXT NOT NULL DEFAULT '{}',migrated_at TEXT NOT NULL);

      CREATE TABLE IF NOT EXISTS site_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS display_devices(id TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS display_credentials(
        id TEXT PRIMARY KEY,
        display_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        FOREIGN KEY(display_id) REFERENCES display_devices(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_display_credentials_display ON display_credentials(display_id,revoked_at,last_used_at);
      CREATE TABLE IF NOT EXISTS display_enrollment_codes(
        id TEXT PRIMARY KEY,
        display_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        FOREIGN KEY(display_id) REFERENCES display_devices(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_display_enrollment_display ON display_enrollment_codes(display_id,expires_at,consumed_at);
      CREATE TABLE IF NOT EXISTS lab_agent_credentials(
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lab_agent_credentials_agent ON lab_agent_credentials(agent_id,revoked_at,last_used_at);
      CREATE TABLE IF NOT EXISTS lab_agent_enrollment_codes(
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lab_agent_enrollment_agent ON lab_agent_enrollment_codes(agent_id,expires_at,consumed_at);
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
      CREATE TABLE IF NOT EXISTS access_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'viewer',enabled INTEGER NOT NULL DEFAULT 1,config_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS system_preferences(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users(
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_sessions(
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        remote_addr TEXT,
        user_agent TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at);
    `);
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(1,'initial sqlite storage',?)").run(iso());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(2,'normalized classroom configuration tables',?)").run(iso());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(3,'web-managed configuration and access profile tables',?)").run(iso());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(4,'controller ui defaults and access profiles',?)").run(iso());
    this.applyTelemetrySeparationMigration();
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(6,'local authentication users and setup state',?)").run(iso());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(7,'display enrollment and revocable credentials',?)").run(iso());
    if(!this.db.prepare("PRAGMA table_info(users)").all().some(column=>column.name==="profile_id"))this.db.exec("ALTER TABLE users ADD COLUMN profile_id TEXT");
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(8,'capability profiles assigned to users',?)").run(iso());
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(9,'lab agent enrollment and revocable credentials',?)").run(iso());
    this.ensureDefaultAccessProfiles();
    this.applyGranularCapabilityMigration();
    this.db.exec("UPDATE users SET profile_id=CASE role WHEN 'admin' THEN 'administrator' WHEN 'operator' THEN 'teacher' ELSE 'read-only' END WHERE profile_id IS NULL OR profile_id=''");
    this.masterKey=this.loadMasterKey();
    this.migrateNormalizedObjects();
    const integrity=this.db.prepare("PRAGMA quick_check(1)").get();
    if(String(integrity?.quick_check||"").toLowerCase()!=="ok")throw Error(`SQLite integrity check failed: ${integrity?.quick_check||"unknown error"}`);
    try{fs.chmodSync(this.dbFile,0o600)}catch{}
    this.validateSchemaMigrations();
  }

  validateSchemaMigrations(){
    const expected=[
      "initial sqlite storage","normalized classroom configuration tables","web-managed configuration and access profile tables",
      "controller ui defaults and access profiles","audit telemetry separation","local authentication users and setup state",
      "display enrollment and revocable credentials","capability profiles assigned to users","lab agent enrollment and revocable credentials",
      "granular authorization and configurable school schedule"
    ];
    const rows=this.db.prepare("SELECT version,name FROM schema_migrations ORDER BY version").all();
    for(let i=0;i<expected.length;i++){const row=rows[i];if(!row||row.version!==i+1||row.name!==expected[i])throw Error(`Invalid or incomplete schema migration history at version ${i+1}`)}
    const duplicateNames=this.db.prepare("SELECT name,COUNT(*) count FROM schema_migrations GROUP BY name HAVING COUNT(*)>1").all();
    if(duplicateNames.length)throw Error("Schema migration history contains duplicate migration names");
    return {ok:true,version:rows.at(-1)?.version||0,count:rows.length};
  }

  applyTelemetrySeparationMigration(){
    const exists=this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=5").get();
    if(exists)return;
    const now=iso();
    this.db.exec("BEGIN");
    try{
      // Preserve aggregate historical counts without retaining hundreds of
      // thousands of repetitive polling/discovery rows.
      const kinds=["govee.discovery","govee.discovery.reconcile","api.request","veyon.framebuffer.unavailable"];
      for(const kind of kinds){
        const r=this.db.prepare("SELECT COUNT(*) count,MIN(at) first_seen,MAX(at) last_seen FROM audit_events WHERE kind=?").get(kind);
        if(Number(r?.count||0)>0){
          this.db.prepare(`INSERT INTO telemetry_state(key,kind,payload_json,first_seen,last_seen,count)
            VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
            last_seen=excluded.last_seen,count=telemetry_state.count+excluded.count`).run(`legacy:${kind}`,kind,"{}",r.first_seen||now,r.last_seen||now,Number(r.count));
        }
      }
      const svc=this.db.prepare(`SELECT COUNT(*) count,MIN(at) first_seen,MAX(at) last_seen
        FROM audit_events WHERE kind='service.action'
        AND json_extract(payload_json,'$.operation')='GET'
        AND COALESCE(json_extract(payload_json,'$.ok'),1)=1`).get();
      if(Number(svc?.count||0)>0){
        this.db.prepare(`INSERT INTO telemetry_state(key,kind,payload_json,first_seen,last_seen,count)
          VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET
          last_seen=excluded.last_seen,count=telemetry_state.count+excluded.count`).run("legacy:service.action:get","service.action","{\"operation\":\"GET\",\"ok\":true}",svc.first_seen||now,svc.last_seen||now,Number(svc.count));
      }
      this.db.prepare(`DELETE FROM audit_events WHERE kind IN ('govee.discovery','govee.discovery.reconcile','api.request','veyon.framebuffer.unavailable')`).run();
      this.db.prepare(`DELETE FROM audit_events WHERE kind='service.action'
        AND json_extract(payload_json,'$.operation')='GET'
        AND COALESCE(json_extract(payload_json,'$.ok'),1)=1`).run();
      this.db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(5,'audit telemetry separation',?)").run(now);
      this.db.exec("COMMIT");
    }catch(err){this.db.exec("ROLLBACK");throw err}
  }

  ensureDefaultAccessProfiles(){
    const defaults=[
      {id:"administrator",name:"Administrator",role:"admin",config:{description:"Full Classroom Control Hub administration and system management.",capabilities:["*"]}},
      {id:"technician",name:"Technician",role:"operator",config:{description:"Classroom operations, student-computer diagnostics and integrations.",capabilities:["classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","lab.sensitive.read","diagnostics.read","diagnostics.run"]}},
      {id:"teacher",name:"Teacher",role:"operator",config:{description:"Daily classroom, display, lighting, AV and schedule operations.",capabilities:["classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","diagnostics.read"]}},
      {id:"read-only",name:"Read Only",role:"viewer",config:{description:"View classroom status without student browsing history or screenshots.",capabilities:["classroom.read"]}}
    ];
    const q=this.db.prepare("INSERT OR IGNORE INTO access_profiles(id,name,role,enabled,config_json,updated_at) VALUES(?,?,?,?,?,?)");
    for(const x of defaults)q.run(x.id,x.name,x.role,1,JSON.stringify(x.config),iso());
    if(this.getPreference("ui.controller",null)===null)this.setPreference("ui.controller",{navigation:"grouped",density:"comfortable",advancedCollapsed:true});
  }

  applyGranularCapabilityMigration(){
    if(this.db.prepare("SELECT 1 FROM schema_migrations WHERE version=10").get())return;
    const oldTechnician=JSON.stringify({description:"Classroom operations, student-computer diagnostics, integrations and maintenance.",capabilities:["classroom.read","classroom.control","lab.read","lab.control","lab.sensitive.read","diagnostics.read"]});
    const oldTeacher=JSON.stringify({description:"Daily classroom, display, lighting, AV and schedule operations.",capabilities:["classroom.read","classroom.control","lab.read","lab.control"]});
    const profiles=this.listAccessProfiles();
    const technician=profiles.find(x=>x.id==="technician"),teacher=profiles.find(x=>x.id==="teacher");
    if(technician&&JSON.stringify(technician.config)===oldTechnician)this.db.prepare("UPDATE access_profiles SET config_json=?,updated_at=? WHERE id='technician'").run(JSON.stringify({description:"Classroom operations, student-computer diagnostics and integrations.",capabilities:["classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","lab.sensitive.read","diagnostics.read","diagnostics.run"]}),iso());
    if(teacher&&JSON.stringify(teacher.config)===oldTeacher)this.db.prepare("UPDATE access_profiles SET config_json=?,updated_at=? WHERE id='teacher'").run(JSON.stringify({description:"Daily classroom, display, lighting, AV and schedule operations.",capabilities:["classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","diagnostics.read"]}),iso());
    this.db.prepare("INSERT INTO schema_migrations(version,name,applied_at) VALUES(10,'granular authorization and configurable school schedule',?)").run(iso());
  }

  tx(fn){this.db.exec("BEGIN IMMEDIATE");try{const out=fn();this.db.exec("COMMIT");return out}catch(err){this.db.exec("ROLLBACK");throw err}}
  loadMasterKey(){try{const raw=fs.readFileSync(this.masterKeyFile),text=raw.toString("utf8").trim();if(/^[0-9a-f]{64}$/i.test(text))return Buffer.from(text,"hex");if(raw.length===32)return raw;if(text){const b=Buffer.from(text,"base64");if(b.length===32)return b}}catch{}return null}

  databaseInfo(){
    const count=t=>this.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    const files=[this.dbFile,`${this.dbFile}-wal`,`${this.dbFile}-shm`],fileSizes={};let size=0;
    for(const file of files){try{const bytes=fs.statSync(file).size;fileSizes[path.basename(file)]=bytes;size+=bytes}catch{}}
    return {file:this.dbFile,size,fileSizes,objects:count("object_store"),audits:count("audit_events"),telemetry:count("telemetry_state"),secrets:count("secret_store"),certificates:count("certificates"),encryptedSecrets:!!this.masterKey,journalMode:"WAL",schemaVersion:this.db.prepare("SELECT MAX(version) v FROM schema_migrations").get().v||0,normalized:{displays:count("display_devices"),displayCredentials:count("display_credentials"),labAgentCredentials:count("lab_agent_credentials"),groups:count("device_groups"),integrations:count("integrations"),managedModules:count("managed_modules"),integrationDevices:count("integration_devices"),classes:count("class_schedules"),automations:count("automations"),automationActions:count("automation_actions"),automationTargets:count("automation_targets"),scenes:count("scenes"),sessions:count("sessions"),accessProfiles:count("access_profiles"),preferences:count("system_preferences"),users:count("users"),userSessions:count("user_sessions")}};
  }

  healthCheck(){
    try{
      const quick=this.db.prepare("PRAGMA quick_check(1)").get()?.quick_check||"unknown";
      const foreignKeyErrors=this.db.prepare("PRAGMA foreign_key_check").all().length;
      fs.accessSync(this.dbFile,fs.constants.R_OK|fs.constants.W_OK);
      fs.accessSync(path.dirname(this.dbFile),fs.constants.W_OK);
      // Acquiring and releasing an immediate transaction verifies that SQLite
      // can obtain a writer lock without changing application data.
      this.db.exec("BEGIN IMMEDIATE; ROLLBACK");
      return {ok:String(quick).toLowerCase()==="ok"&&foreignKeyErrors===0,quickCheck:quick,foreignKeyErrors,writable:true};
    }catch(error){return {ok:false,quickCheck:null,foreignKeyErrors:null,writable:false,error:error.message}}
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
    if(namespace==="scheduler-calendar"){const r=this.db.prepare("SELECT * FROM scheduler_calendar WHERE id=1").get();if(!r)return fallback;const raw=parseJson(r.excluded_dates_json,[]);return Array.isArray(raw)?{excludedDates:raw,noSchoolDates:raw,halfDayDates:[],oneHourDelayDates:[],twoHourDelayDates:[],remoteDates:[],updatedAt:r.updated_at}:{...raw,updatedAt:r.updated_at}}
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
      this.db.exec("DELETE FROM device_group_members WHERE domain='display';DELETE FROM device_groups WHERE domain='display';");
      const incoming=Object.entries(value?.devices||{}),ids=incoming.map(([id])=>String(id));
      for(const [id,d] of incoming){const cfg={...d};delete cfg.name;delete cfg.enabled;this.db.prepare(`INSERT INTO display_devices(id,name,enabled,config_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,config_json=excluded.config_json,updated_at=excluded.updated_at`).run(id,String(d.name||id),bool(d.enabled!==false),JSON.stringify(cfg),now)}
      if(ids.length)this.db.prepare(`DELETE FROM display_devices WHERE id NOT IN (${ids.map(()=>"?").join(",")})`).run(...ids);else this.db.exec("DELETE FROM display_devices");
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
    if(namespace==="scheduler-calendar"){const payload={noSchoolDates:value?.noSchoolDates||value?.excludedDates||[],excludedDates:value?.noSchoolDates||value?.excludedDates||[],halfDayDates:value?.halfDayDates||[],oneHourDelayDates:value?.oneHourDelayDates||[],twoHourDelayDates:value?.twoHourDelayDates||[],remoteDates:value?.remoteDates||[],anchorDate:value?.anchorDate||'2026-08-19',anchorCycleDay:'A',anchorDayColor:'Green'};this.db.prepare(`INSERT INTO scheduler_calendar(id,skip_federal_holidays,excluded_dates_json,updated_at) VALUES(1,0,?,?) ON CONFLICT(id) DO UPDATE SET skip_federal_holidays=0,excluded_dates_json=excluded.excluded_dates_json,updated_at=excluded.updated_at`).run(JSON.stringify(payload),String(value?.updatedAt||now));return value}
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
  recordTelemetry(entry,key){
    const at=String(entry.at||iso()),kind=String(entry.kind||"telemetry"),k=String(key||kind);
    this.db.prepare(`INSERT INTO telemetry_state(key,kind,payload_json,first_seen,last_seen,count) VALUES(?,?,?,?,?,1)
      ON CONFLICT(key) DO UPDATE SET kind=excluded.kind,payload_json=excluded.payload_json,last_seen=excluded.last_seen,count=telemetry_state.count+1`).run(k,kind,JSON.stringify(entry),at,at);
  }
  telemetryState(limit=500){limit=Math.max(1,Math.min(5000,Number(limit)||500));return this.db.prepare("SELECT key,kind,payload_json,first_seen,last_seen,count FROM telemetry_state ORDER BY last_seen DESC LIMIT ?").all(limit).map(r=>({...r,payload:parseJson(r.payload_json,{})}))}
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

  getAdminConfig(){
    const devices=this.readNormalized("devices",{}),hardware=this.readNormalized("hardware",{}),calendar=this.readNormalized("scheduler-calendar",{});
    const site=this.getSetting("site.profile",{school:"Your School",room:devices.room||"Classroom",timezone:"America/New_York",productName:"Classroom Control Hub",logoUrl:"",faviconUrl:"",displayPrefix:"TV",theme:{mode:"dark",primary:"#2aa866",accent:"#1b7a49",background:"#040705",surface:"#121923",text:"#eef4f8"},revision:0});
    const preferences={};for(const r of this.db.prepare("SELECT key,value_json FROM system_preferences ORDER BY key").all())preferences[r.key]=parseJson(r.value_json,null);
    return {site,devices,hardware,calendar,preferences,accessProfiles:this.listAccessProfiles()};
  }
  putSiteProfile(value){const current=this.getSetting("site.profile",{}),next={...(value||{}),revision:Math.max(0,Number(current.revision)||0)+1,updatedAt:iso()};this.setSetting("site.profile",next);return next}
  listAccessProfiles(){return this.db.prepare("SELECT id,name,role,enabled,config_json,updated_at FROM access_profiles ORDER BY name,id").all().map(r=>({id:r.id,name:r.name,role:r.role,enabled:!!r.enabled,config:parseJson(r.config_json,{}),updatedAt:r.updated_at}))}
  effectiveAdministrators(){return this.db.prepare(`SELECT u.id,u.username,u.profile_id profileId FROM users u JOIN access_profiles p ON p.id=u.profile_id WHERE u.enabled=1 AND u.role='admin' AND p.enabled=1 AND p.role='admin'`).all().filter(row=>{const profile=this.db.prepare("SELECT config_json FROM access_profiles WHERE id=?").get(row.profileId);return parseJson(profile?.config_json,{}).capabilities?.includes("*")})}
  assertEffectiveAdministrator(){if((this.setupCompleted()||this.userCount()>0)&&!this.effectiveAdministrators().length)throw Error("At least one enabled effective administrator is required")}
  putAccessProfile(value){const id=String(value?.id||"").trim();if(!id)throw Error("Profile ID is required");const role=String(value?.role||"viewer");if(!["viewer","operator","admin"].includes(role))throw Error("Invalid role");const config=value?.config&&typeof value.config==="object"?value.config:{};if(config.capabilities!==undefined&&(!Array.isArray(config.capabilities)||config.capabilities.some(x=>typeof x!=="string"||x.length>100)))throw Error("Capabilities must be a list of permission names");return this.tx(()=>{this.db.prepare(`INSERT INTO access_profiles(id,name,role,enabled,config_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,enabled=excluded.enabled,config_json=excluded.config_json,updated_at=excluded.updated_at`).run(id,String(value?.name||id),role,bool(value?.enabled!==false),JSON.stringify(config),iso());this.assertEffectiveAdministrator();return this.listAccessProfiles().find(x=>x.id===id)})}
  deleteAccessProfile(id){id=String(id);if(this.db.prepare("SELECT 1 FROM users WHERE profile_id=? LIMIT 1").get(id))throw Error("Access profile is assigned to one or more users");this.db.prepare("DELETE FROM access_profiles WHERE id=?").run(id)}
  setPreference(key,value){this.db.prepare(`INSERT INTO system_preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).run(String(key),JSON.stringify(value),iso())}
  getPreference(key,fallback=null){const r=this.db.prepare("SELECT value_json FROM system_preferences WHERE key=?").get(String(key));return r?parseJson(r.value_json,fallback):fallback}

  displayCredentialPolicy(){const p=this.getPreference("display.credentials.policy",{})||{};return {legacySharedTokenAllowed:p.legacySharedTokenAllowed!==false,enrollmentTtlMinutes:Math.max(5,Math.min(60,Number(p.enrollmentTtlMinutes)||15))}}
  setDisplayCredentialPolicy(value={}){const current=this.displayCredentialPolicy(),next={legacySharedTokenAllowed:value.legacySharedTokenAllowed??current.legacySharedTokenAllowed,enrollmentTtlMinutes:Math.max(5,Math.min(60,Number(value.enrollmentTtlMinutes)||current.enrollmentTtlMinutes))};this.setPreference("display.credentials.policy",next);return next}
  tokenHash(token){return crypto.createHash("sha256").update(String(token||"")).digest("hex")}
  createDisplayEnrollment(displayId,{ttlMinutes=null}={}){
    displayId=String(displayId||"");const display=this.db.prepare("SELECT id,name,enabled FROM display_devices WHERE id=?").get(displayId);if(!display)throw Error("Display not found");if(!display.enabled)throw Error("Enable the display before enrollment");
    const now=new Date(),ttl=Math.max(5,Math.min(60,Number(ttlMinutes)||this.displayCredentialPolicy().enrollmentTtlMinutes)),expires=new Date(now.getTime()+ttl*60000),token=crypto.randomBytes(32).toString("base64url"),id=crypto.randomUUID();
    this.tx(()=>{this.db.prepare("DELETE FROM display_enrollment_codes WHERE consumed_at IS NOT NULL OR expires_at<=?").run(now.toISOString());this.db.prepare("DELETE FROM display_enrollment_codes WHERE display_id=? AND consumed_at IS NULL").run(displayId);this.db.prepare("INSERT INTO display_enrollment_codes(id,display_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)").run(id,displayId,this.tokenHash(token),now.toISOString(),expires.toISOString())});
    return {id,displayId,displayName:display.name,token,createdAt:now.toISOString(),expiresAt:expires.toISOString()};
  }
  consumeDisplayEnrollment(displayId,token,{label="Classroom display"}={}){
    displayId=String(displayId||"");const hash=this.tokenHash(token),now=iso();
    return this.tx(()=>{const row=this.db.prepare("SELECT e.*,d.enabled FROM display_enrollment_codes e JOIN display_devices d ON d.id=e.display_id WHERE e.display_id=? AND e.token_hash=?").get(displayId,hash);if(!row||row.consumed_at||row.expires_at<=now||!row.enabled)return null;const credential=crypto.randomBytes(32).toString("base64url"),id=crypto.randomUUID();this.db.prepare("UPDATE display_enrollment_codes SET consumed_at=? WHERE id=? AND consumed_at IS NULL").run(now,row.id);this.db.prepare("INSERT INTO display_credentials(id,display_id,label,token_hash,created_at,last_used_at) VALUES(?,?,?,?,?,?)").run(id,displayId,String(label||"Classroom display").slice(0,120),this.tokenHash(credential),now,now);return {id,displayId,credential,createdAt:now}})
  }
  authenticateDisplay(displayId,token){const now=iso(),row=this.db.prepare(`SELECT c.id,c.display_id displayId,c.label,c.created_at createdAt,c.last_used_at lastUsedAt FROM display_credentials c JOIN display_devices d ON d.id=c.display_id WHERE c.display_id=? AND c.token_hash=? AND c.revoked_at IS NULL AND d.enabled=1`).get(String(displayId||""),this.tokenHash(token));if(!row)return null;this.db.prepare("UPDATE display_credentials SET last_used_at=? WHERE id=?").run(now,row.id);return {...row,lastUsedAt:now}}
  listDisplayCredentials(){const now=iso(),policy=this.displayCredentialPolicy(),rows=this.db.prepare("SELECT id,display_id displayId,label,created_at createdAt,last_used_at lastUsedAt,revoked_at revokedAt FROM display_credentials ORDER BY display_id,created_at DESC").all(),pending=this.db.prepare("SELECT id,display_id displayId,created_at createdAt,expires_at expiresAt FROM display_enrollment_codes WHERE consumed_at IS NULL AND expires_at>? ORDER BY display_id,created_at DESC").all(now);return {policy,credentials:rows,pending}}
  revokeDisplayCredential(id){const at=iso();return this.db.prepare("UPDATE display_credentials SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(at,String(id)).changes>0}
  revokeDisplayCredentials(displayId){const at=iso();return this.db.prepare("UPDATE display_credentials SET revoked_at=? WHERE display_id=? AND revoked_at IS NULL").run(at,String(displayId)).changes}
  cancelDisplayEnrollments(displayId){return this.db.prepare("DELETE FROM display_enrollment_codes WHERE display_id=? AND consumed_at IS NULL").run(String(displayId)).changes}

  labAgentCredentialPolicy(){const p=this.getPreference("lab-agent.credentials.policy",{})||{};return {legacySharedTokenAllowed:p.legacySharedTokenAllowed!==false,enrollmentTtlMinutes:Math.max(5,Math.min(60,Number(p.enrollmentTtlMinutes)||15))}}
  setLabAgentCredentialPolicy(value={}){const current=this.labAgentCredentialPolicy(),next={legacySharedTokenAllowed:value.legacySharedTokenAllowed??current.legacySharedTokenAllowed,enrollmentTtlMinutes:Math.max(5,Math.min(60,Number(value.enrollmentTtlMinutes)||current.enrollmentTtlMinutes))};this.setPreference("lab-agent.credentials.policy",next);return next}
  createLabAgentEnrollment(agentId,{ttlMinutes=null}={}){agentId=String(agentId||"").trim().toLowerCase();if(!/^[a-z0-9._-]{1,120}$/.test(agentId))throw Error("Valid lab agent ID required");const now=new Date(),ttl=Math.max(5,Math.min(60,Number(ttlMinutes)||this.labAgentCredentialPolicy().enrollmentTtlMinutes)),expires=new Date(now.getTime()+ttl*60000),token=crypto.randomBytes(32).toString("base64url"),id=crypto.randomUUID();this.tx(()=>{this.db.prepare("DELETE FROM lab_agent_enrollment_codes WHERE consumed_at IS NOT NULL OR expires_at<=?").run(now.toISOString());this.db.prepare("DELETE FROM lab_agent_enrollment_codes WHERE agent_id=? AND consumed_at IS NULL").run(agentId);this.db.prepare("INSERT INTO lab_agent_enrollment_codes(id,agent_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)").run(id,agentId,this.tokenHash(token),now.toISOString(),expires.toISOString())});return {id,agentId,token,createdAt:now.toISOString(),expiresAt:expires.toISOString()}}
  consumeLabAgentEnrollment(agentId,token,{label="Windows classroom agent"}={}){agentId=String(agentId||"");const hash=this.tokenHash(token),now=iso();return this.tx(()=>{const row=this.db.prepare("SELECT * FROM lab_agent_enrollment_codes WHERE agent_id=? AND token_hash=?").get(agentId,hash);if(!row||row.consumed_at||row.expires_at<=now)return null;const credential=crypto.randomBytes(32).toString("base64url"),id=crypto.randomUUID();this.db.prepare("UPDATE lab_agent_enrollment_codes SET consumed_at=? WHERE id=? AND consumed_at IS NULL").run(now,row.id);this.db.prepare("INSERT INTO lab_agent_credentials(id,agent_id,label,token_hash,created_at,last_used_at) VALUES(?,?,?,?,?,?)").run(id,agentId,String(label||"Windows classroom agent").slice(0,120),this.tokenHash(credential),now,now);return {id,agentId,credential,createdAt:now}})}
  authenticateLabAgent(agentId,token){const now=iso(),row=this.db.prepare("SELECT id,agent_id agentId,label,created_at createdAt,last_used_at lastUsedAt FROM lab_agent_credentials WHERE agent_id=? AND token_hash=? AND revoked_at IS NULL").get(String(agentId||""),this.tokenHash(token));if(!row)return null;this.db.prepare("UPDATE lab_agent_credentials SET last_used_at=? WHERE id=?").run(now,row.id);return {...row,lastUsedAt:now}}
  listLabAgentCredentials(){const now=iso(),policy=this.labAgentCredentialPolicy(),credentials=this.db.prepare("SELECT id,agent_id agentId,label,created_at createdAt,last_used_at lastUsedAt,revoked_at revokedAt FROM lab_agent_credentials ORDER BY agent_id,created_at DESC").all(),pending=this.db.prepare("SELECT id,agent_id agentId,created_at createdAt,expires_at expiresAt FROM lab_agent_enrollment_codes WHERE consumed_at IS NULL AND expires_at>? ORDER BY agent_id,created_at DESC").all(now);return {policy,credentials,pending}}
  revokeLabAgentCredential(id){return this.db.prepare("UPDATE lab_agent_credentials SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(iso(),String(id)).changes>0}
  revokeLabAgentCredentials(agentId){return this.db.prepare("UPDATE lab_agent_credentials SET revoked_at=? WHERE agent_id=? AND revoked_at IS NULL").run(iso(),String(agentId)).changes}
  cancelLabAgentEnrollments(agentId){return this.db.prepare("DELETE FROM lab_agent_enrollment_codes WHERE agent_id=? AND consumed_at IS NULL").run(String(agentId)).changes}
  revokeLabAgentAccess(agentId){return this.tx(()=>({credentials:this.revokeLabAgentCredentials(agentId),enrollments:this.cancelLabAgentEnrollments(agentId)}))}

  authPolicy(){const p=this.getPreference("auth.policy",{});return {standardHours:Math.max(1,Math.min(168,Number(p.standardHours)||12)),rememberHours:Math.max(1,Math.min(720,Number(p.rememberHours)||168)),maxSessions:Math.max(1,Math.min(50,Number(p.maxSessions)||10))}}
  setAuthPolicy(value){const current=this.authPolicy(),next={...current,...(value||{})};next.standardHours=Math.max(1,Math.min(168,Number(next.standardHours)||12));next.rememberHours=Math.max(next.standardHours,Math.min(720,Number(next.rememberHours)||168));next.maxSessions=Math.max(1,Math.min(50,Number(next.maxSessions)||10));this.setPreference("auth.policy",next);return next}
  // Fresh appliances fail closed. The one-use setup endpoint creates the first
  // administrator and leaves authentication enabled.
  authEnabled(){return !!this.getPreference("auth.enabled",true)}
  setAuthEnabled(value){this.setPreference("auth.enabled",!!value);return !!value}
  setupCompleted(){return !!this.getPreference("setup.completed",false)}
  setSetupCompleted(value=true){this.setPreference("setup.completed",!!value);return !!value}
  listUsers(){return this.db.prepare("SELECT id,username,display_name displayName,role,profile_id profileId,enabled,created_at createdAt,updated_at updatedAt,last_login_at lastLoginAt FROM users ORDER BY username").all().map(r=>({...r,enabled:!!r.enabled}))}
  userCount(){return Number(this.db.prepare("SELECT COUNT(*) c FROM users").get().c||0)}
  hashPassword(password,salt){return crypto.scryptSync(String(password),Buffer.from(salt,"hex"),64,{N:16384,r:8,p:1}).toString("hex")}
  putUser(value,{password=null}={}){
    const id=String(value?.id||crypto.randomUUID()),username=String(value?.username||"").trim(),displayName=String(value?.displayName||username).trim();
    const role=String(value?.role||"viewer");if(!username||!/^[a-z0-9._@-]{2,80}$/i.test(username))throw Error("A valid username is required");if(!["viewer","operator","admin"].includes(role))throw Error("Invalid role");
    const existing=this.db.prepare("SELECT * FROM users WHERE id=? OR username=? COLLATE NOCASE").get(id,username),now=iso();
    const defaultProfile={admin:"administrator",operator:"teacher",viewer:"read-only"}[role],profileId=String(value?.profileId||existing?.profile_id||defaultProfile),profile=this.db.prepare("SELECT role FROM access_profiles WHERE id=? AND enabled=1").get(profileId);if(!profile)throw Error("Enabled access profile not found");if(profile.role!==role)throw Error("Access profile role must match the user role");
    let salt=existing?.password_salt||"",hash=existing?.password_hash||"";
    if(password!==null&&password!==undefined&&password!==""){if(String(password).length<10)throw Error("Password must be at least 10 characters");salt=crypto.randomBytes(16).toString("hex");hash=this.hashPassword(password,salt)}
    if(!hash)throw Error("Password is required for a new user");
    return this.tx(()=>{this.db.prepare(`INSERT INTO users(id,username,display_name,role,password_salt,password_hash,enabled,created_at,updated_at,last_login_at,profile_id) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,display_name=excluded.display_name,role=excluded.role,password_salt=excluded.password_salt,password_hash=excluded.password_hash,enabled=excluded.enabled,updated_at=excluded.updated_at,profile_id=excluded.profile_id`).run(id,username,displayName||username,role,salt,hash,bool(value?.enabled!==false),existing?.created_at||now,now,existing?.last_login_at||null,profileId);this.assertEffectiveAdministrator();return this.listUsers().find(x=>x.id===id)})
  }
  createFirstAdministrator(value,{password}={}){if(this.userCount())throw Error("Initial administrator setup has already completed");const id=String(value?.id||crypto.randomUUID()),username=String(value?.username||"").trim(),displayName=String(value?.displayName||username).trim();if(!/^[a-z0-9._@-]{2,80}$/i.test(username))throw Error("A valid username is required");if(String(password||"").length<10)throw Error("Password must be at least 10 characters");const salt=crypto.randomBytes(16).toString("hex"),hash=this.hashPassword(password,salt),now=iso();return this.tx(()=>{if(this.userCount())throw Error("Initial administrator setup has already completed");this.db.prepare(`INSERT INTO users(id,username,display_name,role,password_salt,password_hash,enabled,created_at,updated_at,profile_id) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,username,displayName||username,"admin",salt,hash,1,now,now,"administrator");this.setPreference("auth.enabled",true);this.setPreference("setup.completed",true);this.assertEffectiveAdministrator();return this.listUsers().find(x=>x.id===id)})}
  deleteUser(id){return this.tx(()=>{const changes=this.db.prepare("DELETE FROM users WHERE id=?").run(String(id)).changes;this.assertEffectiveAdministrator();return changes})}
  verifyUser(username,password){const r=this.db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND enabled=1").get(String(username||"").trim());if(!r)return null;const got=this.hashPassword(password,r.password_salt),a=Buffer.from(got,"hex"),b=Buffer.from(r.password_hash,"hex");if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;return {id:r.id,username:r.username,displayName:r.display_name,role:r.role,profileId:r.profile_id,enabled:!!r.enabled}}
  createSession(user,{remoteAddr="",userAgent="",ttlHours=null}={}){this.cleanupSessions();const policy=this.authPolicy(),hours=Math.max(1,Math.min(720,Number(ttlHours)||policy.standardHours)),token=crypto.randomBytes(32).toString("base64url"),hash=crypto.createHash("sha256").update(token).digest("hex"),id=crypto.randomUUID(),now=new Date(),exp=new Date(now.getTime()+hours*3600000);this.db.prepare("INSERT INTO user_sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at,remote_addr,user_agent) VALUES(?,?,?,?,?,?,?,?)").run(id,user.id,hash,now.toISOString(),exp.toISOString(),now.toISOString(),String(remoteAddr||""),String(userAgent||"").slice(0,500));this.db.prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?").run(now.toISOString(),now.toISOString(),user.id);const sessions=this.listUserSessions(user.id);for(const extra of sessions.slice(policy.maxSessions))this.deleteUserSession(user.id,extra.id);return {token,expiresAt:exp.toISOString()}}
  sessionUser(token){if(!token)return null;this.cleanupSessions();const hash=crypto.createHash("sha256").update(String(token)).digest("hex"),r=this.db.prepare(`SELECT s.id sessionId,s.expires_at expiresAt,u.id,u.username,u.display_name displayName,u.role,u.profile_id profileId,u.enabled FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.enabled=1 AND s.expires_at>?`).get(hash,iso());if(!r)return null;this.db.prepare("UPDATE user_sessions SET last_seen_at=? WHERE id=?").run(iso(),r.sessionId);return {...r,enabled:!!r.enabled}}
  deleteSession(token){if(!token)return;const hash=crypto.createHash("sha256").update(String(token)).digest("hex");this.db.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(hash)}
  listUserSessions(userId){this.cleanupSessions();return this.db.prepare("SELECT id,created_at createdAt,expires_at expiresAt,last_seen_at lastSeenAt,remote_addr remoteAddr,user_agent userAgent FROM user_sessions WHERE user_id=? ORDER BY last_seen_at DESC").all(String(userId))}
  deleteUserSession(userId,sessionId){return this.db.prepare("DELETE FROM user_sessions WHERE id=? AND user_id=?").run(String(sessionId),String(userId)).changes>0}
  deleteAllUserSessions(userId,{exceptSessionId=null}={}){if(exceptSessionId)return this.db.prepare("DELETE FROM user_sessions WHERE user_id=? AND id<>?").run(String(userId),String(exceptSessionId)).changes;return this.db.prepare("DELETE FROM user_sessions WHERE user_id=?").run(String(userId)).changes}
  listAllUserSessions(){this.cleanupSessions();return this.db.prepare(`SELECT s.id,s.user_id userId,u.username,u.display_name displayName,u.role,s.created_at createdAt,s.expires_at expiresAt,s.last_seen_at lastSeenAt,s.remote_addr remoteAddr,s.user_agent userAgent FROM user_sessions s JOIN users u ON u.id=s.user_id ORDER BY s.last_seen_at DESC`).all()}
  resetUserPassword(userId,newPassword){const user=this.listUsers().find(x=>x.id===String(userId));if(!user)throw Error("User not found");const updated=this.putUser(user,{password:newPassword});this.deleteAllUserSessions(user.id);return updated}
  verifyUserPassword(userId,password){const r=this.db.prepare("SELECT password_salt,password_hash FROM users WHERE id=? AND enabled=1").get(String(userId));if(!r)return false;const got=this.hashPassword(password,r.password_salt),a=Buffer.from(got,"hex"),b=Buffer.from(r.password_hash,"hex");return a.length===b.length&&crypto.timingSafeEqual(a,b)}
  changeUserPassword(userId,currentPassword,newPassword){if(!this.verifyUserPassword(userId,currentPassword))throw Error("Current password is incorrect");const user=this.listUsers().find(x=>x.id===String(userId));if(!user)throw Error("User not found");return this.putUser(user,{password:newPassword})}
  cleanupSessions(){this.db.prepare("DELETE FROM user_sessions WHERE expires_at<=?").run(iso())}
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
