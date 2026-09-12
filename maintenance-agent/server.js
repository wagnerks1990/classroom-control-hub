"use strict";
const express=require("express");
const {rateLimit}=require("express-rate-limit");
const {mainAppUrl, serviceHost, validPort} = require("./network");
const http=require("http");
const fs=require("fs");
const path=require("path");
const os=require("os");
const {execFile}=require("child_process");
const {promisify}=require("util");
const crypto=require("crypto");
const AdmZip=require("adm-zip");
const {diagnosticBackupEntryAllowed,backupContainsSensitiveData,diagnosticSupportDocuments,FULL_RECOVERY_SERVICE_SPECS,FULL_RECOVERY_REQUIRED_MODES,fullRecoveryEntryAllowed,archiveInventory,recoveryTopology,verifyArchiveInventory,parseMasterKey}=require("./backup-policy");
const {encryptRecoveryEnvelope,decryptRecoveryEnvelope}=require("./recovery-envelope");
process.umask(0o077);
const execFileAsync=promisify(execFile);
const app=express();
const PORT=validPort(process.env.PORT,3010);
const BIND_ADDRESS="127.0.0.1"; // Never expose the privileged maintenance API to the LAN.
const TOKEN=String(process.env.MAINTENANCE_TOKEN||"");
const HUB_ROOT=path.resolve(process.env.MANAGED_HUB_ROOT||"/managed/classroom-hub");
const Classroom_ROOT=path.resolve(process.env.MANAGED_SERVICES_ROOT||"/managed/services");
const HOST_AGENT_SOCKET=String(process.env.HOST_AGENT_SOCKET||"/run/classroom-control-hub/host-agent.sock");
const MAIN_APP_URL=mainAppUrl();
const APP_CONTAINER=cleanName(process.env.MANAGED_APP_CONTAINER||"classroom-control-hub");
const RESTORE_HEALTH_TIMEOUT_MS=Math.max(5000,Math.min(300000,Number(process.env.RESTORE_HEALTH_TIMEOUT_MS||60000)));
const RESTORE_MAX_EXPANDED_BYTES=Math.max(64*1024*1024,Number(process.env.RESTORE_MAX_EXPANDED_MB||4096)*1024*1024);
const RESTORE_MAX_ARCHIVE_BYTES=Math.max(64*1024*1024,Number(process.env.RESTORE_MAX_ARCHIVE_MB||4096)*1024*1024);
const RECOVERY_ENVELOPE_MAX_BYTES=Math.max(64*1024*1024,Math.min(512*1024*1024,Number(process.env.RECOVERY_ENVELOPE_MAX_MB||256)*1024*1024,RESTORE_MAX_EXPANDED_BYTES));
const RECOVERY_ENVELOPE_FILE_MAX_BYTES=RECOVERY_ENVELOPE_MAX_BYTES+16*1024;
// This is a deliberately buffered implementation: the operator-selected cap
// is also its expanded and single-entry ceiling, so every self-produced bundle
// remains importable. RECOVERY_ENVELOPE_MAX_BYTES retains the hard 512 MiB cap.
const RECOVERY_BUFFERED_EXPANDED_MAX_BYTES=RECOVERY_ENVELOPE_MAX_BYTES;
const RECOVERY_ENTRY_MAX_BYTES=RECOVERY_ENVELOPE_MAX_BYTES;
const BACKUP_DIR=path.join(HUB_ROOT,"data","backups");
const MASTER_KEY_FILE=String(process.env.MASTER_KEY_FILE||"/run/secrets/classroom-control-hub-master-key");
const SIGNING_ROOT=path.resolve(process.env.ANDROID_AGENT_SIGNING_ROOT||"/signing");
const VEYON_RECOVERY_ROOT=path.resolve(process.env.VEYON_RECOVERY_ROOT||"/veyon-recovery");
const UPLOAD_DIR=path.resolve(process.env.MAINTENANCE_WORK_DIR||"/work/uploads");
const RECOVERY_STAGING_ROOT=path.resolve(process.env.RECOVERY_STAGING_ROOT||"/host-backups/recovery-staging");
fs.mkdirSync(BACKUP_DIR,{recursive:true,mode:0o700});fs.mkdirSync(UPLOAD_DIR,{recursive:true,mode:0o700});
for(const dir of [BACKUP_DIR,UPLOAD_DIR])try{fs.chmodSync(dir,0o700)}catch{}
app.use(express.json({limit:"8mb"}));
function secretEqual(actual,expected){const a=Buffer.from(String(actual||"")),b=Buffer.from(String(expected||""));return a.length===b.length&&crypto.timingSafeEqual(a,b)}
function auth(req,res,next){if(!TOKEN)return res.status(503).json({ok:false,error:"Maintenance token not configured"});if(!secretEqual(req.get("x-maintenance-token"),TOKEN))return res.status(401).json({ok:false,error:"Unauthorized"});next()}
app.use(auth);
// One appliance-wide budget prevents spoofed forwarding headers or local source
// addresses from multiplying privileged writes. Authentication runs first; read
// polling and startup health never consume the mutation budget.
app.use(rateLimit({
  windowMs:60_000,limit:30,standardHeaders:"draft-8",legacyHeaders:false,
  keyGenerator:()=>"maintenance-mutations",
  skip:req=>["GET","HEAD","OPTIONS"].includes(req.method),
  message:{ok:false,error:"Too many maintenance changes. Retry after the indicated delay."}
}));
let recoveryMutationLocked=false,fullExportMutationLocked=false;
app.use(async(req,res,next)=>{
  const releaseRequestedExportLock=()=>{if(req.fullExportMutationLock){fullExportMutationLocked=false;req.fullExportMutationLock=false}};
  if(["GET","HEAD","OPTIONS"].includes(req.method))return next();
  if(req.path==="/recovery/reconcile-services")return next();
  if(fullExportMutationLocked)return res.status(423).json({ok:false,error:"A Full Recovery Export is active; maintenance mutations are locked"});
  if(req.method==="POST"&&req.path==="/backup/create"&&req.body?.scope==="full"){fullExportMutationLocked=true;req.fullExportMutationLock=true}
  if(recoveryMutationLocked){
    try{const current=await hostAgentRequest("GET","/recovery/full/job",null,5000),running=current?.running===true||current?.job?.running===true;if(running){releaseRequestedExportLock();return res.status(423).json({ok:false,error:"A full recovery transaction is active; maintenance mutations are locked"})}recoveryMutationLocked=false}
    catch{releaseRequestedExportLock();return res.status(503).json({ok:false,error:"Recovery status is unavailable while the maintenance mutation lock is active"})}
  }else try{const current=await hostAgentRequest("GET","/recovery/full/job",null,5000);if(current?.running===true||current?.job?.running===true){recoveryMutationLocked=true;releaseRequestedExportLock();return res.status(423).json({ok:false,error:"A full recovery transaction is active; maintenance mutations are locked"})}}catch{if(req.fullExportMutationLock){releaseRequestedExportLock();return res.status(503).json({ok:false,error:"Recovery status is unavailable; Full Recovery Export did not start"})}}
  next();
});
app.use(["/files","/file","/file/upload","/env","/update/stage","/update/deploy"],(_req,res)=>res.status(410).json({ok:false,error:"Direct filesystem, environment-file, and source-ZIP mutation has been removed. Use database-backed settings and verified GitHub releases."}));
function cleanName(v){return String(v||"").replace(/[^A-Za-z0-9._-]/g,"-").slice(0,180)}
function statInfo(p,base){const st=fs.statSync(p);return {name:path.basename(p),path:path.relative(base,p)||".",type:st.isDirectory()?"directory":"file",size:st.size,modifiedAt:st.mtime.toISOString()}}
function sha256File(p){const hash=crypto.createHash("sha256"),fd=fs.openSync(p,"r"),buf=Buffer.allocUnsafe(1024*1024);try{let n=0,pos=0;while((n=fs.readSync(fd,buf,0,buf.length,pos))>0){hash.update(buf.subarray(0,n));pos+=n}return hash.digest("hex")}finally{fs.closeSync(fd)}}
function writeZipAtomic(zip,dest){const partial=`${dest}.partial-${process.pid}-${Date.now()}`;try{zip.writeZip(partial);fs.chmodSync(partial,0o600);fs.renameSync(partial,dest);fs.chmodSync(dest,0o600)}finally{fs.rmSync(partial,{force:true})}}
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
async function componentHealth(){let docker=false,hostAgent=null,application=null;try{await run("docker",["info","--format","{{.ServerVersion}}"],{timeout:5000});docker=true}catch{}try{hostAgent=await hostAgentRequest("GET","/health")}catch(e){hostAgent={ok:false,error:e.message}}try{application=await mainAppStatus()}catch(e){application={ok:false,error:e.message}}return {version:"1.0.0-alpha.81",docker,hostAgent,roots:{hub:fs.existsSync(HUB_ROOT),services:fs.existsSync(Classroom_ROOT)},shellEnabled:false,application,database:application?.database||null}}
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
  "classroom-hub":{owner:"core",recommendation:"keep",purpose:"RoomGoblin application"},
  "classroom-control-hub-maintenance":{owner:"core",recommendation:"keep",purpose:"RoomGoblin privileged maintenance agent"},
  "mosquitto":{owner:"integration",recommendation:"adopt",purpose:"MQTT broker used by RoomGoblin"},
  "govee2mqtt":{owner:"integration",recommendation:"adopt",purpose:"Govee lighting integration"},
  "music-assistant-server":{owner:"integration",recommendation:"integrate",purpose:"Classroom audio/media service"},
  "portainer":{owner:"legacy-admin",recommendation:"optional-remove",purpose:"Docker UI now duplicated by RoomGoblin"},
  "nodered":{owner:"optional",recommendation:"optional-remove",purpose:"Optional external automation engine"}
};
app.get("/appliance/inventory",async(_req,res)=>{
  try{
    const containers=await dockerContainers();
    const items=containers.map(c=>{const name=c.Names||c.Name||"";const policy=APPLIANCE_CONTAINER_POLICY[name]||{owner:"unmanaged",recommendation:"review",purpose:"Not currently owned by RoomGoblin"};return {name,image:c.Image||"",status:c.Status||c.State||"",networks:c.Networks||"",...policy}});
    res.json({ok:true,mode:"dedicated-appliance",policy:"RoomGoblin owns application services and integrations; removal is always explicit",items,summary:{total:items.length,core:items.filter(x=>x.owner==="core").length,integrated:items.filter(x=>x.owner==="integration").length,review:items.filter(x=>["unmanaged","legacy-admin","optional"].includes(x.owner)).length}});
  }catch(e){res.status(500).json({ok:false,error:e.message})}
});


