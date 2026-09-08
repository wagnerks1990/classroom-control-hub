"use strict";
const express=require("express");
const http=require("http");
const fs=require("fs");
const path=require("path");
const os=require("os");
const {execFile}=require("child_process");
const {promisify}=require("util");
const crypto=require("crypto");
const AdmZip=require("adm-zip");
const execFileAsync=promisify(execFile);
const app=express();
const PORT=Number(process.env.PORT||3010);
const TOKEN=String(process.env.MAINTENANCE_TOKEN||"");
const HUB_ROOT=path.resolve(process.env.MANAGED_HUB_ROOT||"/managed/classroom-hub");
const Classroom_ROOT=path.resolve(process.env.MANAGED_SERVICES_ROOT||"/managed/services");
const HOST_AGENT_SOCKET=String(process.env.HOST_AGENT_SOCKET||"/run/classroom-control-hub/host-agent.sock");
const MAIN_APP_URL=String(process.env.MAIN_APP_URL||"http://classroom-hub:3000").replace(/\/$/,"");
const APP_CONTAINER=cleanName(process.env.MANAGED_APP_CONTAINER||"classroom-control-hub");
const RESTORE_HEALTH_TIMEOUT_MS=Math.max(5000,Math.min(300000,Number(process.env.RESTORE_HEALTH_TIMEOUT_MS||60000)));
const RESTORE_MAX_EXPANDED_BYTES=Math.max(64*1024*1024,Number(process.env.RESTORE_MAX_EXPANDED_MB||4096)*1024*1024);
const BACKUP_DIR=path.join(HUB_ROOT,"data","backups");
const MASTER_KEY_FILE=String(process.env.MASTER_KEY_FILE||"/run/secrets/classroom-control-hub-master-key");
const UPLOAD_DIR="/work/uploads";
const APP_UID=Math.max(1,Number(process.env.APP_UID||10001));
const APP_GID=Math.max(1,Number(process.env.APP_GID||10001));
fs.mkdirSync(BACKUP_DIR,{recursive:true});fs.mkdirSync(UPLOAD_DIR,{recursive:true});
app.use(express.json({limit:"8mb"}));
function secretEqual(actual,expected){const a=Buffer.from(String(actual||"")),b=Buffer.from(String(expected||""));return a.length===b.length&&crypto.timingSafeEqual(a,b)}
function auth(req,res,next){if(!TOKEN)return res.status(503).json({ok:false,error:"Maintenance token not configured"});if(!secretEqual(req.get("x-maintenance-token"),TOKEN))return res.status(401).json({ok:false,error:"Unauthorized"});next()}
app.use(auth);
app.use(["/files","/file","/file/upload","/env","/update/stage","/update/deploy"],(_req,res)=>res.status(410).json({ok:false,error:"Direct filesystem, environment-file, and source-ZIP mutation has been removed. Use database-backed settings and verified GitHub releases."}));
function cleanName(v){return String(v||"").replace(/[^A-Za-z0-9._-]/g,"-").slice(0,180)}
function statInfo(p,base){const st=fs.statSync(p);return {name:path.basename(p),path:path.relative(base,p)||".",type:st.isDirectory()?"directory":"file",size:st.size,modifiedAt:st.mtime.toISOString()}}
function sha256File(p){const hash=crypto.createHash("sha256"),fd=fs.openSync(p,"r"),buf=Buffer.allocUnsafe(1024*1024);try{let n=0,pos=0;while((n=fs.readSync(fd,buf,0,buf.length,pos))>0){hash.update(buf.subarray(0,n));pos+=n}return hash.digest("hex")}finally{fs.closeSync(fd)}}
function writeZipAtomic(zip,dest){const partial=`${dest}.partial-${process.pid}-${Date.now()}`;try{zip.writeZip(partial);fs.renameSync(partial,dest)}finally{fs.rmSync(partial,{force:true})}}
function applicationVersion(){try{return fs.readFileSync(path.join(HUB_ROOT,"VERSION"),"utf8").trim()}catch{return null}}
async function run(cmd,args=[],opts={}){if(cmd==="docker")return hostAgentRequest("POST","/docker/exec",{args,cwd:opts.cwd===HUB_ROOT?"hub":""},opts.timeout||180000);const {stdout,stderr}=await execFileAsync(cmd,args,{timeout:opts.timeout||15000,maxBuffer:opts.maxBuffer||8*1024*1024,cwd:opts.cwd||undefined,env:{...process.env,...(opts.env||{})}});return {stdout,stderr}}
async function mainAppRequest(method,pathName,body=null,timeoutMs=30000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(MAIN_APP_URL+pathName,{method,headers:{"x-maintenance-token":TOKEN,...(body==null?{}:{"content-type":"application/json"})},body:body==null?undefined:JSON.stringify(body),signal:controller.signal});
    const text=await response.text();let value;try{value=JSON.parse(text||"{}")}catch{value={ok:false,error:text||`Main application HTTP ${response.status}`}}
    if(!response.ok){const error=Error(value.error||`Main application HTTP ${response.status}`);error.status=response.status;throw error}return value;
  }finally{clearTimeout(timer)}
}
async function mainAppStatus(){return mainAppRequest("GET","/api/v1/internal/maintenance/status",null,10000)}
async function dockerContainers(){const r=await run("docker",["ps","-a","--format","{{json .}}"],{timeout:10000});return r.stdout.split(/\r?\n/).filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return {raw:x}}})}
async function componentHealth(){let docker=false,hostAgent=null,application=null;try{await run("docker",["info","--format","{{.ServerVersion}}"],{timeout:5000});docker=true}catch{}try{hostAgent=await hostAgentRequest("GET","/health")}catch(e){hostAgent={ok:false,error:e.message}}try{application=await mainAppStatus()}catch(e){application={ok:false,error:e.message}}return {version:"1.0.0-alpha.69",docker,hostAgent,roots:{hub:fs.existsSync(HUB_ROOT),services:fs.existsSync(Classroom_ROOT)},shellEnabled:false,application,database:application?.database||null}}
app.get("/health",async(_req,res)=>{const state=await componentHealth(),ready=state.docker&&state.hostAgent?.ok&&state.roots.hub;res.status(ready?200:503).json({ok:ready,alive:true,ready,...state})});
app.get("/ready",async(_req,res)=>{const state=await componentHealth(),ready=state.docker&&state.hostAgent?.ok&&state.roots.hub;res.status(ready?200:503).json({ok:ready,alive:true,ready,...state})});
app.get("/system",async(_req,res)=>{
  const nets=os.networkInterfaces();let disk=null,hostDocker=null;
  try{disk=(await run("df",["-h","/managed/classroom-hub"])).stdout}catch{}
  try{const r=await run("docker",["info","--format","{{json .}}"],{timeout:8000,maxBuffer:8*1024*1024});hostDocker=JSON.parse(r.stdout)}catch{}
  res.json({ok:true,
    host:{hostname:hostDocker?.Name||null,operatingSystem:hostDocker?.OperatingSystem||null,kernelVersion:hostDocker?.KernelVersion||os.release(),architecture:hostDocker?.Architecture||os.arch(),cpus:hostDocker?.NCPU||null,memoryBytes:hostDocker?.MemTotal||null,dockerVersion:hostDocker?.ServerVersion||null,containers:hostDocker?.Containers??null,containersRunning:hostDocker?.ContainersRunning??null},
    agent:{hostname:os.hostname(),platform:os.platform(),release:os.release(),arch:os.arch(),uptimeSeconds:os.uptime(),loadavg:os.loadavg(),memory:{total:os.totalmem(),free:os.freemem()},cpus:os.cpus().length,networks:nets},
    disk,shellEnabled:false,roots:{hub:HUB_ROOT,services:Classroom_ROOT}})
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
app.get("/app-updates/job",async(_req,res)=>{try{res.json(await hostAgentRequest("GET","/app-updates/job",null,30000))}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}});
app.post("/app-updates/start",async(req,res)=>{try{
  if(String(req.body?.confirm||"")!=="INSTALL_RELEASE")return res.status(400).json({ok:false,error:"Explicit INSTALL_RELEASE confirmation required"});
  const targetRef=String(req.body?.targetRef||""),expectedVersion=String(req.body?.expectedVersion||"");
  if(!/^v?\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(targetRef)||!/^v?\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/.test(expectedVersion))return res.status(400).json({ok:false,error:"A semantic-version GitHub release tag and version are required"});
  const safety=await createOperationalBackupNamed("pre-app-update");
  const result=await hostAgentRequest("POST","/app-updates/start",{action:"update",targetRef,expectedVersion,githubToken:String(req.body?.githubToken||""),backupName:safety.name,backupSha256:safety.sha256,failureBackupName:safety.name,failureBackupSha256:safety.sha256,confirm:"INSTALL_RELEASE"},30000);
  res.status(202).json({ok:true,safetyBackup:safety.name,...result});
}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}});
app.post("/app-updates/revert",async(req,res)=>{try{
  if(String(req.body?.confirm||"")!=="REVERT_RELEASE")return res.status(400).json({ok:false,error:"Explicit REVERT_RELEASE confirmation required"});
  const safety=await createOperationalBackupNamed("pre-app-revert");
  const result=await hostAgentRequest("POST","/app-updates/revert",{confirm:"REVERT_RELEASE",failureBackupName:safety.name,failureBackupSha256:safety.sha256},30000);
  res.status(202).json({ok:true,safetyBackup:safety.name,...result});
}catch(e){res.status(e.status||502).json(e.payload||{ok:false,error:e.message})}});
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
  await check("SQLite Database",async()=>{const i=(await mainAppStatus()).database;if(!i?.file)throw Error("Database status unavailable");return {schemaVersion:i.schemaVersion,size:i.size,journalMode:i.journalMode}});
  await check("Disk Capacity",async()=>String((await run("df",["-h","/managed/classroom-hub"])).stdout||"").trim());
  await check("Container Inventory",async()=>({count:(await dockerContainers()).length}));
  const failed=checks.filter(x=>!x.ok).length;res.status(failed?207:200).json({ok:failed===0,generatedAt:new Date().toISOString(),summary:{total:checks.length,passed:checks.length-failed,failed},checks});
});
app.post("/docker/:name/:action",async(req,res)=>{const name=cleanName(req.params.name),action=String(req.params.action||"");if(!["start","stop","restart","kill"].includes(action))return res.status(400).json({ok:false,error:"Unsupported action"});try{const r=await run("docker",[action,name],{timeout:30000});res.json({ok:true,name,action,...r})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/docker/:name/logs",async(req,res)=>{const name=cleanName(req.params.name),tail=String(Math.max(1,Math.min(5000,Number(req.query.tail||300))));try{const r=await run("docker",["logs","--timestamps","--tail",tail,name],{timeout:20000,maxBuffer:16*1024*1024});const text=(r.stdout||"")+(r.stderr||"");if(String(req.query.download||"")==="1"){res.setHeader("Content-Disposition",`attachment; filename="${name}-${Date.now()}.log"`);res.type("text/plain").send(text)}else res.json({ok:true,name,tail:Number(tail),text})}catch(e){res.status(500).json({ok:false,error:e.message})}});
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
app.post("/backup/create",async(req,res)=>{let dbSnapshot="";try{
  const scope=["configuration","quick","operational","diagnostic","full"].includes(req.body?.scope)?req.body.scope:"operational";
  if(scope==="full"&&req.body?.confirmSecrets!==true)return res.status(400).json({ok:false,error:"Full recovery backup contains .env and the database encryption master key. Resubmit with confirmSecrets=true."});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-"),name=`classroom-hub-${scope}-${stamp}.zip`,dest=path.join(BACKUP_DIR,name),zip=new AdmZip();
  const dbPath=path.join(HUB_ROOT,"data","classroom-control-hub.db");dbSnapshot=path.join(UPLOAD_DIR,`db-backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.db`);
  let hasDbSnapshot=false;if(fs.existsSync(dbPath)){await run("sqlite3",[dbPath,`.backup '${dbSnapshot.replace(/'/g,"''")}'`],{timeout:60000});hasDbSnapshot=fs.existsSync(dbSnapshot)}
  const baseFilter=backupFilter(scope),filter=(full,rel,ent)=>{if(/classroom-hub\.db(?:-wal|-shm)?$/.test(rel))return false;return baseFilter(full,rel,ent)};
  copyIntoZip(zip,HUB_ROOT,"classroom-hub",filter);if(hasDbSnapshot)zip.addLocalFile(dbSnapshot,"classroom-hub/data","classroom-control-hub.db");
  if(scope==="full"||scope==="operational"||scope==="diagnostic")copyIntoZip(zip,Classroom_ROOT,"services",filter);
  if(scope==="full"&&fs.existsSync(MASTER_KEY_FILE))zip.addLocalFile(MASTER_KEY_FILE,"recovery-secrets","classroom-hub-master.key");
  const manifest={version:3,createdAt:new Date().toISOString(),scope,applicationVersion:applicationVersion(),hostname:os.hostname(),hubRoot:HUB_ROOT,servicesRoot:Classroom_ROOT,databaseSnapshot:hasDbSnapshot,containsSecrets:scope==="full",requiresMasterKey:true};
  zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify(manifest,null,2)));writeZipAtomic(zip,dest);
  res.json({ok:true,name,size:fs.statSync(dest).size,sha256:sha256File(dest),download:`/backup/${encodeURIComponent(name)}`,containsSecrets:scope==="full"})
}catch(e){res.status(500).json({ok:false,error:e.message})}finally{if(dbSnapshot)try{fs.rmSync(dbSnapshot,{force:true})}catch{}}});
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
app.post("/backups/retention",async(req,res)=>{try{const keep=Math.max(2,Math.min(250,Number(req.body?.keep||10)));if(String(req.body?.confirm||"")!=="PRUNE_AUTOMATIC_BACKUPS")return res.status(400).json({ok:false,error:"Explicit confirmation required"});let pinned="";try{const job=await hostAgentRequest("GET","/app-updates/job");if(job.revertAvailable===true)pinned=String(job.backupName||"")}catch{}const items=fs.readdirSync(BACKUP_DIR).filter(n=>/^pre-.*\.zip$/.test(n)).map(n=>statInfo(path.join(BACKUP_DIR,n),BACKUP_DIR)).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));const doomed=items.slice(keep).filter(x=>x.name!==pinned);let bytes=0;for(const x of doomed){const p=path.join(BACKUP_DIR,x.name);bytes+=fs.statSync(p).size;fs.unlinkSync(p)}res.json({ok:true,keep,pinned:pinned||null,removed:doomed.length,bytesFreed:bytes,remaining:items.length-doomed.length})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/backup/:name",(req,res)=>{const name=cleanName(req.params.name),p=path.join(BACKUP_DIR,name);if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Backup not found"});res.download(p,name)});
app.get("/backup/:name/inspect",(req,res)=>{try{const name=cleanName(req.params.name),p=path.join(BACKUP_DIR,name);if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Backup not found"});const zip=new AdmZip(p),entries=zip.getEntries();let manifest=null;const m=entries.find(e=>e.entryName==="backup-manifest.json");if(m)try{manifest=JSON.parse(m.getData().toString("utf8"))}catch{}res.json({ok:true,name,size:fs.statSync(p).size,manifest,entries:entries.length,preview:entries.slice(0,100).map(e=>({name:e.entryName,size:e.header.size,directory:e.isDirectory}))})}catch(e){res.status(400).json({ok:false,error:e.message})}});

// alpha.8 safe backup restore workflow
async function createOperationalBackupNamed(prefix="pre-restore") {
  const name=`${prefix}-${new Date().toISOString().replace(/[:.]/g,"-")}.zip`;
  const dest=path.join(BACKUP_DIR,name);
  const dbPath=path.join(HUB_ROOT,"data","classroom-control-hub.db");
  const dbSnapshot=path.join(UPLOAD_DIR,`db-backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.db`);
  let hasDbSnapshot=false;
  try{
    if(fs.existsSync(dbPath)){
      await run("sqlite3",[dbPath,`.backup '${dbSnapshot.replace(/'/g,"''")}'`],{timeout:60000});
      hasDbSnapshot=fs.existsSync(dbSnapshot);
    }
    if(!hasDbSnapshot)throw Error("Operational backup requires a consistent Classroom Control Hub database snapshot");
    const zip=new AdmZip();
    const filter=(full,rel,ent)=>{if(/classroom-hub\.db(?:-wal|-shm)?$/.test(rel))return false;return backupFilter("operational")(full,rel,ent)};
    copyIntoZip(zip,HUB_ROOT,"classroom-hub",filter);
    zip.addLocalFile(dbSnapshot,"classroom-hub/data","classroom-control-hub.db");
    zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify({version:3,scope:"operational",createdAt:new Date().toISOString(),reason:prefix,applicationVersion:applicationVersion(),databaseSnapshot:true},null,2)));
    writeZipAtomic(zip,dest);return {name,dest,size:fs.statSync(dest).size,sha256:sha256File(dest)};
  }finally{fs.rmSync(dbSnapshot,{force:true})}
}
function backupRestorePlan(name){
  const safeName=cleanName(name);if(safeName!==String(name||"")||!safeName.endsWith(".zip"))throw Error("Invalid backup name");
  const p=path.join(BACKUP_DIR,safeName);
  if(!fs.existsSync(p))throw Error("Backup not found");
  const zip=new AdmZip(p),entries=zip.getEntries();
  let expandedBytes=0;
  for(const entry of entries){
    const normalized=entry.entryName.replace(/\\/g,"/");
    if(!normalized||normalized.startsWith("/")||normalized.split("/").includes(".."))throw Error(`Unsafe archive path: ${normalized}`);
    const allowed=normalized==="backup-manifest.json"||normalized.startsWith("classroom-hub/")||normalized.startsWith("services/")||normalized.startsWith("recovery-secrets/");
    if(!allowed)throw Error(`Unexpected restore entry: ${normalized}`);
    const unixType=(Number(entry.header?.attr||0)>>>16)&0xf000;if(unixType===0xa000)throw Error(`Symbolic links are not permitted in restore archives: ${normalized}`);
    expandedBytes+=Number(entry.header?.size||0);if(expandedBytes>RESTORE_MAX_EXPANDED_BYTES)throw Error("Restore archive exceeds the configured expanded-size limit");
  }
  let manifest=null;const me=entries.find(e=>e.entryName==="backup-manifest.json");
  if(me)try{manifest=JSON.parse(me.getData().toString("utf8"))}catch{}
  const names=entries.map(e=>e.entryName.replace(/\\/g,"/"));
  return {name:safeName,path:p,manifest,entries:entries.length,expandedBytes,hasConfig:names.some(n=>n.startsWith("classroom-hub/config/")),hasData:names.some(n=>n.startsWith("classroom-hub/data/")),hasDatabase:names.includes("classroom-hub/data/classroom-control-hub.db"),hasEnv:names.includes("classroom-hub/.env"),hasMasterKey:names.some(n=>/master\.key$/.test(n)),preview:names.slice(0,100)};
}
app.get("/backup/:name/restore-plan",(req,res)=>{try{res.json({ok:true,plan:backupRestorePlan(req.params.name)})}catch(e){res.status(400).json({ok:false,error:e.message})}});
async function verifyRestoreSource(srcRoot,{data=false}={}){
  if(!fs.existsSync(srcRoot))throw Error("Backup does not contain classroom-hub root");
  if(data){
    const dbPath=path.join(srcRoot,"data","classroom-control-hub.db");if(!fs.existsSync(dbPath))throw Error("Data restore requires a consistent SQLite database snapshot");
    const check=String((await run("sqlite3",[dbPath,"PRAGMA quick_check;"],{timeout:60000})).stdout||"").trim();if(check!=="ok")throw Error(`Backup database integrity check failed: ${check||"no result"}`);
  }
}
function replaceRestoreContent(srcRoot,{database=false,data=false}={}){
  const restored=[];
  if(data){
    const src=path.join(srcRoot,"data"),dst=path.join(HUB_ROOT,"data");fs.mkdirSync(dst,{recursive:true});
    for(const ent of fs.readdirSync(dst,{withFileTypes:true})){if(ent.name==="backups")continue;fs.rmSync(path.join(dst,ent.name),{recursive:true,force:true})}
    for(const ent of fs.readdirSync(src,{withFileTypes:true})){if(ent.name==="backups")continue;fs.cpSync(path.join(src,ent.name),path.join(dst,ent.name),{recursive:true})}
    for(const suffix of ["-wal","-shm"])fs.rmSync(path.join(dst,"classroom-control-hub.db"+suffix),{force:true});restored.push("data");
  }else if(database){
    const src=path.join(srcRoot,"data","classroom-control-hub.db"),dst=path.join(HUB_ROOT,"data","classroom-control-hub.db");
    fs.mkdirSync(path.dirname(dst),{recursive:true});for(const suffix of ["","-wal","-shm"])fs.rmSync(dst+suffix,{force:true});fs.cpSync(src,dst);restored.push("database");
  }
  const applyOwnership=p=>{const st=fs.lstatSync(p);if(st.isDirectory())for(const ent of fs.readdirSync(p))applyOwnership(path.join(p,ent));fs.chownSync(p,APP_UID,APP_GID)};
  if(data){for(const ent of fs.readdirSync(path.join(HUB_ROOT,"data"))){if(ent!=="backups")applyOwnership(path.join(HUB_ROOT,"data",ent))}}
  else if(database){applyOwnership(path.join(HUB_ROOT,"data","classroom-control-hub.db"))}
  return restored;
}
async function waitForMainApplication(){
  const deadline=Date.now()+RESTORE_HEALTH_TIMEOUT_MS;let last="not ready";
  while(Date.now()<deadline){try{const status=await mainAppStatus();if(status.ok&&status.database)return status}catch(e){last=e.message}await new Promise(resolve=>setTimeout(resolve,1000))}
  throw Error(`Classroom Control Hub did not become healthy after restore: ${last}`);
}
async function extractRestore(name,target){const plan=backupRestorePlan(name);new AdmZip(plan.path).extractAllTo(target,true);return {plan,srcRoot:path.join(target,"classroom-hub")}}
app.post("/backup/:name/restore",async(req,res)=>{
  let stopped=false,temp=null,safety=null,mutationStarted=false;
  try{
    if(String(req.body?.confirm||"")!=="RESTORE")return res.status(400).json({ok:false,error:"Restore requires confirm=RESTORE"});
    const mode=String(req.body?.mode||"configuration-data");
    if(!["configuration","data","configuration-data"].includes(mode))throw Error("Invalid restore mode");
    const plan=backupRestorePlan(req.params.name);
    safety=await createOperationalBackupNamed("pre-restore");
    temp=path.join(UPLOAD_DIR,`restore-${Date.now()}`);fs.mkdirSync(temp,{recursive:true});const extracted=await extractRestore(plan.name,temp),srcRoot=extracted.srcRoot;
    const doData=mode.includes("data"),doDatabase=mode==="configuration";
    await verifyRestoreSource(srcRoot,{data:doData||doDatabase});
    await run("docker",["stop",APP_CONTAINER],{timeout:30000});stopped=true;mutationStarted=true;
    const restored=replaceRestoreContent(srcRoot,{database:doDatabase,data:doData});
    if(!restored.length)throw Error("Selected restore mode has no matching content in this backup");
    await run("docker",["start",APP_CONTAINER],{timeout:30000});stopped=false;await waitForMainApplication();
    res.json({ok:true,name:plan.name,mode,restored,safetyBackup:safety.name,healthVerified:true,message:"Restore completed and the application passed its database health check."});
  }catch(e){
    let rollback={attempted:false,ok:false};
    if(mutationStarted&&safety){
      rollback.attempted=true;
      try{
        if(!stopped){await run("docker",["stop",APP_CONTAINER],{timeout:30000});stopped=true}
        const rollbackDir=path.join(UPLOAD_DIR,`rollback-${Date.now()}`);fs.mkdirSync(rollbackDir,{recursive:true});
        try{const extracted=await extractRestore(safety.name,rollbackDir);await verifyRestoreSource(extracted.srcRoot,{data:true});replaceRestoreContent(extracted.srcRoot,{data:true})}finally{fs.rmSync(rollbackDir,{recursive:true,force:true})}
        await run("docker",["start",APP_CONTAINER],{timeout:30000});stopped=false;await waitForMainApplication();rollback={attempted:true,ok:true,backup:safety.name};
      }catch(rollbackError){rollback={attempted:true,ok:false,backup:safety.name,error:rollbackError.message}}
    }
    if(stopped)try{await run("docker",["start",APP_CONTAINER],{timeout:30000});stopped=false}catch{}
    res.status(500).json({ok:false,error:e.message,safetyBackup:safety?.name||null,rollback});
  }finally{if(temp)try{fs.rmSync(temp,{recursive:true,force:true})}catch{}}
});
app.delete("/backup/:name",(req,res)=>{try{const name=cleanName(req.params.name),p=path.join(BACKUP_DIR,name);if(!fs.existsSync(p))return res.json({ok:true,missing:true});fs.unlinkSync(p);res.json({ok:true,name})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.get("/audit/status",async(_req,res)=>{try{const status=await mainAppStatus();res.json({ok:true,...status.audit,database:status.database})}catch(e){res.status(e.status||502).json({ok:false,error:e.message})}});
app.post("/audit/prune",async(req,res)=>{try{res.json(await mainAppRequest("POST","/api/v1/internal/maintenance/audit/prune",req.body||{}))}catch(e){res.status(e.status||502).json({ok:false,error:e.message})}});
app.get("/diagnostics/bundle",async(_req,res)=>{try{
  const stamp=new Date().toISOString().replace(/[:.]/g,"-"),name=`classroom-hub-diagnostics-${stamp}.zip`,dest=path.join(BACKUP_DIR,name),zip=new AdmZip();
  let application=null;try{application=await mainAppStatus()}catch(e){application={ok:false,error:e.message}}
  const info={createdAt:new Date().toISOString(),agentVersion:"1.0.0-alpha.69",application,database:application?.database||null,roots:{hub:HUB_ROOT,services:Classroom_ROOT}};
  zip.addFile("summary.json",Buffer.from(JSON.stringify(info,null,2)));
  try{const c=await dockerContainers();zip.addFile("docker/containers.json",Buffer.from(JSON.stringify(c,null,2)));for(const row of c){const n=cleanName(row.Names||row.Name||"");if(!n)continue;try{const r=await run("docker",["logs","--timestamps","--tail","1000",n],{timeout:20000,maxBuffer:16*1024*1024});zip.addFile(`logs/${n}.log`,Buffer.from((r.stdout||"")+(r.stderr||"")))}catch(e){zip.addFile(`logs/${n}.error.txt`,Buffer.from(e.message))}}}catch(e){zip.addFile("docker/error.txt",Buffer.from(e.message))}
  try{const r=await run("docker",["stats","--no-stream","--format","{{json .}}"],{timeout:15000});zip.addFile("docker/stats.jsonl",Buffer.from(r.stdout||""))}catch{}
  try{const r=await run("df",["-h"]);zip.addFile("host/disk.txt",Buffer.from(r.stdout||""))}catch{}
  try{const r=await run("ip",["addr"]);zip.addFile("host/ip-addr.txt",Buffer.from(r.stdout||""))}catch{}
  try{const r=await run("ip",["route"]);zip.addFile("host/routes.txt",Buffer.from(r.stdout||""))}catch{}
  zip.writeZip(dest);res.download(dest,name);
}catch(e){res.status(500).json({ok:false,error:e.message})}});
const MANAGED_INTEGRATIONS_FILE=path.join(HUB_ROOT,"data","managed-integrations.json");
async function readManagedIntegrations({resolved=false}={}){
  const result=await mainAppRequest("GET",`/api/v1/internal/maintenance/integrations${resolved?"?resolved=1":""}`);
  let value=result.integrations||{version:1,modules:{}};
  if(!Object.keys(value.modules||{}).length&&fs.existsSync(MANAGED_INTEGRATIONS_FILE)){
    try{
      const legacy=JSON.parse(fs.readFileSync(MANAGED_INTEGRATIONS_FILE,"utf8"));
      for(const [id,settings] of Object.entries(legacy.modules||{}))await mainAppRequest("PUT",`/api/v1/internal/maintenance/integrations/${encodeURIComponent(id)}`,{settings});
      value=(await mainAppRequest("GET",`/api/v1/internal/maintenance/integrations${resolved?"?resolved=1":""}`)).integrations||value;
      fs.renameSync(MANAGED_INTEGRATIONS_FILE,MANAGED_INTEGRATIONS_FILE+`.migrated-${Date.now()}`);
    }catch{}
  }
  return value;
}
const MODULES={
  mosquitto:{name:"MQTT Broker",container:"mosquitto",image:"eclipse-mosquitto:2.0.22",description:"MQTT broker used by Classroom Control Hub integrations.",expectedProject:"services",ownership:"integration"},
  govee2mqtt:{name:"Govee Lighting",container:"govee2mqtt",image:"ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72",description:"Govee discovery and LAN/cloud control through MQTT.",expectedProject:"services",ownership:"integration"},
  musicassistant:{name:"Music Assistant",container:"music-assistant-server",image:"ghcr.io/music-assistant/server:2.9.13",description:"Classroom audio and media service discovered as an externally managed Compose integration.",expectedProject:"music-assistant",ownership:"integration",externalOnly:true},
  nodered:{name:"Node-RED",container:"nodered",image:"nodered/node-red:4.1.14-22",description:"Optional visual automation environment.",ownership:"optional"}
};
async function containerExists(name){try{await run("docker",["inspect",name],{timeout:5000});return true}catch{return false}}
app.get("/modules",async(_req,res)=>{
  const cfg=await readManagedIntegrations(),out=[];
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
app.get("/modules/:id/config",async(req,res)=>{try{const id=String(req.params.id||""),cfg=(await readManagedIntegrations()).modules?.[id]||{};res.json({ok:true,id,config:cfg})}catch(e){res.status(e.status||502).json({ok:false,error:e.message})}});
app.post("/modules/:id/deploy",async(req,res)=>{const id=String(req.params.id||""),m=MODULES[id];if(!m)return res.status(404).json({ok:false,error:"Unknown integration"});if(m.externalOnly)return res.status(409).json({ok:false,error:"This integration is externally managed and can be monitored/adopted without recreating it."});try{const configured=await mainAppRequest("PUT",`/api/v1/internal/maintenance/integrations/${encodeURIComponent(id)}`,{settings:req.body?.settings||{}}),resolved=configured.resolved||{};const exists=await containerExists(m.container);if(exists&&!req.body?.recreate)return res.json({ok:true,id,adopted:true,message:"Existing container adopted. Use recreate to apply managed settings."});if(exists)await run("docker",["rm","-f",m.container],{timeout:30000});let args=["run","-d","--name",m.container,"--restart","unless-stopped"];
  if(id==="mosquitto"){
    const username=String(resolved.username||"classroom-hub").replace(/[^A-Za-z0-9._-]/g,""),password=String(resolved.password||"");if(!username||password.length<16)throw Error("MQTT broker requires a username and password of at least 16 characters");const base=path.join(Classroom_ROOT,"mosquitto");for(const d of ["config","data","log"])fs.mkdirSync(path.join(base,d),{recursive:true});const salt=crypto.randomBytes(12),hash=crypto.pbkdf2Sync(password,salt,101,64,"sha512"),passwordFile=path.join(base,"config","passwords");fs.writeFileSync(passwordFile,`${username}:$7$101$${salt.toString("base64").replace(/=+$/g,"")}$${hash.toString("base64").replace(/=+$/g,"")}\n`,{mode:0o600});const conf=path.join(base,"config","mosquitto.conf");fs.writeFileSync(conf,"persistence true\npersistence_location /mosquitto/data/\nlog_dest stdout\nlistener 1883\nallow_anonymous false\npassword_file /mosquitto/config/passwords\n",{mode:0o600});args.push("-p",`${resolved.port||1883}:1883`,"-v",`${base}/config:/mosquitto/config`,`-v`,`${base}/data:/mosquitto/data`,`-v`,`${base}/log:/mosquitto/log`);
  } else if(id==="govee2mqtt"){
    args.push("--network","host","-e",`GOVEE_MQTT_HOST=${resolved.mqttHost||"127.0.0.1"}`,"-e",`GOVEE_MQTT_PORT=${resolved.mqttPort||1883}`,"-e",`GOVEE_LAN_BROADCAST_ALL=${resolved.lanBroadcast===false?"false":"true"}`,"-e",`GOVEE_TEMPERATURE_SCALE=${resolved.temperatureScale||"F"}`,"-e",`TZ=${resolved.timezone||process.env.TZ||"UTC"}`);if(resolved.mqttUsername)args.push("-e",`GOVEE_MQTT_USER=${resolved.mqttUsername}`);if(resolved.mqttPassword)args.push("-e",`GOVEE_MQTT_PASSWORD=${resolved.mqttPassword}`);if(resolved.apiKey)args.push("-e",`GOVEE_API_KEY=${resolved.apiKey}`);if(resolved.email)args.push("-e",`GOVEE_EMAIL=${resolved.email}`);if(resolved.password)args.push("-e",`GOVEE_PASSWORD=${resolved.password}`);
  } else if(id==="nodered"){
    const data=path.join(Classroom_ROOT,"nodered");fs.mkdirSync(data,{recursive:true});args.push("-p",`${resolved.port||1880}:1880`,"-v",`${data}:/data`,`-e`,`TZ=${resolved.timezone||process.env.TZ||"UTC"}`);if(resolved.credentialSecret)args.push("-e",`NODE_RED_CREDENTIAL_SECRET=${resolved.credentialSecret}`);
  }
  args.push(m.image);const r=await run("docker",args,{timeout:120000,maxBuffer:16*1024*1024});res.json({ok:true,id,container:m.container,output:r.stdout.trim()})}catch(e){res.status(500).json({ok:false,error:e.message,output:(e.stdout||"")+(e.stderr||"")})}});
app.post("/modules/:id/remove",async(req,res)=>{const id=String(req.params.id||""),m=MODULES[id];if(!m)return res.status(404).json({ok:false,error:"Unknown integration"});if(m.externalOnly)return res.status(409).json({ok:false,error:"Externally managed integrations are not removed from Classroom Control Hub."});try{if(await containerExists(m.container))await run("docker",["rm","-f",m.container],{timeout:30000});res.json({ok:true,id})}catch(e){res.status(500).json({ok:false,error:e.message})}});
const safeCommands={
  "docker-ps":["docker",["ps","-a"]],"docker-stats":["docker",["stats","--no-stream"]],"disk-usage":["df",["-h"]],"memory":["free",["-h"]],"network":["ip",["addr"]],"routes":["ip",["route"]],"dns":["cat",["/etc/resolv.conf"]],"compose-status":["docker",["compose","ps"]]
};
app.post("/command",async(req,res)=>{try{const preset=String(req.body?.preset||"");if(!preset||!safeCommands[preset])return res.status(403).json({ok:false,error:"Only fixed diagnostic presets are supported"});const [cmd,args]=safeCommands[preset],r=await run(cmd,args,{timeout:30000,maxBuffer:16*1024*1024,cwd:preset==="compose-status"?HUB_ROOT:undefined});return res.json({ok:true,preset,output:(r.stdout||"")+(r.stderr||"")})}catch(e){res.status(500).json({ok:false,error:e.message,output:(e.stdout||"")+(e.stderr||"")})}});
const server=app.listen(PORT,"0.0.0.0",()=>console.log(`Classroom Control Hub Maintenance Agent listening on ${PORT}`));
let stopping=false;function stop(signal){if(stopping)return;stopping=true;console.log(`${signal} received; draining maintenance agent`);const force=setTimeout(()=>process.exit(1),10000);force.unref();server.close(()=>{clearTimeout(force);process.exit(0)})}
process.once("SIGTERM",()=>stop("SIGTERM"));process.once("SIGINT",()=>stop("SIGINT"));
