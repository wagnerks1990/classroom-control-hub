"use strict";
const express=require("express");
const http=require("http");
const fs=require("fs");
const path=require("path");
const os=require("os");
const crypto=require("crypto");
const {execFile,spawn}=require("child_process");
const {promisify}=require("util");
const multer=require("multer");
const AdmZip=require("adm-zip");
const {ClassroomHubStorage}=require("./storage");
const execFileAsync=promisify(execFile);
const app=express();
const PORT=Number(process.env.PORT||3010);
const TOKEN=String(process.env.MAINTENANCE_TOKEN||"");
const ALLOW_SHELL=String(process.env.MAINTENANCE_ALLOW_SHELL||"false").toLowerCase()==="true";
const HUB_ROOT=path.resolve(process.env.MANAGED_HUB_ROOT||"/managed/classroom-hub");
const Classroom_ROOT=path.resolve(process.env.MANAGED_Classroom_ROOT||"/managed/services");
const HOST_HUB_PATH=String(process.env.HOST_HUB_PATH||"/opt/classroom-control-hub");
const HOST_AGENT_SOCKET=String(process.env.HOST_AGENT_SOCKET||"/run/classroom-control-hub/host-agent.sock");
const BACKUP_DIR=path.join(HUB_ROOT,"data","backups");
const MASTER_KEY_FILE=String(process.env.MASTER_KEY_FILE||"/run/secrets/classroom-control-hub-master-key");
const dbStore=new ClassroomHubStorage({dataDir:path.join(HUB_ROOT,"data"),dbFile:path.join(HUB_ROOT,"data","classroom-control-hub.db"),masterKeyFile:MASTER_KEY_FILE});
const UPLOAD_DIR="/work/uploads";
fs.mkdirSync(BACKUP_DIR,{recursive:true});fs.mkdirSync(UPLOAD_DIR,{recursive:true});
app.use(express.json({limit:"8mb"}));
function auth(req,res,next){if(!TOKEN)return res.status(503).json({ok:false,error:"Maintenance token not configured"});if(req.get("x-maintenance-token")!==TOKEN)return res.status(401).json({ok:false,error:"Unauthorized"});next()}
app.use(auth);
function cleanName(v){return String(v||"").replace(/[^A-Za-z0-9._-]/g,"-").slice(0,180)}
function safeRoot(root){return root==="hub"?HUB_ROOT:root==="services"?Classroom_ROOT:null}
function safePath(root,rel=""){const base=safeRoot(root);if(!base)throw Error("Unknown managed root");const resolved=path.resolve(base,"."+path.sep+String(rel||""));if(resolved!==base&&!resolved.startsWith(base+path.sep))throw Error("Path escapes managed root");return resolved}
function statInfo(p,base){const st=fs.statSync(p);return {name:path.basename(p),path:path.relative(base,p)||".",type:st.isDirectory()?"directory":"file",size:st.size,modifiedAt:st.mtime.toISOString()}}
async function run(cmd,args=[],opts={}){const {stdout,stderr}=await execFileAsync(cmd,args,{timeout:opts.timeout||15000,maxBuffer:opts.maxBuffer||8*1024*1024,cwd:opts.cwd||undefined,env:{...process.env,...(opts.env||{})}});return {stdout,stderr}}
async function dockerContainers(){const r=await run("docker",["ps","-a","--format","{{json .}}"],{timeout:10000});return r.stdout.split(/\r?\n/).filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return {raw:x}}})}
app.get("/health",async(_req,res)=>{let docker=false,hostAgent=null;try{await run("docker",["info","--format","{{.ServerVersion}}"],{timeout:5000});docker=true}catch{}try{hostAgent=await hostAgentRequest("GET","/health")}catch(e){hostAgent={ok:false,error:e.message}}res.json({ok:true,version:"1.0.0-alpha.66",docker,hostAgent,roots:{hub:fs.existsSync(HUB_ROOT),services:fs.existsSync(Classroom_ROOT),services:fs.existsSync(Classroom_ROOT)},shellEnabled:ALLOW_SHELL,database:dbStore.databaseInfo()})});
app.get("/system",async(_req,res)=>{
  const nets=os.networkInterfaces();let disk=null,hostDocker=null;
  try{disk=(await run("df",["-h","/managed/classroom-hub"])).stdout}catch{}
  try{const r=await run("docker",["info","--format","{{json .}}"],{timeout:8000,maxBuffer:8*1024*1024});hostDocker=JSON.parse(r.stdout)}catch{}
  res.json({ok:true,
    host:{hostname:hostDocker?.Name||null,operatingSystem:hostDocker?.OperatingSystem||null,kernelVersion:hostDocker?.KernelVersion||os.release(),architecture:hostDocker?.Architecture||os.arch(),cpus:hostDocker?.NCPU||null,memoryBytes:hostDocker?.MemTotal||null,dockerVersion:hostDocker?.ServerVersion||null,containers:hostDocker?.Containers??null,containersRunning:hostDocker?.ContainersRunning??null},
    agent:{hostname:os.hostname(),platform:os.platform(),release:os.release(),arch:os.arch(),uptimeSeconds:os.uptime(),loadavg:os.loadavg(),memory:{total:os.totalmem(),free:os.freemem()},cpus:os.cpus().length,networks:nets},
    disk,shellEnabled:ALLOW_SHELL,roots:{hub:HUB_ROOT,services:Classroom_ROOT,services:Classroom_ROOT}})
});