// -----------------------------------------------------------------------------
// Dedicated appliance host-service management (alpha.22)
// Host systemd/journal/package operations are delegated to a native root-owned
// host agent over a local Unix socket. Only its network namespace is shared;
// host PID/mount namespaces and privileged mode are not required.
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
  res.status(202).json({ok:true,safetyBackup:safety.name,...result,message:"Native host update job started. RoomGoblin will continue monitoring it."});
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
    if(composeServices.includes(name))return res.status(409).json({ok:false,error:`${name} is part of the current RoomGoblin Compose project and cannot be removed through cleanup`});
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
  await check("RoomGoblin Root",async()=>{if(!fs.existsSync(HUB_ROOT))throw Error("Missing managed RoomGoblin root");return HUB_ROOT});
  await check("Services Stack Root",async()=>{if(!fs.existsSync(Classroom_ROOT))throw Error("Missing managed services-stack root");return Classroom_ROOT});
  await check("SQLite Database",async()=>{const i=(await mainAppStatus()).database;if(!i?.file)throw Error("Database status unavailable");return {schemaVersion:i.schemaVersion,size:i.size,journalMode:i.journalMode}});
  await check("Disk Capacity",async()=>String((await run("df",["-h","/managed/classroom-hub"])).stdout||"").trim());
  await check("Container Inventory",async()=>({count:(await dockerContainers()).length}));
  const failed=checks.filter(x=>!x.ok).length;res.status(failed?207:200).json({ok:failed===0,generatedAt:new Date().toISOString(),summary:{total:checks.length,passed:checks.length-failed,failed},checks});
});
app.post("/docker/:name/:action",async(req,res)=>{const name=cleanName(req.params.name),action=String(req.params.action||"");if(!["start","stop","restart","kill"].includes(action))return res.status(400).json({ok:false,error:"Unsupported action"});try{const r=await run("docker",[action,name],{timeout:30000});res.json({ok:true,name,action,...r})}catch(e){res.status(500).json({ok:false,error:e.message})}});
app.get("/docker/:name/logs",async(req,res)=>{const name=cleanName(req.params.name),tail=String(Math.max(1,Math.min(5000,Number(req.query.tail||300))));try{const r=await run("docker",["logs","--timestamps","--tail",tail,name],{timeout:20000,maxBuffer:16*1024*1024});const text=(r.stdout||"")+(r.stderr||"");if(String(req.query.download||"")==="1"){res.setHeader("Content-Disposition",`attachment; filename="${name}-${Date.now()}.log"`);res.type("text/plain").send(text)}else res.json({ok:true,name,tail:Number(tail),text})}catch(e){res.status(500).json({ok:false,error:e.message})}});
function copyIntoZip(zip,src,prefix,filter){if(!fs.existsSync(src))return;for(const ent of fs.readdirSync(src,{withFileTypes:true})){const full=path.join(src,ent.name),rel=path.posix.join(prefix,ent.name);if(filter&&!filter(full,rel,ent))continue;if(ent.isSymbolicLink())throw Error(`Symbolic links are not permitted in recovery sources: ${rel}`);if(ent.isDirectory())copyIntoZip(zip,full,rel,filter);else if(ent.isFile())zip.addLocalFile(full,path.posix.dirname(rel),path.basename(rel));else throw Error(`Special files are not permitted in recovery sources: ${rel}`)}}
function recoverySourceBytes(src,prefix,filter){let bytes=0;if(!fs.existsSync(src))return bytes;for(const ent of fs.readdirSync(src,{withFileTypes:true})){const full=path.join(src,ent.name),rel=path.posix.join(prefix,ent.name);if(filter&&!filter(full,rel,ent))continue;if(ent.isSymbolicLink())throw Error(`Symbolic links are not permitted in recovery sources: ${rel}`);if(ent.isDirectory())bytes+=recoverySourceBytes(full,rel,filter);else if(ent.isFile())bytes+=fs.statSync(full).size;else throw Error(`Special files are not permitted in recovery sources: ${rel}`);if(bytes>RECOVERY_ENVELOPE_MAX_BYTES)throw Error("Full Recovery Export exceeds the configured encrypted-envelope limit")}return bytes}
function writePrivateBufferAtomic(buffer,dest){const partial=`${dest}.partial-${process.pid}-${Date.now()}`;try{fs.writeFileSync(partial,buffer,{flag:"wx",mode:0o600});fs.renameSync(partial,dest);fs.chmodSync(dest,0o600)}finally{fs.rmSync(partial,{force:true})}}
async function activeDatabaseSource(){
  const status=await mainAppStatus(),reported=String(status?.database?.file||"").replace(/\\/g,"/");
  if(!reported.startsWith("/app/data/")||reported.slice("/app/data/".length).includes("/")||!reported.endsWith(".db"))throw Error("The application did not report a safe active database path");
  const source=path.join(HUB_ROOT,"data",path.posix.basename(reported));
  if(!fs.existsSync(source)||!fs.statSync(source).isFile())throw Error("The application-reported active RoomGoblin database is unavailable");
  return {source,status,schemaVersion:Number(status.database.schemaVersion)||0};
}
async function managedServicesManifest(){
  const rows=[];
  for(const [id,spec] of Object.entries(FULL_RECOVERY_SERVICE_SPECS)){
    const marker=path.join(Classroom_ROOT,id,".roomgoblin-managed"),marked=fs.existsSync(marker)&&fs.statSync(marker).isFile()&&fs.readFileSync(marker,"utf8")==="roomgoblin-managed-v1\n";
    let inspect=null;try{const result=await run("docker",["inspect",spec.container],{timeout:10000});inspect=JSON.parse(result.stdout)[0]}catch{}
    const labeled=inspect?.Config?.Labels?.["org.roomgoblin.deployment-ownership"]==="roomgoblin";
    if(inspect&&marked&&!labeled)throw Error(`Managed-service ownership collision for ${spec.container}`);
    if(!labeled&&!marked)continue;
    if(labeled&&inspect.Config?.Image!==spec.image)throw Error(`Managed-service ${spec.container} does not use its reviewed pinned image`);
    if(labeled&&!marked){fs.mkdirSync(path.dirname(marker),{recursive:true,mode:0o770});fs.writeFileSync(marker,"roomgoblin-managed-v1\n",{mode:0o660,flag:"wx"})}
    rows.push({id,container:spec.container,image:spec.image,enabled:!!inspect,running:!!inspect&&inspect.State?.Running===true,deploymentOwnership:"roomgoblin"});
  }
  return rows;
}
async function managedContainerRunning(service){const result=await run("docker",["inspect",service.container],{timeout:10000}),inspect=JSON.parse(result.stdout)[0];if(!inspect||inspect.Config?.Image!==service.image||inspect.Config?.Labels?.["org.roomgoblin.deployment-ownership"]!=="roomgoblin")throw Error(`Managed-service identity changed during export: ${service.container}`);return inspect.State?.Running===true}
function requiredIdentityFile(file,label){if(!fs.existsSync(file))return null;const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile()||stat.size<1)throw Error(`${label} must be a non-empty regular file`);return file}
function optionalVeyonPrivateFile(file){
  if(!fs.existsSync(file))return null;
  const stat=fs.lstatSync(file);
  if(stat.isSymbolicLink()||!stat.isFile())throw Error("Veyon private key must be a regular file");
  // The installer creates an empty bind-mount placeholder when native Veyon is
  // not configured. It is deployment plumbing, not a partial identity.
  return stat.size===0?null:file;
}
async function validateRecoveryIdentities({adbRoot,signingRoot,veyonRoot}){
  const adbPrivate=requiredIdentityFile(path.join(adbRoot,"adbkey"),"ADB private key"),adbPublic=requiredIdentityFile(path.join(adbRoot,"adbkey.pub"),"ADB public key");
  if(!!adbPrivate!==!!adbPublic)throw Error("Recovery contains an incomplete ADB trust identity");
  if(adbPrivate){
    const derived=String((await run("adb",["pubkey",adbPrivate],{timeout:15000,maxBuffer:1024*1024})).stdout||"").trim().split(/\s+/)[0],stored=fs.readFileSync(adbPublic,"utf8").trim().split(/\s+/)[0];
    if(!derived||!stored||!secretEqual(derived,stored))throw Error("ADB private/public trust identity does not match");
  }
  const keystore=requiredIdentityFile(path.join(signingRoot,"android-agent","RoomGoblin-Display-Agent.keystore"),"Android signing keystore"),passwordFile=requiredIdentityFile(path.join(signingRoot,"android-agent","password"),"Android signing password");
  if(!!keystore!==!!passwordFile)throw Error("Recovery contains an incomplete Android signing identity");
  if(keystore){const password=fs.readFileSync(passwordFile,"utf8").trim();if(password.length<32)throw Error("Android signing password is invalid");await run("keytool",["-list","-keystore",keystore,"-storepass:env","ROOMGOBLIN_RECOVERY_KEYSTORE_PASSWORD"],{timeout:30000,maxBuffer:1024*1024,env:{ROOMGOBLIN_RECOVERY_KEYSTORE_PASSWORD:password}})}
  const veyonPrivate=optionalVeyonPrivateFile(path.join(veyonRoot,"private.pem")),veyonNameFile=requiredIdentityFile(path.join(veyonRoot,"key-name"),"Veyon key name");
  if(!!veyonPrivate!==!!veyonNameFile)throw Error("Recovery contains an incomplete Veyon identity");
  if(veyonPrivate){try{crypto.createPrivateKey(fs.readFileSync(veyonPrivate))}catch{throw Error("Veyon private key is not a valid private-key encoding")}const keyName=fs.readFileSync(veyonNameFile,"utf8").trim();if(!/^[A-Za-z0-9._-]{1,64}$/.test(keyName))throw Error("Veyon key name is outside the safe recovery policy")}
}
function stableSnapshotFile(source,destination,label,{allowEmpty=false,maxBytes=64*1024*1024}={}){
  const before=fs.lstatSync(source);
  if(before.isSymbolicLink()||!before.isFile()||(!allowEmpty&&before.size<1)||before.size>maxBytes)throw Error(`${label} is outside the safe snapshot policy`);
  const contents=fs.readFileSync(source),after=fs.lstatSync(source);
  if(after.isSymbolicLink()||!after.isFile()||before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||contents.length!==after.size)throw Error(`${label} changed while the recovery snapshot was being created`);
  fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});fs.writeFileSync(destination,contents,{mode:0o600});
  return contents;
}
function verifyStableSnapshotFile(source,snapshot,label){
  const current=fs.readFileSync(source),captured=fs.readFileSync(snapshot);
  if(current.length!==captured.length||!crypto.timingSafeEqual(current,captured))throw Error(`${label} changed while the recovery identity set was being created`);
}
function backupFilter(scope){
  const skipDirs=new Set(["node_modules",".git","convert-tmp","presentation-upload-tmp"]);
  return (_full,rel,ent)=>{
    const normalized=String(rel||"").replace(/\\/g,"/");
    if(scope==="full")return fullRecoveryEntryAllowed(normalized,ent.isDirectory());
    if(scope==="diagnostic"){
      // A diagnostic archive is safe to attach to a support case. Include only
      // non-runtime package/deployment metadata; never descend into data,
      // managed services, device inventory, ADB identity, or student records.
      return diagnosticBackupEntryAllowed(normalized,ent.isDirectory());
    }
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
    if(normalized.endsWith("/.env")||normalized==="classroom-hub/.env")return scope==="full";
    return true;
  }
}
async function createFullRecoveryExport(req,res){
  let dbSnapshot="",dest="",identitySnapshotRoot="",mainFreezeToken="",hostFreezeToken="",quiesced=[];const priority={mosquitto:1,"music-assistant":2,nodered:3,govee2mqtt:4};
  if(!req.fullExportMutationLock){if(fullExportMutationLocked)return res.status(423).json({ok:false,error:"A Full Recovery Export is already active"});fullExportMutationLocked=true}
  try{
    if(req.body?.confirmSensitiveData!==true||req.body?.confirmSecrets!==true)return res.status(400).json({ok:false,error:"Full Recovery Export requires both sensitive-data and protected-secret confirmation."});
    const passphrase=String(req.body?.passphrase||"");
    const hostFreeze=await hostAgentRequest("POST","/recovery/export/freeze",{confirm:"FREEZE_FULL_EXPORT"},10000);hostFreezeToken=String(hostFreeze.freezeToken||"");
    if(!hostFreezeToken)throw Error("Host Agent did not provide a Full Recovery Export freeze token");
    const mainFreeze=await mainAppRequest("POST","/api/v1/internal/maintenance/export-freeze",{confirm:"FREEZE_FULL_EXPORT"},45000);mainFreezeToken=String(mainFreeze.freezeToken||"");
    if(!mainFreezeToken)throw Error("Main application did not provide a Full Recovery Export freeze token");
    const active=await activeDatabaseSource();
    if(!fs.existsSync(MASTER_KEY_FILE)||!fs.statSync(MASTER_KEY_FILE).isFile())throw Error("Full Recovery Export requires the matching master encryption key");
    const adbPrivate=path.join(HUB_ROOT,"data","android-tv",".android","adbkey"),adbPublic=`${adbPrivate}.pub`;
    if(fs.existsSync(adbPrivate)!==fs.existsSync(adbPublic))throw Error("Full Recovery Export found an incomplete ADB trust identity");
    const devicesFile=path.join(HUB_ROOT,"data","android-tv","devices.json");
    if(fs.existsSync(devicesFile)){
      let devices;try{devices=JSON.parse(fs.readFileSync(devicesFile,"utf8"))}catch{throw Error("Managed Android inventory is not valid JSON")}
      if(Array.isArray(devices?.devices)&&devices.devices.length>0&&!fs.existsSync(adbPrivate))throw Error("Managed Android inventory exists without the ADB trust pair required for no-re-pair recovery");
    }
    const signingKeystore=path.join(SIGNING_ROOT,"android-agent","RoomGoblin-Display-Agent.keystore"),signingPassword=path.join(SIGNING_ROOT,"android-agent","password");
    if(fs.existsSync(signingKeystore)!==fs.existsSync(signingPassword))throw Error("Full Recovery Export found an incomplete Android signing identity");
    const veyonPrivate=optionalVeyonPrivateFile(path.join(VEYON_RECOVERY_ROOT,"private.pem")),veyonName=requiredIdentityFile(path.join(VEYON_RECOVERY_ROOT,"key-name"),"Veyon key name");
    if(!!veyonPrivate!==!!veyonName)throw Error("Full Recovery Export found an incomplete Veyon identity");
    identitySnapshotRoot=fs.mkdtempSync(path.join(UPLOAD_DIR,"full-export-identities-"));
    const snapshotMaster=path.join(identitySnapshotRoot,"master.key"),snapshotAdb=path.join(identitySnapshotRoot,"adb"),snapshotSigning=path.join(identitySnapshotRoot,"signing"),snapshotVeyon=path.join(identitySnapshotRoot,"veyon");
    stableSnapshotFile(MASTER_KEY_FILE,snapshotMaster,"RoomGoblin master key",{maxBytes:4096});
    const snapshots=[];
    if(fs.existsSync(adbPrivate)){snapshots.push([adbPrivate,path.join(snapshotAdb,"adbkey"),"ADB private key"],[adbPublic,path.join(snapshotAdb,"adbkey.pub"),"ADB public key"])}
    if(fs.existsSync(signingKeystore)){snapshots.push([signingKeystore,path.join(snapshotSigning,"android-agent","RoomGoblin-Display-Agent.keystore"),"Android signing keystore"],[signingPassword,path.join(snapshotSigning,"android-agent","password"),"Android signing password"])}
    if(veyonPrivate){snapshots.push([veyonPrivate,path.join(snapshotVeyon,"private.pem"),"Veyon private key"],[veyonName,path.join(snapshotVeyon,"key-name"),"Veyon key name"])}
    for(const [source,snapshot,label] of snapshots)stableSnapshotFile(source,snapshot,label);
    for(const [source,snapshot,label] of snapshots)verifyStableSnapshotFile(source,snapshot,label);
    await validateRecoveryIdentities({adbRoot:snapshotAdb,signingRoot:snapshotSigning,veyonRoot:snapshotVeyon});
    dbSnapshot=path.join(UPLOAD_DIR,`db-backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.db`);
    await run("sqlite3",[active.source,`.backup '${dbSnapshot.replace(/'/g,"''")}'`],{timeout:60000});
    if(!fs.existsSync(dbSnapshot))throw Error("Full Recovery Export requires a consistent RoomGoblin database snapshot");
    const check=String((await run("sqlite3",[dbSnapshot,"PRAGMA quick_check;"],{timeout:60000})).stdout||"").trim();
    if(check!=="ok")throw Error(`Full Recovery Export database integrity check failed: ${check||"no result"}`);
    const managedServices=await managedServicesManifest(),ownedServices=new Set(managedServices.map(service=>service.id));
    quiesced=managedServices.filter(item=>item.running).sort((a,b)=>(priority[b.id]||0)-(priority[a.id]||0));
    for(const service of quiesced){await run("docker",["stop",service.container],{timeout:30000});if(await managedContainerRunning(service))throw Error(`Managed service did not stop for a consistent export: ${service.container}`)}
    const activeName=path.basename(active.source),zip=new AdmZip(),filter=(full,rel,ent)=>{if([activeName,`${activeName}-wal`,`${activeName}-shm`,"classroom-control-hub.db","classroom-control-hub.db-wal","classroom-control-hub.db-shm"].includes(path.posix.basename(rel))&&path.posix.dirname(rel)==="classroom-hub/data")return false;if(["classroom-hub/data/android-tv/.android/adbkey","classroom-hub/data/android-tv/.android/adbkey.pub"].includes(rel))return false;if(rel.startsWith("services/")){const id=rel.split("/")[1];if(!ownedServices.has(id))return false}return backupFilter("full")(full,rel,ent)};
    let sourceBytes=fs.statSync(dbSnapshot).size+fs.statSync(snapshotMaster).size;
    sourceBytes+=recoverySourceBytes(path.join(HUB_ROOT,"data"),"classroom-hub/data",filter)+recoverySourceBytes(Classroom_ROOT,"services",filter);
    for(const [,snapshot] of snapshots)sourceBytes+=fs.statSync(snapshot).size;
    if(sourceBytes+1024*1024>RECOVERY_ENVELOPE_MAX_BYTES)throw Error("Full Recovery Export exceeds the configured encrypted-envelope limit");
    copyIntoZip(zip,path.join(HUB_ROOT,"data"),"classroom-hub/data",filter);
    zip.addLocalFile(dbSnapshot,"classroom-hub/data","classroom-control-hub.db");
    copyIntoZip(zip,Classroom_ROOT,"services",filter);
    zip.addFile("recovery-secrets/classroom-hub-master.key",parseMasterKey(fs.readFileSync(snapshotMaster)),"",0o600);
    if(fs.existsSync(path.join(snapshotAdb,"adbkey"))){zip.addLocalFile(path.join(snapshotAdb,"adbkey"),"classroom-hub/data/android-tv/.android","adbkey");zip.addLocalFile(path.join(snapshotAdb,"adbkey.pub"),"classroom-hub/data/android-tv/.android","adbkey.pub")}
    if(fs.existsSync(path.join(snapshotSigning,"android-agent","RoomGoblin-Display-Agent.keystore")))copyIntoZip(zip,snapshotSigning,"recovery-secrets/android-agent-signing",filter);
    if(veyonPrivate){
      zip.addLocalFile(path.join(snapshotVeyon,"private.pem"),"recovery-secrets/veyon","private.pem");
      zip.addLocalFile(path.join(snapshotVeyon,"key-name"),"recovery-secrets/veyon","key-name");
    }
    const files=archiveInventory(zip.getEntries()),createdAt=new Date().toISOString();
    const manifest={version:6,scope:"full",confidentiality:"scrypt-aes-256-gcm",integrityAlgorithm:"sha256",applicationVersion:applicationVersion(),databaseSchemaVersion:active.schemaVersion,files,topology:recoveryTopology(files),managedServices};
    zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify(manifest,null,2)));
    const plaintext=zip.toBuffer();
    const encrypted=encryptRecoveryEnvelope(plaintext,passphrase,{metadata:{format:"roomgoblin-full-recovery",manifestVersion:6,createdAt},maxPayloadBytes:RECOVERY_ENVELOPE_MAX_BYTES});
    const stamp=createdAt.replace(/[:.]/g,"-"),name=`roomgoblin-full-recovery-${stamp}.rgbak`;dest=path.join(BACKUP_DIR,name);
    writePrivateBufferAtomic(encrypted,dest);
    for(const service of [...quiesced].sort((a,b)=>(priority[a.id]||0)-(priority[b.id]||0))){await run("docker",["start",service.container],{timeout:30000});if(!await managedContainerRunning(service))throw Error(`Managed service did not return to its prior running state: ${service.container}`)}quiesced=[];
    if(dbSnapshot){fs.rmSync(dbSnapshot,{force:true});dbSnapshot=""}if(identitySnapshotRoot){fs.rmSync(identitySnapshotRoot,{recursive:true,force:true});identitySnapshotRoot=""}
    await mainAppRequest("POST","/api/v1/internal/maintenance/export-thaw",{freezeToken:mainFreezeToken},30000);mainFreezeToken="";
    await hostAgentRequest("POST","/recovery/export/thaw",{freezeToken:hostFreezeToken},10000);hostFreezeToken="";
    fullExportMutationLocked=false;
    res.json({ok:true,name,size:encrypted.length,sha256:sha256File(dest),download:`/backup/${encodeURIComponent(name)}`,containsSecrets:true,containsSensitiveData:true,encrypted:true,authenticated:true});
  }catch(e){
    if(dest)fs.rmSync(dest,{force:true});
    for(const service of [...quiesced].sort((a,b)=>(priority[a.id]||0)-(priority[b.id]||0)))try{await run("docker",["start",service.container],{timeout:30000})}catch{}quiesced=[];
    if(mainFreezeToken)try{await mainAppRequest("POST","/api/v1/internal/maintenance/export-thaw",{freezeToken:mainFreezeToken},30000);mainFreezeToken=""}catch{}
    if(hostFreezeToken)try{await hostAgentRequest("POST","/recovery/export/thaw",{freezeToken:hostFreezeToken},10000);hostFreezeToken=""}catch{}
    if(dbSnapshot){fs.rmSync(dbSnapshot,{force:true});dbSnapshot=""}if(identitySnapshotRoot){fs.rmSync(identitySnapshotRoot,{recursive:true,force:true});identitySnapshotRoot=""}
    if(!res.headersSent)res.status(400).json({ok:false,error:e.message});
  }finally{for(const service of [...quiesced].sort((a,b)=>(priority[a.id]||0)-(priority[b.id]||0)))try{await run("docker",["start",service.container],{timeout:30000})}catch{}if(mainFreezeToken)try{await mainAppRequest("POST","/api/v1/internal/maintenance/export-thaw",{freezeToken:mainFreezeToken},30000);mainFreezeToken=""}catch{}if(hostFreezeToken)try{await hostAgentRequest("POST","/recovery/export/thaw",{freezeToken:hostFreezeToken},10000);hostFreezeToken=""}catch{}if(dbSnapshot)fs.rmSync(dbSnapshot,{force:true});if(identitySnapshotRoot)fs.rmSync(identitySnapshotRoot,{recursive:true,force:true});fullExportMutationLocked=false}
}
app.post("/backup/create",async(req,res)=>{let dbSnapshot="";try{
  const scope=["configuration","quick","operational","diagnostic","full"].includes(req.body?.scope)?req.body.scope:"operational";
  if(scope==="full")return await createFullRecoveryExport(req,res);
  const containsSensitiveData=backupContainsSensitiveData(scope);
  if(containsSensitiveData&&req.body?.confirmSensitiveData!==true)return res.status(400).json({ok:false,error:"This recovery backup contains private appliance data. Resubmit with confirmSensitiveData=true."});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-"),name=`classroom-hub-${scope}-${stamp}.zip`,dest=path.join(BACKUP_DIR,name),zip=new AdmZip();
  const dbPath=path.join(HUB_ROOT,"data","classroom-control-hub.db");dbSnapshot=path.join(UPLOAD_DIR,`db-backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.db`);
  let hasDbSnapshot=false;if(!["quick","diagnostic"].includes(scope)&&fs.existsSync(dbPath)){await run("sqlite3",[dbPath,`.backup '${dbSnapshot.replace(/'/g,"''")}'`],{timeout:60000});hasDbSnapshot=fs.existsSync(dbSnapshot)}
  const baseFilter=backupFilter(scope),filter=(full,rel,ent)=>{if(/classroom-hub\.db(?:-wal|-shm)?$/.test(rel))return false;return baseFilter(full,rel,ent)};
  if(scope==="diagnostic"){
    let application=null;try{application=await mainAppStatus()}catch{application={ok:false}}
    let containers=[];try{containers=await dockerContainers()}catch{}
    const documents=diagnosticSupportDocuments({createdAt:new Date().toISOString(),agentVersion:"1.0.0-alpha.81",application,containers,system:{platform:os.platform(),architecture:os.arch(),cpuCount:os.cpus().length,memoryBytes:os.totalmem()}});
    zip.addFile("summary.json",Buffer.from(JSON.stringify(documents.summary,null,2)));
    zip.addFile("docker/containers.json",Buffer.from(JSON.stringify(documents.containers,null,2)));
  }else copyIntoZip(zip,HUB_ROOT,"classroom-hub",filter);
  if(hasDbSnapshot)zip.addLocalFile(dbSnapshot,"classroom-hub/data","classroom-control-hub.db");
  if(scope==="operational")copyIntoZip(zip,Classroom_ROOT,"services",filter);
  const hasServiceState=zip.getEntries().some(entry=>!entry.isDirectory&&entry.entryName.startsWith("services/"));
  const capabilities={configuration:["configuration","operational","full"].includes(scope),database:hasDbSnapshot,data:["operational","full"].includes(scope)&&hasDbSnapshot,services:hasServiceState,secrets:scope==="full"};
  const manifest=scope==="diagnostic"
    ?{version:4,createdAt:new Date().toISOString(),scope,applicationVersion:applicationVersion(),databaseSnapshot:false,containsSecrets:false,containsSensitiveData:false,requiresMasterKey:false,capabilities}
    :{version:4,createdAt:new Date().toISOString(),scope,applicationVersion:applicationVersion(),databaseSnapshot:hasDbSnapshot,containsSecrets:false,containsSensitiveData,requiresMasterKey:hasDbSnapshot,capabilities};
  zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify(manifest,null,2)));writeZipAtomic(zip,dest);
  res.json({ok:true,name,size:fs.statSync(dest).size,sha256:sha256File(dest),download:`/backup/${encodeURIComponent(name)}`,containsSecrets:scope==="full",containsSensitiveData})
}catch(e){res.status(500).json({ok:false,error:e.message})}finally{if(dbSnapshot)try{fs.rmSync(dbSnapshot,{force:true})}catch{}}});
app.get("/backups",(_req,res)=>{const items=fs.readdirSync(BACKUP_DIR).filter(x=>/\.(?:zip|rgbak)$/.test(x)).map(n=>{const info=statInfo(path.join(BACKUP_DIR,n),BACKUP_DIR);if(n.endsWith(".rgbak"))return {...info,encrypted:true,authenticated:true,containsSensitiveData:true,capabilities:{configuration:true,database:true,data:true,services:true,secrets:true},restoreModes:["full-recovery"]};try{const plan=backupRestorePlan(n);return {...info,containsSensitiveData:plan.containsSensitiveData,capabilities:plan.capabilities,restoreModes:plan.restoreModes}}catch(e){return {...info,restorable:false,error:e.message,capabilities:{}}}}).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));res.json({ok:true,items})});
app.get("/backups/catalog",(_req,res)=>{try{
  const managed=fs.readdirSync(BACKUP_DIR).filter(x=>/\.(?:zip|rgbak)$/.test(x)).map(n=>{const info=statInfo(path.join(BACKUP_DIR,n),BACKUP_DIR);if(n.endsWith(".rgbak"))return {...info,source:"managed",restorable:true,encrypted:true,authenticated:true,containsSensitiveData:true,capabilities:{configuration:true,database:true,data:true,services:true,secrets:true},restoreModes:["full-recovery"]};try{const plan=backupRestorePlan(n);return {...info,source:"managed",restorable:plan.restoreModes.length>0,containsSensitiveData:plan.containsSensitiveData,capabilities:plan.capabilities,restoreModes:plan.restoreModes}}catch(e){return {...info,source:"managed",restorable:false,error:e.message,capabilities:{},restoreModes:[]}}});
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
app.get("/backup/:name/inspect",(req,res)=>{try{const name=cleanName(req.params.name),p=path.join(BACKUP_DIR,name);if(!fs.existsSync(p))return res.status(404).json({ok:false,error:"Backup not found"});if(name.endsWith(".rgbak"))return res.status(405).json({ok:false,error:"Encrypted recovery inspection requires the authenticated restore-plan workflow"});const zip=new AdmZip(p),entries=zip.getEntries();let manifest=null;const m=entries.find(e=>e.entryName==="backup-manifest.json");if(m)try{manifest=JSON.parse(m.getData().toString("utf8"))}catch{}res.json({ok:true,name,size:fs.statSync(p).size,manifest,entries:entries.length,preview:entries.slice(0,100).map(e=>({name:e.entryName,size:e.header.size,directory:e.isDirectory}))})}catch(e){res.status(400).json({ok:false,error:e.message})}});

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
    if(!hasDbSnapshot)throw Error("Operational backup requires a consistent RoomGoblin database snapshot");
    const zip=new AdmZip();
    const filter=(full,rel,ent)=>{if(/classroom-hub\.db(?:-wal|-shm)?$/.test(rel))return false;return backupFilter("operational")(full,rel,ent)};
    copyIntoZip(zip,HUB_ROOT,"classroom-hub",filter);
    zip.addLocalFile(dbSnapshot,"classroom-hub/data","classroom-control-hub.db");
    zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify({version:4,scope:"operational",createdAt:new Date().toISOString(),reason:prefix,applicationVersion:applicationVersion(),databaseSnapshot:true,containsSecrets:false,containsSensitiveData:true,requiresMasterKey:true,capabilities:{configuration:true,database:true,data:true,services:false,secrets:false}},null,2)));
    writeZipAtomic(zip,dest);return {name,dest,size:fs.statSync(dest).size,sha256:sha256File(dest)};
  }finally{fs.rmSync(dbSnapshot,{force:true})}
}
function backupRestorePlan(name,passphrase=""){
  const safeName=cleanName(name);if(safeName!==String(name||"")||!(/\.(?:zip|rgbak)$/.test(safeName)))throw Error("Invalid backup name");
  const p=path.join(BACKUP_DIR,safeName);
  if(!fs.existsSync(p))throw Error("Backup not found");
  const encrypted=safeName.endsWith(".rgbak");
  if(encrypted&&fs.statSync(p).size>RECOVERY_ENVELOPE_FILE_MAX_BYTES)throw Error("Encrypted recovery bundle exceeds the configured envelope limit");
  const envelope=encrypted?decryptRecoveryEnvelope(fs.readFileSync(p),String(passphrase||""),{maxPayloadBytes:RECOVERY_ENVELOPE_MAX_BYTES}):null;
  const zip=encrypted?new AdmZip(envelope.plaintext):new AdmZip(p),entries=zip.getEntries();
  if(entries.length>100000)throw Error("Restore archive contains too many entries");
  let expandedBytes=0;const seenEntries=new Set(),foldedEntries=new Set();
  for(const entry of entries){
    const normalized=entry.entryName.replace(/\\/g,"/");
    const canonical=normalized===entry.entryName&&!normalized.startsWith("/")&&!normalized.endsWith("/")&&!normalized.includes("//")&&normalized.split("/").every(part=>part&&part!=="."&&part!=="..");
    if(!canonical)throw Error(`Unsafe or non-canonical archive path: ${entry.entryName}`);
    const folded=normalized.toLowerCase();if(seenEntries.has(normalized)||foldedEntries.has(folded))throw Error(`Restore archive contains a duplicate or case-colliding entry: ${normalized}`);seenEntries.add(normalized);foldedEntries.add(folded);
    const allowed=normalized==="backup-manifest.json"||normalized.startsWith("classroom-hub/")||normalized.startsWith("services/")||normalized.startsWith("recovery-secrets/");
    if(!allowed)throw Error(`Unexpected restore entry: ${normalized}`);
    const unixType=(Number(entry.header?.attr||0)>>>16)&0xf000;if(unixType&&!((entry.isDirectory&&unixType===0x4000)||(!entry.isDirectory&&unixType===0x8000)))throw Error(`Special files are not permitted in restore archives: ${normalized}`);
    const entryBytes=Number(entry.header?.size||0);if(!Number.isSafeInteger(entryBytes)||entryBytes<0||entryBytes>RECOVERY_ENTRY_MAX_BYTES)throw Error("Restore archive entry exceeds the buffered recovery limit");expandedBytes+=entryBytes;if(expandedBytes>(encrypted?RECOVERY_BUFFERED_EXPANDED_MAX_BYTES:RESTORE_MAX_EXPANDED_BYTES))throw Error("Restore archive exceeds the configured expanded-size limit");
  }
  let manifest=null;const me=entries.find(e=>e.entryName==="backup-manifest.json");
  if(me)try{manifest=JSON.parse(me.getData().toString("utf8"))}catch{}
  const integrityVerified=manifest?.scope==="full"?(verifyArchiveInventory(entries,manifest),true):false;
  const names=entries.map(e=>e.entryName.replace(/\\/g,"/"));
  const hasConfig=names.some(n=>n.startsWith("classroom-hub/config/")),hasData=names.some(n=>n.startsWith("classroom-hub/data/")),hasDatabase=names.includes("classroom-hub/data/classroom-control-hub.db"),hasEnv=names.includes("classroom-hub/.env"),hasMasterKey=names.includes("recovery-secrets/classroom-hub-master.key"),hasServices=names.some(n=>n.startsWith("services/"));
  const capabilities={configuration:!!(manifest?.capabilities?.configuration??(hasConfig||hasDatabase))&&hasDatabase,database:!!(manifest?.capabilities?.database??hasDatabase)&&hasDatabase,data:!!(manifest?.capabilities?.data??hasData)&&hasData&&hasDatabase,services:!!(manifest?.capabilities?.services??hasServices)&&hasServices,secrets:!!(manifest?.capabilities?.secrets??(hasEnv&&hasMasterKey))&&hasMasterKey};
  const containsSensitiveData=manifest?.containsSensitiveData===true||backupContainsSensitiveData(manifest?.scope);
  const fullRecoveryRestorable=encrypted&&manifest?.version===6&&integrityVerified&&hasDatabase&&hasMasterKey;
  return {name:safeName,path:p,manifest,manifestSha256:me?crypto.createHash("sha256").update(me.getData()).digest("hex"):null,entries:entries.length,expandedBytes,hasConfig,hasData,hasDatabase,hasEnv,hasMasterKey,integrityVerified,encrypted,authenticated:encrypted,containsSensitiveData,capabilities,fullRecoveryRestorable,restoreModes:fullRecoveryRestorable?["full-recovery"]:[...(capabilities.database?["configuration"]:[]),...(capabilities.data&&capabilities.database?["data","configuration-data"]:[])],preview:names.slice(0,100),_plaintext:encrypted?envelope.plaintext:null};
}
function assertFullArchiveKeyCompatible(plan){
  if(plan.manifest?.scope!=="full")return;
  if(!fs.existsSync(MASTER_KEY_FILE))throw Error("This Full Recovery Export cannot be partially restored without an installed master key");
  const zip=new AdmZip(plan.path),entry=zip.getEntry("recovery-secrets/classroom-hub-master.key");
  if(!entry)throw Error("Full Recovery Export is missing its master key");
  const archived=parseMasterKey(entry.getData()),installed=parseMasterKey(fs.readFileSync(MASTER_KEY_FILE));
  if(!crypto.timingSafeEqual(archived,installed))throw Error("This Full Recovery Export uses a different master key; partial database/data restore is blocked until atomic full recovery is available");
}
function publicRestorePlan(plan){const {_plaintext,...safe}=plan;delete safe.path;return safe}
async function assertFullRecoveryCompatible(plan){
  if(!plan.fullRecoveryRestorable)throw Error("Backup is not an authenticated version 6 Full Recovery Export");
  const current=await mainAppStatus(),supported=Number(current?.database?.schemaVersion)||0,archived=Number(plan.manifest?.databaseSchemaVersion)||0;
  if(archived>supported)throw Error(`Recovery database schema ${archived} is newer than this RoomGoblin release supports (${supported})`);
  const currentMajor=Number(String(applicationVersion()||"").match(/^(\d+)/)?.[1]),archiveMajor=Number(String(plan.manifest?.applicationVersion||"").match(/^(\d+)/)?.[1]);
  if(!currentMajor||!archiveMajor||currentMajor!==archiveMajor)throw Error("Recovery bundle requires a compatible RoomGoblin major release");
}
app.get("/backup/:name/restore-plan",(req,res)=>{try{if(String(req.params.name).endsWith(".rgbak"))return res.status(405).json({ok:false,error:"Encrypted recovery planning requires POST with a passphrase"});res.json({ok:true,plan:publicRestorePlan(backupRestorePlan(req.params.name))})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post("/backup/:name/restore-plan",async(req,res)=>{try{const plan=backupRestorePlan(req.params.name,req.body?.passphrase);await assertFullRecoveryCompatible(plan);res.json({ok:true,plan:publicRestorePlan(plan)})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post("/backup/import",(req,res)=>{
  const requested=String(req.get("x-backup-name")||""),name=cleanName(requested);
  if(!name||name!==requested||!name.endsWith(".rgbak"))return res.status(400).json({ok:false,error:"A safe .rgbak name is required in x-backup-name"});
  const declared=Number(req.get("content-length")||0);if(!Number.isFinite(declared)||declared<=0||declared>RECOVERY_ENVELOPE_FILE_MAX_BYTES)return res.status(413).json({ok:false,error:"Recovery archive size is missing or exceeds the configured encrypted-envelope limit"});
  const dest=path.join(BACKUP_DIR,name),partial=`${dest}.import-${process.pid}-${Date.now()}`;if(fs.existsSync(dest))return res.status(409).json({ok:false,error:"A backup with this name already exists"});
  let bytes=0,done=false;const stream=fs.createWriteStream(partial,{flags:"wx",mode:0o600});
  const fail=(status,error)=>{if(done)return;done=true;stream.destroy();fs.rmSync(partial,{force:true});if(!res.headersSent)res.status(status).json({ok:false,error})};
  req.on("data",chunk=>{bytes+=chunk.length;if(bytes>RECOVERY_ENVELOPE_FILE_MAX_BYTES)fail(413,"Recovery archive exceeds the configured encrypted-envelope limit")});req.on("aborted",()=>fail(400,"Recovery archive upload was interrupted"));req.on("error",e=>fail(400,e.message));stream.on("error",e=>fail(500,e.message));
  stream.on("finish",async()=>{if(done)return;try{if(bytes!==declared)throw Error("Recovery archive upload length does not match content-length");fs.renameSync(partial,dest);fs.chmodSync(dest,0o600);const plan=backupRestorePlan(name,req.get("x-recovery-passphrase"));await assertFullRecoveryCompatible(plan);done=true;res.status(201).json({ok:true,name,size:bytes,sha256:sha256File(dest),plan:publicRestorePlan(plan)})}catch(e){fs.rmSync(partial,{force:true});fs.rmSync(dest,{force:true});done=true;res.status(400).json({ok:false,error:e.message})}});req.pipe(stream);
});
async function verifyRestoreSource(srcRoot,{data=false}={}){
  if(!fs.existsSync(srcRoot))throw Error("Backup does not contain classroom-hub root");
  if(data){
    const dbPath=path.join(srcRoot,"data","classroom-control-hub.db");if(!fs.existsSync(dbPath))throw Error("Data restore requires a consistent SQLite database snapshot");
    const check=String((await run("sqlite3",[dbPath,"PRAGMA quick_check;"],{timeout:60000})).stdout||"").trim();if(check!=="ok")throw Error(`Backup database integrity check failed: ${check||"no result"}`);
  }
}
async function replaceRestoreContent(srcRoot,{database=false,data=false,journalFile=path.join(UPLOAD_DIR,"restore-journal.json")}={}){
  const restored=[];
  const journal=phase=>{const partial=`${journalFile}.partial`;fs.writeFileSync(partial,JSON.stringify({version:1,phase,at:new Date().toISOString(),database,data}),{mode:0o600});fs.renameSync(partial,journalFile)};
  const removeTarget=p=>{const st=fs.lstatSync(p);if(st.isSymbolicLink())throw Error(`Symbolic links are not permitted in recovery targets: ${p}`);if(!st.isDirectory()){fs.rmSync(p,{force:true});return}for(const name of fs.readdirSync(p))removeTarget(path.join(p,name));try{fs.rmdirSync(p)}catch(e){if(!["EBUSY","ENOTEMPTY"].includes(e.code))throw e}};
  const syncDirectory=(src,dst,{preserve=new Set()}={})=>{
    if(!fs.existsSync(src)||!fs.statSync(src).isDirectory())throw Error(`Recovery source directory is missing: ${src}`);fs.mkdirSync(dst,{recursive:true});
    const protectedNames=path.resolve(dst)===path.join(HUB_ROOT,"data","android-tv")?new Set([...preserve,".android"]):preserve;
    const sourceNames=new Set(fs.readdirSync(src));for(const ent of fs.readdirSync(dst,{withFileTypes:true})){if(!sourceNames.has(ent.name)&&!protectedNames.has(ent.name))removeTarget(path.join(dst,ent.name))}
    for(const ent of fs.readdirSync(src,{withFileTypes:true})){
      if(protectedNames.has(ent.name))continue;
      if(ent.isSymbolicLink())throw Error(`Symbolic links are not permitted in recovery sources: ${ent.name}`);const from=path.join(src,ent.name),to=path.join(dst,ent.name);
      if(ent.isDirectory()){if(fs.existsSync(to)&&!fs.lstatSync(to).isDirectory())removeTarget(to);fs.mkdirSync(to,{recursive:true});syncDirectory(from,to)}
      else if(ent.isFile()){if(fs.existsSync(to)&&fs.lstatSync(to).isDirectory())removeTarget(to);const stage=path.join(dst,`.restore-${process.pid}-${crypto.randomBytes(6).toString("hex")}`);fs.copyFileSync(from,stage);fs.chmodSync(stage,0o660);fs.renameSync(stage,to)}
    }
  };
  journal("preparing");
  if(data){
    const src=path.join(srcRoot,"data"),dst=path.join(HUB_ROOT,"data");fs.mkdirSync(dst,{recursive:true});
    journal("committing");syncDirectory(src,dst,{preserve:new Set(["backups"])});
    for(const suffix of ["-wal","-shm"])fs.rmSync(path.join(dst,"classroom-control-hub.db"+suffix),{force:true});restored.push("data");
  }else if(database){
    const src=path.join(srcRoot,"data","classroom-control-hub.db"),dst=path.join(HUB_ROOT,"data","classroom-control-hub.db");
    fs.mkdirSync(path.dirname(dst),{recursive:true});const stage=`${dst}.restore-${process.pid}`;fs.copyFileSync(src,stage);fs.chmodSync(stage,0o600);journal("committing");for(const suffix of ["-wal","-shm"])fs.rmSync(dst+suffix,{force:true});fs.renameSync(stage,dst);restored.push("database");
  }
  await hostAgentRequest("POST","/recovery/normalize-data",{confirm:"NORMALIZE_RESTORED_DATA"},30000);
  journal("completed");fs.rmSync(journalFile,{force:true});return restored;
}
async function waitForMainApplication(){
  const deadline=Date.now()+RESTORE_HEALTH_TIMEOUT_MS;let last="not ready";
  while(Date.now()<deadline){try{const status=await mainAppStatus();if(status.ok&&status.database)return status}catch(e){last=e.message}await new Promise(resolve=>setTimeout(resolve,1000))}
  throw Error(`RoomGoblin did not become healthy after restore: ${last}`);
}
async function extractRestore(name,target){const plan=backupRestorePlan(name),root=path.resolve(target);fs.mkdirSync(root,{recursive:true,mode:0o700});const zip=new AdmZip(plan.path);for(const entry of zip.getEntries()){const normalized=entry.entryName.replace(/\\/g,"/"),dest=path.resolve(root,normalized);if(dest!==root&&!dest.startsWith(root+path.sep))throw Error(`Unsafe archive path: ${normalized}`);if(entry.isDirectory){fs.mkdirSync(dest,{recursive:true,mode:0o700});continue}fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,entry.getData(),{mode:0o600,flag:"wx"})}return {plan,root,srcRoot:path.join(root,"classroom-hub")}}
function ensureRecoveryStageCapacity(bytes){
  fs.mkdirSync(RECOVERY_STAGING_ROOT,{recursive:true,mode:0o700});
  const st=fs.lstatSync(RECOVERY_STAGING_ROOT);if(!st.isDirectory()||st.isSymbolicLink())throw Error("Recovery staging root must be a real directory");
  const capacity=fs.statfsSync(RECOVERY_STAGING_ROOT),available=Number(capacity.bavail)*Number(capacity.bsize);
  if(!Number.isSafeInteger(available)||available<bytes+64*1024*1024)throw Error("Recovery staging does not have enough free capacity");
}
function stageFullRecovery(plan){
  ensureRecoveryStageCapacity(plan.expandedBytes);
  const recoveryId=`fr-${crypto.randomBytes(16).toString("hex")}`,partial=path.join(RECOVERY_STAGING_ROOT,`.partial-${recoveryId}`),target=path.join(RECOVERY_STAGING_ROOT,recoveryId);
  fs.mkdirSync(partial,{mode:0o700});
  try{
    const zip=new AdmZip(plan._plaintext),modes=new Map(plan.manifest.files.map(file=>[file.path,Number.parseInt(file.mode,8)]));
    for(const entry of zip.getEntries()){
      if(entry.isDirectory)continue;
      const name=entry.entryName,dest=path.resolve(partial,name);
      if(!dest.startsWith(path.resolve(partial)+path.sep))throw Error(`Unsafe archive path: ${name}`);
      const mode=modes.get(name);if(name!=="backup-manifest.json"&&!mode)throw Error(`Recovery topology does not define file mode: ${name}`);
      fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
      const data=entry.getData(),fd=fs.openSync(dest,"wx",name==="backup-manifest.json"?0o600:mode);
      try{fs.writeFileSync(fd,data);fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    }
    fs.renameSync(partial,target);
    return {recoveryId,target};
  }catch(error){fs.rmSync(partial,{recursive:true,force:true});throw error}
}
async function delegateFullRecovery(req,res){
  let staged=null,plan=null;
  try{
    if(String(req.body?.confirm||"")!=="RESTORE_FULL_RECOVERY")return res.status(400).json({ok:false,error:"Full recovery requires confirm=RESTORE_FULL_RECOVERY"});
    plan=backupRestorePlan(req.params.name,req.body?.passphrase);await assertFullRecoveryCompatible(plan);
    recoveryMutationLocked=true;staged=stageFullRecovery(plan);
    await validateRecoveryIdentities({adbRoot:path.join(staged.target,"classroom-hub","data","android-tv",".android"),signingRoot:path.join(staged.target,"recovery-secrets","android-agent-signing"),veyonRoot:path.join(staged.target,"recovery-secrets","veyon")});
    const started=await hostAgentRequest("POST","/recovery/full/start",{confirm:"RESTORE_FULL_RECOVERY",recoveryId:staged.recoveryId,manifestSha256:plan.manifestSha256},30000);
    res.status(202).json({ok:true,recoveryId:staged.recoveryId,status:"delegated",running:true,phase:started.phase||"queued",message:"Full recovery was validated, staged, and delegated to the atomic host transaction."});
  }catch(e){recoveryMutationLocked=false;if(staged)fs.rmSync(staged.target,{recursive:true,force:true});res.status(400).json({ok:false,error:e.message})}
  finally{if(plan?._plaintext)plan._plaintext.fill(0)}
}
app.get("/recovery/full/job",async(_req,res)=>{try{const result=await hostAgentRequest("GET","/recovery/full/job",null,10000),raw=result.job||result;const job={recoveryId:String(raw.recoveryId||""),phase:String(raw.phase||"idle"),running:raw.running===true,ok:raw.ok===true,message:String(raw.message||""),updatedAt:raw.updatedAt||null,rollback:raw.rollback&&typeof raw.rollback==="object"?{attempted:raw.rollback.attempted===true,ok:raw.rollback.ok===true}:null,reloginRequired:raw.reloginRequired===true};if(!job.running)recoveryMutationLocked=false;res.json({ok:true,job})}catch(e){res.status(502).json({ok:false,error:e.message})}});
async function reconcileRecoveryService(service){
  const spec=FULL_RECOVERY_SERVICE_SPECS[service.id],rootName=service.id,dataRoot=path.join(Classroom_ROOT,rootName);
  let inspect=null;try{const result=await run("docker",["inspect",spec.container],{timeout:10000});inspect=JSON.parse(result.stdout)[0]}catch{}
  if(inspect&&inspect.Config?.Labels?.["org.roomgoblin.deployment-ownership"]!=="roomgoblin")throw Error(`Managed-service recovery refuses ownership collision for ${spec.container}`);
  if(inspect&&inspect.Config?.Image!==spec.image)throw Error(`Managed-service recovery refuses image drift for ${spec.container}`);
  if(!service.enabled){if(inspect)await run("docker",["rm","-f",spec.container],{timeout:30000});return {id:service.id,enabled:false,running:false}}
  if(inspect){await run("docker",["rm","-f",spec.container],{timeout:30000});inspect=null}
  if(!inspect){
    fs.mkdirSync(dataRoot,{recursive:true,mode:0o770});
    const marker=path.join(dataRoot,".roomgoblin-managed");if(!fs.existsSync(marker))fs.writeFileSync(marker,"roomgoblin-managed-v1\n",{mode:0o660,flag:"wx"});
    const args=["run","-d","--network","host","--name",spec.container,"--restart","unless-stopped","--label","org.roomgoblin.deployment-ownership=roomgoblin"];
    if(service.id==="mosquitto")args.push("-v",`${dataRoot}/config:/mosquitto/config`,"-v",`${dataRoot}/data:/mosquitto/data`,"-v",`${dataRoot}/log:/mosquitto/log`);
    else if(service.id==="music-assistant")args.push("-v",`${dataRoot}:/data`);
    else if(service.id==="nodered")args.push("-v",`${dataRoot}:/data`);
    else if(service.id==="govee2mqtt"){
      const integrations=await readManagedIntegrations({resolved:true}),settings=integrations.modules?.govee2mqtt||{};
      args.push("-e",`GOVEE_MQTT_HOST=${serviceHost(settings.mqttHost||"127.0.0.1",["mosquitto"],"host")}`,"-e",`GOVEE_MQTT_PORT=${validPort(settings.mqttPort,1883)}`);
      for(const [env,key] of [["GOVEE_MQTT_USER","mqttUsername"],["GOVEE_MQTT_PASSWORD","mqttPassword"],["GOVEE_API_KEY","apiKey"],["GOVEE_EMAIL","email"],["GOVEE_PASSWORD","password"]])if(settings[key])args.push("-e",`${env}=${settings[key]}`);
    }
    args.push(spec.image);await run("docker",args,{timeout:180000});inspect={State:{Running:true}};
  }
  await run("docker",[service.running?"start":"stop",spec.container],{timeout:30000});
  return {id:service.id,enabled:true,running:service.running};
}
app.post("/recovery/reconcile-services",async(req,res)=>{try{
  if(!req.body||Object.keys(req.body).join(",")!=="services"||!Array.isArray(req.body.services))throw Error("Service reconciliation requires the exact services array schema");
  const services=req.body.services.map(service=>{const spec=FULL_RECOVERY_SERVICE_SPECS[service?.id];if(!spec||Object.keys(service).sort().join(",")!=="enabled,id,running"||typeof service.enabled!=="boolean"||typeof service.running!=="boolean"||(service.running&&!service.enabled))throw Error("Invalid managed-service reconciliation plan");return {id:service.id,enabled:service.enabled,running:service.running}});
  const reconciled=[];for(const service of services)reconciled.push(await reconcileRecoveryService(service));res.json({ok:true,services:reconciled});
}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post("/backup/:name/restore",async(req,res)=>{
  let stopped=false,temp=null,safety=null,mutationStarted=false;
  try{
    if(String(req.body?.mode||"")==="full-recovery")return await delegateFullRecovery(req,res);
    if(String(req.body?.confirm||"")!=="RESTORE")return res.status(400).json({ok:false,error:"Restore requires confirm=RESTORE"});
    const mode=String(req.body?.mode||"configuration-data");
    if(!["configuration","data","configuration-data"].includes(mode))throw Error("Invalid restore mode");
    const plan=backupRestorePlan(req.params.name);
    assertFullArchiveKeyCompatible(plan);
    const requestedCapability=mode==="configuration"?"database":"data";if(!plan.capabilities[requestedCapability]||!plan.capabilities.database)throw Error(`Backup does not support ${mode} restore`);
    safety=await createOperationalBackupNamed("pre-restore");
    temp=path.join(UPLOAD_DIR,`restore-${Date.now()}`);fs.mkdirSync(temp,{recursive:true});const extracted=await extractRestore(plan.name,temp),srcRoot=extracted.srcRoot;
    const doData=mode.includes("data"),doDatabase=mode==="configuration";
    await verifyRestoreSource(srcRoot,{data:doData||doDatabase});
    await run("docker",["stop",APP_CONTAINER],{timeout:30000});stopped=true;mutationStarted=true;
    const restored=await replaceRestoreContent(srcRoot,{database:doDatabase,data:doData});
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
        try{const extracted=await extractRestore(safety.name,rollbackDir);await verifyRestoreSource(extracted.srcRoot,{data:true});await replaceRestoreContent(extracted.srcRoot,{data:true})}finally{fs.rmSync(rollbackDir,{recursive:true,force:true})}
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
  let application=null;try{application=await mainAppStatus()}catch{application={ok:false}}
  let containers=[];try{containers=await dockerContainers()}catch{}
  const documents=diagnosticSupportDocuments({createdAt:new Date().toISOString(),agentVersion:"1.0.0-alpha.81",application,containers,system:{platform:os.platform(),architecture:os.arch(),cpuCount:os.cpus().length,memoryBytes:os.totalmem()}});
  zip.addFile("summary.json",Buffer.from(JSON.stringify(documents.summary,null,2)));
  zip.addFile("docker/containers.json",Buffer.from(JSON.stringify(documents.containers,null,2)));
  writeZipAtomic(zip,dest);res.download(dest,name);
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
  mosquitto:{name:"MQTT Broker",container:"mosquitto",image:"eclipse-mosquitto:2.0.22",description:"MQTT broker used by RoomGoblin integrations.",expectedProject:"services",ownership:"integration"},
  govee2mqtt:{name:"Govee Lighting",container:"govee2mqtt",image:"ghcr.io/wez/govee2mqtt:2025.04.13-17d43d72",description:"Govee discovery and LAN/cloud control through MQTT.",expectedProject:"services",ownership:"integration"},
  musicassistant:{name:"Music Assistant",container:"music-assistant-server",image:"ghcr.io/music-assistant/server:2.9.13",description:"Classroom audio and media service discovered as an externally managed Compose integration.",expectedProject:"music-assistant",ownership:"integration",externalOnly:true},
  nodered:{name:"Node-RED",container:"nodered",image:"nodered/node-red:4.1.14-22",description:"Optional visual automation environment.",ownership:"optional"}
};
async function containerExists(name){try{await run("docker",["inspect",name],{timeout:5000});return true}catch{return false}}
app.get("/modules",async(_req,res)=>{
  const cfg=await readManagedIntegrations(),out=[];
  for(const [id,m] of Object.entries(MODULES)){
    let state="not-installed",status="",composeProject="",composeService="",networkMode="";
    if(await containerExists(m.container)){
      try{
        const r=await run("docker",["inspect",m.container],{timeout:5000});
        const info=JSON.parse(r.stdout)[0]||{};
        state=info.State?.Status||"installed";status=info.State?.Health?.Status||"";
        composeProject=info.Config?.Labels?.["com.docker.compose.project"]||"";
        composeService=info.Config?.Labels?.["com.docker.compose.service"]||"";
        networkMode=info.HostConfig?.NetworkMode||"unknown";
      }catch{state="installed";networkMode="unknown";}
    }
    const configured=!!cfg.modules?.[id];
    let management=state==="not-installed"?"not-installed":configured?"managed":(m.expectedProject&&composeProject===m.expectedProject)?"adopted":"external";
    out.push({id,...m,state,health:status,configured,management,composeProject,composeService,networkMode,networkMigrationRequired:state!=="not-installed"&&networkMode!=="host",canDeploy:!m.externalOnly,canRemove:!m.externalOnly});
  }
  res.json({ok:true,modules:out})
});
app.get("/modules/:id/config",async(req,res)=>{try{const id=String(req.params.id||""),cfg=(await readManagedIntegrations()).modules?.[id]||{};res.json({ok:true,id,config:cfg})}catch(e){res.status(e.status||502).json({ok:false,error:e.message})}});
app.post("/modules/:id/deploy",async(req,res)=>{const id=String(req.params.id||""),m=MODULES[id];if(!m)return res.status(404).json({ok:false,error:"Unknown integration"});if(m.externalOnly)return res.status(409).json({ok:false,error:"This integration is externally managed and can be monitored/adopted without recreating it."});try{const configured=await mainAppRequest("PUT",`/api/v1/internal/maintenance/integrations/${encodeURIComponent(id)}`,{settings:req.body?.settings||{}}),resolved=configured.resolved||{};const exists=await containerExists(m.container);if(exists&&!req.body?.recreate)return res.json({ok:true,id,adopted:true,message:"Existing container adopted. Use recreate to apply managed settings."});let args=["run","-d","--network","host","--name",m.container,"--restart","unless-stopped","--label","org.roomgoblin.deployment-ownership=roomgoblin"];
  if(id==="mosquitto"){
    const username=String(resolved.username||"classroom-hub").replace(/[^A-Za-z0-9._-]/g,""),password=String(resolved.password||"");if(!username||password.length<16)throw Error("MQTT broker requires a username and password of at least 16 characters");const port=validPort(resolved.port,1883);const base=path.join(Classroom_ROOT,"mosquitto");for(const d of ["config","data","log"])fs.mkdirSync(path.join(base,d),{recursive:true});const salt=crypto.randomBytes(12),hash=crypto.pbkdf2Sync(password,salt,101,64,"sha512"),passwordFile=path.join(base,"config","passwords");fs.writeFileSync(passwordFile,`${username}:$7$101$${salt.toString("base64").replace(/=+$/g,"")}$${hash.toString("base64").replace(/=+$/g,"")}\n`,{mode:0o600});const conf=path.join(base,"config","mosquitto.conf");fs.writeFileSync(conf,`persistence true\npersistence_location /mosquitto/data/\nlog_dest stdout\nlistener ${port}\nallow_anonymous false\npassword_file /mosquitto/config/passwords\n`,{mode:0o600});args.push("-v",`${base}/config:/mosquitto/config`,`-v`,`${base}/data:/mosquitto/data`,`-v`,`${base}/log:/mosquitto/log`);
  } else if(id==="govee2mqtt"){
    args.push("-e",`GOVEE_MQTT_HOST=${serviceHost(resolved.mqttHost||"127.0.0.1",["mosquitto"],"host")}`,"-e",`GOVEE_MQTT_PORT=${resolved.mqttPort||1883}`,"-e",`GOVEE_LAN_BROADCAST_ALL=${resolved.lanBroadcast===false?"false":"true"}`,"-e",`GOVEE_TEMPERATURE_SCALE=${resolved.temperatureScale||"F"}`,"-e",`TZ=${resolved.timezone||process.env.TZ||"UTC"}`);if(resolved.mqttUsername)args.push("-e",`GOVEE_MQTT_USER=${resolved.mqttUsername}`);if(resolved.mqttPassword)args.push("-e",`GOVEE_MQTT_PASSWORD=${resolved.mqttPassword}`);if(resolved.apiKey)args.push("-e",`GOVEE_API_KEY=${resolved.apiKey}`);if(resolved.email)args.push("-e",`GOVEE_EMAIL=${resolved.email}`);if(resolved.password)args.push("-e",`GOVEE_PASSWORD=${resolved.password}`);
  } else if(id==="nodered"){
    const data=path.join(Classroom_ROOT,"nodered");fs.mkdirSync(data,{recursive:true});args.push("-e",`PORT=${validPort(resolved.port,1880)}`,"-v",`${data}:/data`,`-e`,`TZ=${resolved.timezone||process.env.TZ||"UTC"}`);if(resolved.credentialSecret)args.push("-e",`NODE_RED_CREDENTIAL_SECRET=${resolved.credentialSecret}`);
  }
  args.push(m.image);if(exists)await run("docker",["rm","-f",m.container],{timeout:30000});const r=await run("docker",args,{timeout:120000,maxBuffer:16*1024*1024}),serviceRoot=path.join(Classroom_ROOT,id==="musicassistant"?"music-assistant":id),marker=path.join(serviceRoot,".roomgoblin-managed");fs.mkdirSync(serviceRoot,{recursive:true,mode:0o770});if(!fs.existsSync(marker))fs.writeFileSync(marker,"roomgoblin-managed-v1\n",{mode:0o660,flag:"wx"});res.json({ok:true,id,container:m.container,output:r.stdout.trim()})}catch(e){res.status(500).json({ok:false,error:e.message,output:(e.stdout||"")+(e.stderr||"")})}});
app.post("/modules/:id/remove",async(req,res)=>{const id=String(req.params.id||""),m=MODULES[id];if(!m)return res.status(404).json({ok:false,error:"Unknown integration"});if(m.externalOnly)return res.status(409).json({ok:false,error:"Externally managed integrations are not removed from RoomGoblin."});try{if(await containerExists(m.container))await run("docker",["rm","-f",m.container],{timeout:30000});res.json({ok:true,id})}catch(e){res.status(500).json({ok:false,error:e.message})}});
const safeCommands={
  "docker-ps":["docker",["ps","-a"]],"docker-stats":["docker",["stats","--no-stream"]],"disk-usage":["df",["-h"]],"memory":["free",["-h"]],"network":["ip",["addr"]],"routes":["ip",["route"]],"dns":["cat",["/etc/resolv.conf"]],"compose-status":["docker",["compose","ps"]]
};
app.post("/command",async(req,res)=>{try{const preset=String(req.body?.preset||"");if(!preset||!safeCommands[preset])return res.status(403).json({ok:false,error:"Only fixed diagnostic presets are supported"});const [cmd,args]=safeCommands[preset],r=await run(cmd,args,{timeout:30000,maxBuffer:16*1024*1024,cwd:preset==="compose-status"?HUB_ROOT:undefined});return res.json({ok:true,preset,output:(r.stdout||"")+(r.stderr||"")})}catch(e){res.status(500).json({ok:false,error:e.message,output:(e.stdout||"")+(e.stderr||"")})}});
const server=app.listen(PORT,BIND_ADDRESS,()=>console.log(`RoomGoblin Maintenance Agent listening on ${PORT}`));
let stopping=false;function stop(signal){if(stopping)return;stopping=true;console.log(`${signal} received; draining maintenance agent`);const force=setTimeout(()=>process.exit(1),10000);force.unref();server.close(()=>{clearTimeout(force);process.exit(0)})}
process.once("SIGTERM",()=>stop("SIGTERM"));process.once("SIGINT",()=>stop("SIGINT"));