const APPLIANCE_CONTAINER_POLICY={
  "classroom-hub":{owner:"core",recommendation:"keep",purpose:"Classroom Control Hub application"},
  "classroom-control-hub-maintenance":{owner:"core",recommendation:"keep",purpose:"Classroom Control Hub privileged maintenance agent"},
  "mosquitto":{owner:"integration",recommendation:"adopt",purpose:"MQTT broker used by Classroom Control Hub"},
  "govee2mqtt":{owner:"integration",recommendation:"adopt",purpose:"Govee lighting integration"},
  "music-assistant-server":{owner:"integration",recommendation:"integrate",purpose:"Classroom audio/media service"},
  "portainer":{owner:"legacy-admin",recommendation:"optional-remove",purpose:"Docker UI now duplicated by Classroom Control Hub"},
  "nodered":{owner:"optional",recommendation:"optional-remove",purpose:"Optional external automation engine"}
};
app.get("/appliance/inventory",async(_req,res)=>{
  try{
    const containers=await dockerContainers();
    const items=containers.map(c=>{const name=c.Names||c.Name||"";const policy=APPLIANCE_CONTAINER_POLICY[name]||{owner:"unmanaged",recommendation:"review",purpose:"Not currently owned by Classroom Control Hub"};return {name,image:c.Image||"",status:c.Status||c.State||"",...policy}});
    res.json({ok:true,mode:"dedicated-appliance",policy:"Classroom Control Hub owns application services and integrations; removal is always explicit",items,summary:{total:items.length,core:items.filter(x=>x.owner==="core").length,integrated:items.filter(x=>x.owner==="integration").length,review:items.filter(x=>["unmanaged","legacy-admin","optional"].includes(x.owner)).length}});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
});


// -----------------------------------------------------------------------------
// Dedicated appliance host-service management (alpha.22)
// Host systemd/journal/package operations are delegated to a native root-owned
// host agent over a local Unix socket. The maintenance container does not enter
// host namespaces and does not require privileged mode.
// -----------------------------------------------------------------------------
function hostAgentRequest(method,pathName,body=null,timeoutMs=30000){
  return new Promise((resolve,reject)=>{
    const raw=body==null?null:Buffer.from(JSON.stringify(body));
    const req=http.request({socketPath:HOST_AGENT_SOCKET,path:pathName,method,headers:{"x-maintenance-token":TOKEN,...(raw?{"content-type":"application/json","content-length":raw.length}:{})}},res=>{
      const chunks=[];res.on("data",c=>chunks.push(c));res.on("end",()=>{
        const text=Buffer.concat(chunks).toString("utf8");let obj;try{obj=JSON.parse(text||"{}") }catch{obj={ok:false,error:text||`Host agent HTTP ${res.statusCode}`}}
        if((res.statusCode||500)>=400){const e=Error(obj.error||`Host agent HTTP ${res.statusCode}`);e.status=res.statusCode;e.payload=obj;return reject(e)}resolve(obj)
      })
    });req.on("error",reject);req.setTimeout(timeoutMs,()=>req.destroy(Error("Host agent request timed out")));if(raw)req.write(raw);req.end()
  })
}
app.get("/host/agent/health",async(_req,res)=>{try{res.json(await hostAgentRequest("GET","/health"))}catch(e){res.status(502).json({ok:false,error:`Host agent unavailable: ${e.message}`,socket:HOST_AGENT_SOCKET})}});
app.get("/host/system",async(_req,res)=>{try{res.json(await hostAgentRequest("GET","/system"))}catch(e){res.status(502).json({ok:false,error:`Host agent unavailable: ${e.message}`})}});
app.get("/host/updates",async(_req,res)=>{try{res.json(await hostAgentRequest("GET","/updates"))}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}});
app.get("/host/updates/job",async(_req,res)=>{try{res.json(await hostAgentRequest("GET","/updates/job",null,30000))}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}});
app.post("/host/updates/apply",async(req,res)=>{try{
  if(String(req.body?.confirm||"")!=="INSTALL_UPDATES")return res.status(400).json({ok:false,error:"Explicit INSTALL_UPDATES confirmation required"});
  const safety=await createOperationalBackupNamed("pre-host-update");
  const result=await hostAgentRequest("POST","/updates/start",req.body||{},30000);
  res.status(202).json({ok:true,safetyBackup:safety.name,...result,message:"Native host update job started. Classroom Control Hub will continue monitoring it."});
}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}});
app.get("/host/migration-snapshots",async(_req,res)=>{try{res.json(await hostAgentRequest("GET","/cleanup/migration-snapshots"))}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}});
app.post("/host/migration-retention",async(req,res)=>{try{res.json(await hostAgentRequest("POST","/cleanup/migration-retention",req.body||{}))}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}});
app.get("/host/services",async(_req,res)=>{try{res.json(await hostAgentRequest("GET","/services"))}catch(e){res.status(e.status||502).json({ok:false,error:e.message})}});
app.post("/host/service/:name/:action",async(req,res)=>{
  const name=encodeURIComponent(String(req.params.name||"")),action=encodeURIComponent(String(req.params.action||""));
  try{res.json(await hostAgentRequest("POST",`/service/${name}/${action}`,req.body||{}))}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}
});
app.get("/host/service/:name/logs",async(req,res)=>{
  const name=encodeURIComponent(String(req.params.name||"")),tail=encodeURIComponent(String(req.query.tail||300));
  try{const j=await hostAgentRequest("GET",`/service/${name}/logs?tail=${tail}`);if(String(req.query.download||"")==="1"){res.setHeader("Content-Disposition",`attachment; filename="${cleanName(req.params.name)}-${Date.now()}.log"`);res.type("text/plain").send(j.text||"")}else res.json(j)}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}
});
app.get("/host/cleanup/plan",async(_req,res)=>{
  try{
    let legacyBackups=[];try{legacyBackups=(await hostAgentRequest("GET","/cleanup/legacy-backups")).items||[]}catch{}
    let danglingImages=[];try{const r=await run("docker",["images","--filter","dangling=true","--format","{{.ID}} {{.Repository}}:{{.Tag}} {{.Size}}"],{timeout:10000});danglingImages=r.stdout.split(/\r?\n/).filter(Boolean)}catch{}
    const containers=await dockerContainers();
    let composeServices=[];try{const r=await run("docker",["compose","config","--services"],{cwd:HUB_ROOT,timeout:10000});composeServices=r.stdout.split(/\r?\n/).filter(Boolean)}catch{}
    const optional=containers.filter(c=>["portainer","nodered"].includes(c.Names||c.Name||"")).map(c=>{const name=c.Names||c.Name;return {name,image:c.Image,status:c.Status,recommendation:"review-remove",managedByCurrentCompose:composeServices.includes(name),dependencyCheck:composeServices.includes(name)?"blocked-current-compose":"eligible-review"}});
    res.json({ok:true,generatedAt:new Date().toISOString(),legacyBackups,danglingImages,optionalContainers:optional,note:"Cleanup candidates are reviewable. Archive/remove actions require explicit confirmation and create a managed recovery backup first."});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
});
app.post("/host/cleanup/legacy-backup",async(req,res)=>{
  try{
    const action=String(req.body?.action||""),confirm=String(req.body?.confirm||"");
    if(!["archive","delete"].includes(action))return res.status(400).json({ok:false,error:"Unsupported cleanup action"});
    if(confirm!==(action==="archive"?"ARCHIVE":"DELETE"))return res.status(400).json({ok:false,error:"Explicit cleanup confirmation required"});
    const safety=await createOperationalBackupNamed("pre-appliance-cleanup");
    const result=await hostAgentRequest("POST","/cleanup/legacy-backup",{path:req.body?.path,action,confirm});
    res.json({ok:true,safetyBackup:safety.name,result});
  }catch(e){res.status(e.status||500).json(e.payload||{ok:false,error:e.message})}
});
app.post("/host/cleanup/legacy-batch",async(req,res)=>{
  try{
    const action=String(req.body?.action||""),paths=Array.isArray(req.body?.paths)?req.body.paths:[],confirm=String(req.body?.confirm||"");
    if(!["archive","delete"].includes(action)||!paths.length)return res.status(400).json({ok:false,error:"Valid action and paths are required"});
    const expected=action==="archive"?"ARCHIVE_BATCH":"DELETE_BATCH";if(confirm!==expected)return res.status(400).json({ok:false,error:"Explicit batch confirmation required"});
    const safety=await createOperationalBackupNamed("pre-appliance-batch-cleanup");
    const result=await hostAgentRequest("POST","/cleanup/legacy-batch",{paths,action,confirm});
    res.json({ok:true,safetyBackup:safety.name,result});
  }catch(e){res.status(e.status||500).json(e.payload||{ok:false,error:e.message})}
});
app.post("/host/cleanup/container",async(req,res)=>{
  try{
    const name=cleanName(req.body?.name||""),action=String(req.body?.action||"remove"),confirm=String(req.body?.confirm||"");
    if(!["portainer","nodered"].includes(name))return res.status(400).json({ok:false,error:"Container is not an approved redundant/optional cleanup candidate"});
    if(action!=="remove"||confirm!=="REMOVE")return res.status(400).json({ok:false,error:"Explicit REMOVE confirmation required"});
    let composeServices=[];try{const r=await run("docker",["compose","config","--services"],{cwd:HUB_ROOT,timeout:10000});composeServices=r.stdout.split(/\r?\n/).filter(Boolean)}catch{}
    if(composeServices.includes(name))return res.status(409).json({ok:false,error:`${name} is part of the current Classroom Control Hub Compose project and cannot be removed through cleanup`});
    const inspect=await run("docker",["inspect",name],{timeout:10000}).catch(()=>null);
    if(!inspect)return res.status(404).json({ok:false,error:"Container not found"});
    // Confirm Hub Docker management is operational before removing an alternate Docker UI.
    await run("docker",["info","--format","{{.ServerVersion}}"],{timeout:7000});
    const safety=await createOperationalBackupNamed("pre-container-cleanup");
    await run("docker",["rm","-f",name],{timeout:30000});
    res.json({ok:true,name,action:"remove",safetyBackup:safety.name,volumesPreserved:true,message:`${name} container removed. Named volumes were intentionally preserved for rollback.`});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
});

app.get("/docker/containers",async(_req,res)=>{try{res.json({ok:true,containers:await dockerContainers()})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/docker/stats",async(_req,res)=>{try{const r=await run("docker",["stats","--no-stream","--format","{{json .}}"],{timeout:15000,maxBuffer:8*1024*1024});const stats=r.stdout.split(/\r?\n/).filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return {raw:x}}});res.json({ok:true,stats})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/checks/run",async(_req,res)=>{
  const checks=[];async function check(name,fn){const started=Date.now();try{const value=await fn();checks.push({name,ok:true,ms:Date.now()-started,value})}catch(e){checks.push({name,ok:false,ms:Date.now()-started,error:e.message})}}
  await check("Docker Engine",async()=>String((await run("docker",["info","--format","{{.ServerVersion}}"],{timeout:7000})).stdout||"").trim());
  await check("Classroom Control Hub Root",async()=>{if(!fs.existsSync(HUB_ROOT))throw Error("Missing managed Classroom Control Hub root");return HUB_ROOT});
  await check("Services Stack Root",async()=>{if(!fs.existsSync(Classroom_ROOT))throw Error("Missing managed services-stack root");return Classroom_ROOT});
  await check("SQLite Database",async()=>{const i=dbStore.databaseInfo();if(!i.file||!fs.existsSync(i.file))throw Error("Database file missing");return {schemaVersion:i.schemaVersion,size:i.size,journalMode:i.journalMode}});
  await check("Disk Capacity",async()=>String((await run("df",["-h","/managed/classroom-hub"])).stdout||"").trim());
  await check("Container Inventory",async()=>({count:(await dockerContainers()).length}));
  const failed=checks.filter(x=>!x.ok).length;res.status(failed?207:200).json({ok:failed===0,generatedAt:new Date().toISOString(),summary:{total:checks.length,passed:checks.length-failed,failed},checks});
});
app.post("/docker/:name/:action",async(req,res)=>{const name=cleanName(req.params.name),action=String(req.params.action||"");if(!["start","stop","restart","kill"].includes(action))return res.status(400).json({ok:false,error:"Unsupported action"});try{const r=await run("docker",[action,name],{timeout:30000});res.json({ok:true,name,action,...r})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/docker/:name/logs",async(req,res)=>{const name=cleanName(req.params.name),tail=String(Math.max(1,Math.min(5000,Number(req.query.tail||300))));try{const r=await run("docker",["logs","--timestamps","--tail",tail,name],{timeout:20000,maxBuffer:16*1024*1024});const text=(r.stdout||"")+(r.stderr||"");if(String(req.query.download||"")==="1"){res.setHeader("Content-Disposition",`attachment; filename="${name}-${Date.now()}.log"`);res.type("text/plain").send(text)}else res.json({ok:true,name,tail:Number(tail),text})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/files",(req,res)=>{try{const root=String(req.query.root||"hub"),base=safeRoot(root),p=safePath(root,req.query.path||"");if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Path not found"});const st=fs.statSync(p);if(!st.isDirectory())return res.json({ok:true,root,item:statInfo(p,base)});const items=fs.readdirSync(p).filter(n=>!["node_modules",".git"].includes(n)).map(n=>statInfo(path.join(p,n),base)).sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==="directory"?-1:1);res.json({ok:true,root,path:path.relative(base,p)||".",items})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.get("/file",(req,res)=>{try{const root=String(req.query.root||"hub"),base=safeRoot(root),p=safePath(root,req.query.path||"");if(!fs.existsSync(p)||fs.statSync(p).isDirectory())return res.status(404).json({ok:false,error:"File not found"});if(String(req.query.download||"")==="1")return res.download(p,path.basename(p));const max=2*1024*1024,st=fs.statSync(p);if(st.size>max)return res.status(413).json({ok:false,error:"File too large for editor; download it instead",size:st.size});res.json({ok:true,root,path:path.relative(base,p),size:st.size,modifiedAt:st.mtime.toISOString(),content:fs.readFileSync(p,"utf8")})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.put("/file",(req,res)=>{try{const root=String(req.body?.root||"hub"),p=safePath(root,req.body?.path||"");if(fs.existsSync(p)&&fs.statSync(p).isDirectory())throw Error("Cannot overwrite a directory");fs.mkdirSync(path.dirname(p),{recursive:true});if(fs.existsSync(p))fs.copyFileSync(p,p+`.bak-${Date.now()}`);fs.writeFileSync(p,String(req.body?.content??""),"utf8");res.json({ok:true,path:req.body.path})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.delete("/file",(req,res)=>{try{const root=String(req.body?.root||"hub"),p=safePath(root,req.body?.path||"");if(!fs.existsSync(p))return res.json({ok:true,missing:true});const trash=path.join(HUB_ROOT,"data","backups","file-trash",String(Date.now())+"-"+cleanName(path.basename(p)));fs.mkdirSync(path.dirname(trash),{recursive:true});fs.renameSync(p,trash);res.json({ok:true,trashedTo:trash})}catch(e){res.status(400).json({ok:false,error:e.message})}});
const upload=multer({dest:UPLOAD_DIR,limits:{fileSize:1024*1024*1024}});
app.post("/file/upload",upload.single("file"),(req,res)=>{try{const root=String(req.body?.root||"hub"),dir=safePath(root,req.body?.path||""),name=cleanName(req.file?.originalname||"");if(!req.file||!name)throw Error("File required");fs.mkdirSync(dir,{recursive:true});const dest=path.join(dir,name);if(fs.existsSync(dest))fs.copyFileSync(dest,dest+`.bak-${Date.now()}`);fs.renameSync(req.file.path,dest);res.json({ok:true,name,path:dest})}catch(e){if(req.file?.path&&fs.existsSync(req.file.path))fs.unlinkSync(req.file.path);res.status(400).json({ok:false,error:e.message})}});
function copyIntoZip(zip,src,prefix,filter){if(!fs.existsSync(src))return;for(const ent of fs.readdirSync(src,{withFileTypes:true})){const full=path.join(src,ent.name),rel=path.posix.join(prefix,ent.name);if(filter&&!filter(full,rel,ent))continue;if(ent.isDirectory())copyIntoZip(zip,full,rel,filter);else zip.addLocalFile(full,path.posix.dirname(rel),path.basename(rel))}}
function backupFilter(scope){
  const skipDirs=new Set(["node_modules",".git","convert-tmp","presentation-upload-tmp"]);
  return (_full,rel,ent)=>{
    const normalized=String(rel||"").replace(/\\/g,"/");
    const parts=normalized.split("/").filter(Boolean);
    if(ent.isDirectory()&&skipDirs.has(ent.name))return false;
    // Never recursively embed managed backups, migration archives, trash or
    // legacy import material inside a new recovery archive.
    if(normalized.includes("/data/backups/")||normalized.endsWith("/data/backups"))return false;
    if(normalized.includes("/data/legacy/")||normalized.endsWith("/data/legacy"))return false;
    if(normalized.includes("/data/file-trash/")||normalized.endsWith("/data/file-trash"))return false;
    if(scope==="configuration"){
      // Configuration backups intentionally omit bulky/ephemeral runtime data;
      // the consistent SQLite snapshot is added separately by backup/create.
      if(normalized.includes("/data/"))return false;
      if(normalized.startsWith("services/"))return false;
    }
    if(scope==="quick"&&(normalized.includes("/data/")||normalized.startsWith("classroom-hub/data/")))return false;
    if(scope==="diagnostic"&&(/\.(pem|key|crt)$/i.test(normalized)||normalized.endsWith("/.env")))return false;
    if(normalized.endsWith("/.env")||normalized==="classroom-hub/.env")return scope==="full";
    return true;
  }
}
app.post("/backup/create",async(req,res)=>{try{
  const scope=["configuration","quick","operational","diagnostic","full"].includes(req.body?.scope)?req.body.scope:"operational";
  if(scope==="full"&&req.body?.confirmSecrets!==true)return res.status(400).json({ok:false,error:"Full recovery backup contains .env and the database encryption master key. Resubmit with confirmSecrets=true."});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-"),name=`classroom-hub-${scope}-${stamp}.zip`,dest=path.join(BACKUP_DIR,name),zip=new AdmZip();
  const dbPath=path.join(HUB_ROOT,"data","classroom-control-hub.db"),dbSnapshot=path.join(UPLOAD_DIR,`db-backup-${Date.now()}.db`);
  let hasDbSnapshot=false;if(fs.existsSync(dbPath)){await run("sqlite3",[dbPath,`.backup '${dbSnapshot.replace(/'/g,"''")}'`],{timeout:60000});hasDbSnapshot=fs.existsSync(dbSnapshot)}
  const baseFilter=backupFilter(scope),filter=(full,rel,ent)=>{if(/classroom-hub\.db(?:-wal|-shm)?$/.test(rel))return false;return baseFilter(full,rel,ent)};
  copyIntoZip(zip,HUB_ROOT,"classroom-hub",filter);if(hasDbSnapshot)zip.addLocalFile(dbSnapshot,"classroom-hub/data","classroom-control-hub.db");
  if(scope==="full"||scope==="operational"||scope==="diagnostic")copyIntoZip(zip,Classroom_ROOT,"services",filter);
  if(scope==="full"&&fs.existsSync(MASTER_KEY_FILE))zip.addLocalFile(MASTER_KEY_FILE,"recovery-secrets","classroom-hub-master.key");
  const manifest={version:2,createdAt:new Date().toISOString(),scope,hostname:os.hostname(),hubRoot:HUB_ROOT,servicesRoot:Classroom_ROOT,databaseSnapshot:hasDbSnapshot,containsSecrets:scope==="full",requiresMasterKey:true};
  zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify(manifest,null,2)));zip.writeZip(dest);if(hasDbSnapshot)fs.rmSync(dbSnapshot,{force:true});
  res.json({ok:true,name,size:fs.statSync(dest).size,download:`/backup/${encodeURIComponent(name)}`,containsSecrets:scope==="full"})
}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/backups",(_req,res)=>{const items=fs.readdirSync(BACKUP_DIR).filter(x=>x.endsWith(".zip")).map(n=>statInfo(path.join(BACKUP_DIR,n),BACKUP_DIR)).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));res.json({ok:true,items})});
app.get("/backups/catalog",(_req,res)=>{try{
  const managed=fs.readdirSync(BACKUP_DIR).filter(x=>x.endsWith(".zip")).map(n=>({...statInfo(path.join(BACKUP_DIR,n),BACKUP_DIR),source:"managed",restorable:true}));
  const migrationRoot="/host-backups";
  const migrations=[];
  if(fs.existsSync(migrationRoot))for(const ent of fs.readdirSync(migrationRoot,{withFileTypes:true})){
    if(!ent.isDirectory())continue;
    const p=path.join(migrationRoot,ent.name),st=fs.statSync(p);
    migrations.push({name:ent.name,path:p,type:"directory",size:0,modifiedAt:st.mtime.toISOString(),source:"migration",restorable:false,note:"Installer rollback snapshot; inspect or download from host backup location."});
  }
  res.json({ok:true,managed:managed.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)),migrations:migrations.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt))});
}catch(e){res.status(500).json({ok:false,error:e.message})}});


app.get("/backups/retention",(_req,res)=>{try{const items=fs.readdirSync(BACKUP_DIR).filter(n=>n.endsWith(".zip")).map(n=>statInfo(path.join(BACKUP_DIR,n),BACKUP_DIR)).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));const automatic=items.filter(x=>/^pre-/.test(x.name));res.json({ok:true,total:items.length,automatic:automatic.length,automaticBytes:automatic.reduce((a,x)=>a+Number(x.size||0),0),items:automatic})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.post("/backups/retention",(req,res)=>{try{const keep=Math.max(2,Math.min(250,Number(req.body?.keep||10)));if(String(req.body?.confirm||"")!=="PRUNE_AUTOMATIC_BACKUPS")return res.status(400).json({ok:false,error:"Explicit confirmation required"});const items=fs.readdirSync(BACKUP_DIR).filter(n=>/^pre-.*\.zip$/.test(n)).map(n=>statInfo(path.join(BACKUP_DIR,n),BACKUP_DIR)).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));const doomed=items.slice(keep);let bytes=0;for(const x of doomed){const p=path.join(BACKUP_DIR,x.name);bytes+=fs.statSync(p).size;fs.unlinkSync(p)}res.json({ok:true,keep,removed:doomed.length,bytesFreed:bytes,remaining:Math.min(items.length,keep)})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/backup/:name",(req,res)=>{const name=cleanName(req.params.name),p=path.join(BACKUP_DIR,name);if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Backup not found"});res.download(p,name)});
app.get("/backup/:name/inspect",(req,res)=>{try{const name=cleanName(req.params.name),p=path.join(BACKUP_DIR,name);if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Backup not found"});const zip=new AdmZip(p),entries=zip.getEntries();let manifest=null;const m=entries.find(e=>e.entryName==="backup-manifest.json");if(m)try{manifest=JSON.parse(m.getData().toString("utf8"))}catch{}res.json({ok:true,name,size:fs.statSync(p).size,manifest,entries:entries.length,preview:entries.slice(0,100).map(e=>({name:e.entryName,size:e.header.size,directory:e.isDirectory}))})}catch(e){res.status(400).json({ok:false,error:e.message})}});

// alpha.8 safe backup restore workflow
async function createOperationalBackupNamed(prefix="pre-restore") {
  const name=`${prefix}-${new Date().toISOString().replace(/[:.]/g,"-")}.zip`;
  const dest=path.join(BACKUP_DIR,name);
  const dbPath=path.join(HUB_ROOT,"data","classroom-control-hub.db");
  const dbSnapshot=path.join(UPLOAD_DIR,`db-backup-${Date.now()}.db`);
  let hasDbSnapshot=false;
  if(fs.existsSync(dbPath)){
    await run("sqlite3",[dbPath,`.backup '${dbSnapshot.replace(/'/g,"''")}'`],{timeout:60000});
    hasDbSnapshot=fs.existsSync(dbSnapshot);
  }
  const zip=new AdmZip();
  const filter=(full,rel,ent)=>{if(/classroom-hub\.db(?:-wal|-shm)?$/.test(rel))return false;return backupFilter("operational")(full,rel,ent)};
  copyIntoZip(zip,HUB_ROOT,"classroom-hub",filter);
  if(hasDbSnapshot)zip.addLocalFile(dbSnapshot,"classroom-hub/data","classroom-control-hub.db");
  zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify({version:2,scope:"operational",createdAt:new Date().toISOString(),reason:prefix},null,2)));
  zip.writeZip(dest);
  if(hasDbSnapshot)fs.rmSync(dbSnapshot,{force:true});
  return {name,dest,size:fs.statSync(dest).size};
}
function backupRestorePlan(name){
  const p=path.join(BACKUP_DIR,cleanName(name));
  if(!fs.existsSync(p))throw Error("Backup not found");
  const zip=new AdmZip(p),entries=zip.getEntries();
  let manifest=null;const me=entries.find(e=>e.entryName==="backup-manifest.json");
  if(me)try{manifest=JSON.parse(me.getData().toString("utf8"))}catch{}
  const names=entries.map(e=>e.entryName.replace(/\\/g,"/"));
  return {name:cleanName(name),path:p,manifest,entries:entries.length,hasConfig:names.some(n=>n.startsWith("classroom-hub/config/")),hasData:names.some(n=>n.startsWith("classroom-hub/data/")),hasDatabase:names.includes("classroom-hub/data/classroom-control-hub.db"),hasEnv:names.includes("classroom-hub/.env"),hasMasterKey:names.some(n=>/master\.key$/.test(n)),preview:names.slice(0,100)};
}
app.get("/backup/:name/restore-plan",(req,res)=>{try{res.json({ok:true,plan:backupRestorePlan(req.params.name)})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post("/backup/:name/restore",async(req,res)=>{
  let stopped=false,temp=null;
  try{
    if(String(req.body?.confirm||"")!=="RESTORE")return res.status(400).json({ok:false,error:"Restore requires confirm=RESTORE"});
    const mode=String(req.body?.mode||"configuration-data");
    if(!["configuration","data","configuration-data"].includes(mode))throw Error("Invalid restore mode");
    const plan=backupRestorePlan(req.params.name);
    const safety=await createOperationalBackupNamed("pre-restore");
    temp=path.join(UPLOAD_DIR,`restore-${Date.now()}`);fs.mkdirSync(temp,{recursive:true});new AdmZip(plan.path).extractAllTo(temp,true);
    const srcRoot=path.join(temp,"classroom-hub");if(!fs.existsSync(srcRoot))throw Error("Backup does not contain classroom-hub root");
    const doConfig=mode.includes("configuration"),doData=mode.includes("data");
    const restored=[];
    if(doConfig){
      const src=path.join(srcRoot,"config"),dst=path.join(HUB_ROOT,"config");
      if(fs.existsSync(src)){fs.rmSync(dst,{recursive:true,force:true});fs.cpSync(src,dst,{recursive:true});restored.push("config")}
    }
    if(doData){
      const src=path.join(srcRoot,"data"),dst=path.join(HUB_ROOT,"data");
      if(fs.existsSync(src)){
        await run("docker",["stop","classroom-hub"],{timeout:30000});stopped=true;
        // Preserve server-side backup history while restoring operational data.
        const keepBackups=path.join(dst,"backups");
        const backupHold=path.join(UPLOAD_DIR,`backups-hold-${Date.now()}`);
        if(fs.existsSync(keepBackups))fs.cpSync(keepBackups,backupHold,{recursive:true});
        for(const ent of fs.readdirSync(dst,{withFileTypes:true})){if(ent.name==="backups")continue;fs.rmSync(path.join(dst,ent.name),{recursive:true,force:true})}
        for(const ent of fs.readdirSync(src,{withFileTypes:true})){if(ent.name==="backups")continue;fs.cpSync(path.join(src,ent.name),path.join(dst,ent.name),{recursive:true})}
        for(const suffix of ["-wal","-shm"])fs.rmSync(path.join(dst,"classroom-control-hub.db"+suffix),{force:true});
        restored.push("data");
      }
    }
    if(stopped){await run("docker",["start","classroom-hub"],{timeout:30000});stopped=false}
    res.json({ok:true,name:plan.name,mode,restored,safetyBackup:safety.name,message:"Restore completed. Classroom Control Hub was restarted when database/data restoration was required."});
  }catch(e){
    if(stopped)try{await run("docker",["start","classroom-hub"],{timeout:30000})}catch{}
    res.status(500).json({ok:false,error:e.message});
  }finally{if(temp)try{fs.rmSync(temp,{recursive:true,force:true})}catch{}}
});
app.delete("/backup/:name",(req,res)=>{try{const name=cleanName(req.params.name),p=path.join(BACKUP_DIR,name);if(!fs.existsSync(p))return res.json({ok:true,missing:true});fs.unlinkSync(p);res.json({ok:true,name})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.get("/audit/status",(_req,res)=>{try{const total=dbStore.db.prepare("SELECT COUNT(*) c FROM audit_events").get().c;const first=dbStore.db.prepare("SELECT at FROM audit_events ORDER BY at ASC LIMIT 1").get()?.at||null;const last=dbStore.db.prepare("SELECT at FROM audit_events ORDER BY at DESC LIMIT 1").get()?.at||null;res.json({ok:true,total,first,last,database:dbStore.databaseInfo()})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.post("/audit/prune",(req,res)=>{try{const days=Math.max(7,Math.min(3650,Number(req.body?.days||180)));if(req.body?.confirm!==true)return res.status(400).json({ok:false,error:"Confirmation required"});const cutoff=new Date(Date.now()-days*86400000).toISOString();const before=dbStore.db.prepare("SELECT COUNT(*) c FROM audit_events").get().c;const info=dbStore.db.prepare("DELETE FROM audit_events WHERE at < ?").run(cutoff);dbStore.db.exec("PRAGMA wal_checkpoint(PASSIVE)");const after=dbStore.db.prepare("SELECT COUNT(*) c FROM audit_events").get().c;res.json({ok:true,days,cutoff,removed:info.changes,before,after})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/diagnostics/bundle",async(_req,res)=>{try{
  const stamp=new Date().toISOString().replace(/[:.]/g,"-"),name=`classroom-hub-diagnostics-${stamp}.zip`,dest=path.join(BACKUP_DIR,name),zip=new AdmZip();
  const info={createdAt:new Date().toISOString(),agentVersion:"1.0.0-alpha.66",database:dbStore.databaseInfo(),roots:{hub:HUB_ROOT,services:Classroom_ROOT,services:Classroom_ROOT}};
  zip.addFile("summary.json",Buffer.from(JSON.stringify(info,null,2)));
  try{const c=await dockerContainers();zip.addFile("docker/containers.json",Buffer.from(JSON.stringify(c,null,2)));for(const row of c){const n=cleanName(row.Names||row.Name||"");if(!n)continue;try{const r=await run("docker",["logs","--timestamps","--tail","1000",n],{timeout:20000,maxBuffer:16*1024*1024});zip.addFile(`logs/${n}.log`,Buffer.from((r.stdout||"")+(r.stderr||"")))}catch(e){zip.addFile(`logs/${n}.error.txt`,Buffer.from(e.message))}}}catch(e){zip.addFile("docker/error.txt",Buffer.from(e.message))}
  try{const r=await run("docker",["stats","--no-stream","--format","{{json .}}"],{timeout:15000});zip.addFile("docker/stats.jsonl",Buffer.from(r.stdout||""))}catch{}
  try{const r=await run("df",["-h"]);zip.addFile("host/disk.txt",Buffer.from(r.stdout||""))}catch{}
  try{const r=await run("ip",["addr"]);zip.addFile("host/ip-addr.txt",Buffer.from(r.stdout||""))}catch{}
  try{const r=await run("ip",["route"]);zip.addFile("host/routes.txt",Buffer.from(r.stdout||""))}catch{}
  zip.writeZip(dest);res.download(dest,name);
}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.post("/update/stage",upload.single("file"),(req,res)=>{try{if(!req.file)throw Error("Update ZIP required");const zip=new AdmZip(req.file.path),entries=zip.getEntries();for(const e of entries){const n=e.entryName.replace(/\\/g,"/");if(n.startsWith("/")||n.includes("../"))throw Error(`Unsafe archive path: ${n}`)}const manifestEntry=entries.find(e=>/(^|\/)package\.json$/.test(e.entryName));let pkg=null;if(manifestEntry)try{pkg=JSON.parse(manifestEntry.getData().toString("utf8"))}catch{}const staged=path.join(UPLOAD_DIR,`update-${Date.now()}.zip`);fs.renameSync(req.file.path,staged);res.json({ok:true,stagedId:path.basename(staged),package:pkg,entries:entries.length})}catch(e){if(req.file?.path&&fs.existsSync(req.file.path))fs.unlinkSync(req.file.path);res.status(400).json({ok:false,error:e.message})}});
app.post("/update/deploy",async(req,res)=>{try{const id=cleanName(req.body?.stagedId||""),src=path.join(UPLOAD_DIR,id);if(!id||!fs.existsSync(src))throw Error("Staged update not found");const backupName=`pre-update-${new Date().toISOString().replace(/[:.]/g,"-")}.zip`;const zipBackup=new AdmZip();copyIntoZip(zipBackup,HUB_ROOT,"classroom-hub",backupFilter("operational"));zipBackup.writeZip(path.join(BACKUP_DIR,backupName));const temp=path.join(UPLOAD_DIR,`extract-${Date.now()}`);fs.mkdirSync(temp,{recursive:true});new AdmZip(src).extractAllTo(temp,true);let source=temp;if(fs.existsSync(path.join(temp,"classroom-hub")))source=path.join(temp,"classroom-hub");for(const name of ["src","public","maintenance-agent","Dockerfile","docker-compose.yml","package.json","package-lock.json","install.sh","README.md","INSTALL.md","SECURITY.md","LICENSE","CHANGELOG.md","VERSION","docs","config"]){const from=path.join(source,name),to=path.join(HUB_ROOT,name);if(!fs.existsSync(from))continue;fs.rmSync(to,{recursive:true,force:true});fs.cpSync(from,to,{recursive:true})}res.json({ok:true,message:"Update installed; Classroom Control Hub rebuild scheduled",backup:backupName});setTimeout(()=>{
  // Run the rebuild from a separate Docker CLI container so it survives the
  // maintenance-agent container being recreated during the update.
  const args=["run","--rm","-d","-v","/var/run/docker.sock:/var/run/docker.sock","-v",`${HOST_HUB_PATH}:/workspace`,"-w","/workspace","docker:cli","sh","-lc","docker compose up -d --build"];
  const child=spawn("docker",args,{detached:true,stdio:"ignore"});child.unref();
},700)}catch(e){res.status(500).json({ok:false,error:e.message})}});

const MANAGED_INTEGRATIONS_FILE=path.join(HUB_ROOT,"data","managed-integrations.json");
function secretSetting(k){return /password|token|secret|api.?key|credential/i.test(String(k||""))}
function secretName(id,k){return `integration.${id}.${k}`}
function readManagedIntegrations(){
  const relational=dbStore.getManagedIntegrations();
  if(Object.keys(relational.modules||{}).length)return relational;
  let v=null;
  if(dbStore.hasObject("managed-integrations"))v=dbStore.getObject("managed-integrations",{version:1,modules:{}});
  else if(fs.existsSync(MANAGED_INTEGRATIONS_FILE)){try{v=JSON.parse(fs.readFileSync(MANAGED_INTEGRATIONS_FILE,"utf8"))}catch{}}
  if(v){for(const [id,cfg] of Object.entries(v.modules||{})){for(const [k,val] of Object.entries(cfg||{})){if(secretSetting(k)&&val&&val!=="__encrypted__"){dbStore.putSecret(secretName(id,k),String(val),{type:"integration-setting",integration:id,key:k});cfg[k]="__encrypted__"}}}dbStore.putManagedIntegrations(v);dbStore.deleteObject("managed-integrations");dbStore.recordMigration(MANAGED_INTEGRATIONS_FILE,"sqlite:managed_modules",Object.keys(v.modules||{}).length,{type:"integration-config"});return v}
  return {version:1,modules:{}}
}
function writeManagedIntegrations(v){dbStore.putManagedIntegrations(v)}
function resolvedIntegrationConfig(id,cfg){const out={...cfg};for(const k of Object.keys(out)){if(secretSetting(k)&&out[k]==="__encrypted__")out[k]=dbStore.getSecret(secretName(id,k))||""}return out}
const MODULES={
  mosquitto:{name:"MQTT Broker",container:"mosquitto",image:"eclipse-mosquitto:latest",description:"MQTT broker used by Classroom Control Hub integrations.",expectedProject:"services",ownership:"integration"},
  govee2mqtt:{name:"Govee Lighting",container:"govee2mqtt",image:"ghcr.io/wez/govee2mqtt:latest",description:"Govee discovery and LAN/cloud control through MQTT.",expectedProject:"services",ownership:"integration"},
  musicassistant:{name:"Music Assistant",container:"music-assistant-server",image:"ghcr.io/music-assistant/server:latest",description:"Classroom audio and media service discovered as an externally managed Compose integration.",expectedProject:"music-assistant",ownership:"integration",externalOnly:true},
  nodered:{name:"Node-RED",container:"nodered",image:"nodered/node-red:latest",description:"Optional visual automation environment.",ownership:"optional"}
};
async function containerExists(name){try{await run("docker",["inspect",name],{timeout:5000});return true}catch{return false}}
app.get("/modules",async(_req,res)=>{
  const cfg=readManagedIntegrations(),out=[];
  for(const [id,m] of Object.entries(MODULES)){
    let state="not-installed",status="",composeProject="",composeService="";
    if(await containerExists(m.container)){
      try{const r=await run("docker",["inspect","-f","{{.State.Status}}",m.container]);state=r.stdout.trim()||"installed"}catch{state="installed"}
      try{const r=await run("docker",["inspect","-f","{{.State.Health.Status}}",m.container]);status=r.stdout.trim()}catch{}
      try{const r=await run("docker",["inspect","-f","{{ index .Config.Labels \"com.docker.compose.project\" }}|{{ index .Config.Labels \"com.docker.compose.service\" }}",m.container]);[composeProject,composeService]=r.stdout.trim().split("|")}catch{}
    }
    const configured=!!cfg.modules?.[id];
    let management=state==="not-installed"?"not-installed":configured?"managed":(m.expectedProject&&composeProject===m.expectedProject)?"adopted":"external";
    out.push({id,...m,state,health:status,configured,management,composeProject,composeService,canDeploy:!m.externalOnly,canRemove:!m.externalOnly});
  }
  res.json({ok:true,modules:out})
});
app.get("/modules/:id/config",(req,res)=>{const id=String(req.params.id||""),cfg=readManagedIntegrations().modules?.[id]||{};const masked={...cfg};for(const k of Object.keys(masked))if(secretSetting(k)&&(masked[k]||dbStore.hasSecret(secretName(id,k))))masked[k]="••••••••";res.json({ok:true,id,config:masked})});
app.post("/modules/:id/deploy",async(req,res)=>{const id=String(req.params.id||""),m=MODULES[id];if(!m)return res.status(404).json({ok:false,error:"Unknown integration"});if(m.externalOnly)return res.status(409).json({ok:false,error:"This integration is externally managed and can be monitored/adopted without recreating it."});try{const settings=req.body?.settings||{},cfg=readManagedIntegrations();cfg.modules=cfg.modules||{};const prior=cfg.modules[id]||{};for(const [k,v] of Object.entries(settings)){if(v==="••••••••")continue;if(secretSetting(k)){if(v!==undefined&&v!==null&&String(v)!==""){dbStore.putSecret(secretName(id,k),String(v),{type:"integration-setting",integration:id,key:k});prior[k]="__encrypted__"}}else prior[k]=v}cfg.modules[id]=prior;writeManagedIntegrations(cfg);const resolved=resolvedIntegrationConfig(id,prior);const exists=await containerExists(m.container);if(exists&&!req.body?.recreate)return res.json({ok:true,id,adopted:true,message:"Existing container adopted. Use recreate to apply managed settings."});if(exists)await run("docker",["rm","-f",m.container],{timeout:30000});let args=["run","-d","--name",m.container,"--restart","unless-stopped"];
  if(id==="mosquitto"){
    const base=path.join(Classroom_ROOT,"mosquitto");for(const d of ["config","data","log"])fs.mkdirSync(path.join(base,d),{recursive:true});const conf=path.join(base,"config","mosquitto.conf");if(!fs.existsSync(conf))fs.writeFileSync(conf,"persistence true\npersistence_location /mosquitto/data/\nlog_dest stdout\nlistener 1883\nallow_anonymous true\n");args.push("-p",`${resolved.port||1883}:1883`,"-v",`${base}/config:/mosquitto/config`,`-v`,`${base}/data:/mosquitto/data`,`-v`,`${base}/log:/mosquitto/log`);
  } else if(id==="govee2mqtt"){
    args.push("--network","host","-e",`GOVEE_MQTT_HOST=${resolved.mqttHost||"127.0.0.1"}`,"-e",`GOVEE_MQTT_PORT=${resolved.mqttPort||1883}`,"-e",`GOVEE_LAN_BROADCAST_ALL=${resolved.lanBroadcast===false?"false":"true"}`,"-e",`GOVEE_TEMPERATURE_SCALE=${resolved.temperatureScale||"F"}`,"-e",`TZ=${resolved.timezone||process.env.TZ||"UTC"}`);if(resolved.apiKey)args.push("-e",`GOVEE_API_KEY=${resolved.apiKey}`);if(resolved.email)args.push("-e",`GOVEE_EMAIL=${resolved.email}`);if(resolved.password)args.push("-e",`GOVEE_PASSWORD=${resolved.password}`);
  } else if(id==="nodered"){
    const data=path.join(Classroom_ROOT,"nodered");fs.mkdirSync(data,{recursive:true});args.push("-p",`${resolved.port||1880}:1880`,"-v",`${data}:/data`,`-e`,`TZ=${resolved.timezone||process.env.TZ||"UTC"}`);if(resolved.credentialSecret)args.push("-e",`NODE_RED_CREDENTIAL_SECRET=${resolved.credentialSecret}`);
  } else if(id==="portainer"){
    args.push("-p",`${resolved.httpPort||9000}:9000`,"-p",`${resolved.httpsPort||9443}:9443`,"-v","/var/run/docker.sock:/var/run/docker.sock","-v","portainer_data:/data");
  }
  args.push(m.image);const r=await run("docker",args,{timeout:120000,maxBuffer:16*1024*1024});res.json({ok:true,id,container:m.container,output:r.stdout.trim()})}catch(e){res.status(500).json({ok:false,error:e.message,output:(e.stdout||"")+(e.stderr||"")})}});
app.post("/modules/:id/remove",async(req,res)=>{const id=String(req.params.id||""),m=MODULES[id];if(!m)return res.status(404).json({ok:false,error:"Unknown integration"});if(m.externalOnly)return res.status(409).json({ok:false,error:"Externally managed integrations are not removed from Classroom Control Hub."});try{if(await containerExists(m.container))await run("docker",["rm","-f",m.container],{timeout:30000});res.json({ok:true,id})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/env",(req,res)=>{try{const root=String(req.query.root||"hub"),p=safePath(root,".env");const rows=[];if(fs.existsSync(p))for(const line of fs.readFileSync(p,"utf8").split(/\r?\n/)){if(!line||line.trim().startsWith("#")||!line.includes("="))continue;const i=line.indexOf("="),key=line.slice(0,i).trim(),val=line.slice(i+1);rows.push({key,value:/password|token|secret|api.?key/i.test(key)&&val?"••••••••":val,secret:/password|token|secret|api.?key/i.test(key)})}res.json({ok:true,root,exists:fs.existsSync(p),variables:rows})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.put("/env",(req,res)=>{try{const root=String(req.body?.root||"hub"),p=safePath(root,".env"),existing={};if(fs.existsSync(p))for(const line of fs.readFileSync(p,"utf8").split(/\r?\n/)){if(!line||line.trim().startsWith("#")||!line.includes("="))continue;const i=line.indexOf("=");existing[line.slice(0,i).trim()]=line.slice(i+1)}for(const row of req.body?.variables||[]){const key=String(row.key||"").trim();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))continue;if(row.value==="••••••••")continue;existing[key]=String(row.value??"")}if(fs.existsSync(p))fs.copyFileSync(p,p+`.bak-${Date.now()}`);fs.writeFileSync(p,Object.entries(existing).map(([k,v])=>`${k}=${v}`).join("\n")+"\n",{mode:0o600});res.json({ok:true,root,count:Object.keys(existing).length})}catch(e){res.status(400).json({ok:false,error:e.message})}});

const safeCommands={
  "docker-ps":["docker",["ps","-a"]],"docker-stats":["docker",["stats","--no-stream"]],"disk-usage":["df",["-h"]],"memory":["free",["-h"]],"network":["ip",["addr"]],"routes":["ip",["route"]],"dns":["cat",["/etc/resolv.conf"]],"compose-status":["docker",["compose","-f",path.join(HUB_ROOT,"docker-compose.yml"),"ps"]]
};
app.post("/command",async(req,res)=>{try{const preset=String(req.body?.preset||"");if(preset&&safeCommands[preset]){const [cmd,args]=safeCommands[preset],r=await run(cmd,args,{timeout:30000,maxBuffer:16*1024*1024});return res.json({ok:true,preset,output:(r.stdout||"")+(r.stderr||"")})}if(!ALLOW_SHELL)return res.status(403).json({ok:false,error:"Advanced shell is disabled. Enable MAINTENANCE_ALLOW_SHELL only on trusted installations."});const command=String(req.body?.command||"").trim();if(!command)return res.status(400).json({ok:false,error:"Command required"});const r=await run("/bin/bash",["-lc",command],{timeout:60000,maxBuffer:16*1024*1024,cwd:HUB_ROOT});res.json({ok:true,command,output:(r.stdout||"")+(r.stderr||"")})}catch(e){res.status(500).json({ok:false,error:e.message,output:(e.stdout||"")+(e.stderr||"")})}});
app.listen(PORT,"0.0.0.0",()=>console.log(`Classroom Control Hub Maintenance Agent listening on ${PORT}`));
