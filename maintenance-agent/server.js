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
const {diagnosticBackupEntryAllowed,backupContainsSensitiveData,diagnosticSupportDocuments,fullRecoveryEntryAllowed,archiveInventory,verifyArchiveInventory,parseMasterKey}=require("./backup-policy");
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
const BACKUP_DIR=path.join(HUB_ROOT,"data","backups");
const MASTER_KEY_FILE=String(process.env.MASTER_KEY_FILE||"/run/secrets/classroom-control-hub-master-key");
const SIGNING_ROOT=path.resolve(process.env.ANDROID_AGENT_SIGNING_ROOT||"/signing");
const UPLOAD_DIR="/work/uploads";
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
async function componentHealth(){let docker=false,hostAgent=null,application=null;try{await run("docker",["info","--format","{{.ServerVersion}}"],{timeout:5000});docker=true}catch{}try{hostAgent=await hostAgentRequest("GET","/health")}catch(e){hostAgent={ok:false,error:e.message}}try{application=await mainAppStatus()}catch(e){application={ok:false,error:e.message}}return {version:"1.0.0-alpha.79",docker,hostAgent,roots:{hub:fs.existsSync(HUB_ROOT),services:fs.existsSync(Classroom_ROOT)},shellEnabled:false,application,database:application?.database||null}}
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
function copyIntoZip(zip,src,prefix,filter){if(!fs.existsSync(src))return;for(const ent of fs.readdirSync(src,{withFileTypes:true})){const full=path.join(src,ent.name),rel=path.posix.join(prefix,ent.name);if(ent.isSymbolicLink())continue;if(filter&&!filter(full,rel,ent))continue;if(ent.isDirectory())copyIntoZip(zip,full,rel,filter);else if(ent.isFile())zip.addLocalFile(full,path.posix.dirname(rel),path.basename(rel))}}
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
app.post("/backup/create",async(req,res)=>{let dbSnapshot="";try{
  const scope=["configuration","quick","operational","diagnostic","full"].includes(req.body?.scope)?req.body.scope:"operational";
  const containsSensitiveData=backupContainsSensitiveData(scope);
  if(containsSensitiveData&&req.body?.confirmSensitiveData!==true)return res.status(400).json({ok:false,error:"This recovery backup contains private appliance data. Resubmit with confirmSensitiveData=true."});
  if(scope==="full"&&req.body?.confirmSecrets!==true)return res.status(400).json({ok:false,error:"Full Recovery Export contains private runtime state and the database encryption master key in a plaintext ZIP. Resubmit with confirmSecrets=true."});
  const stamp=new Date().toISOString().replace(/[:.]/g,"-"),name=`classroom-hub-${scope}-${stamp}.zip`,dest=path.join(BACKUP_DIR,name),zip=new AdmZip();
  const dbPath=path.join(HUB_ROOT,"data","classroom-control-hub.db");dbSnapshot=path.join(UPLOAD_DIR,`db-backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.db`);
  if(scope==="full"&&!fs.existsSync(dbPath))throw Error("Full Recovery Export requires the authoritative RoomGoblin database");
  if(scope==="full"&&(!fs.existsSync(MASTER_KEY_FILE)||!fs.statSync(MASTER_KEY_FILE).isFile()))throw Error("Full Recovery Export requires the matching master encryption key");
  let hasDbSnapshot=false;if(!["quick","diagnostic"].includes(scope)&&fs.existsSync(dbPath)){await run("sqlite3",[dbPath,`.backup '${dbSnapshot.replace(/'/g,"''")}'`],{timeout:60000});hasDbSnapshot=fs.existsSync(dbSnapshot)}
  if(scope==="full"&&!hasDbSnapshot)throw Error("Full Recovery Export requires a consistent RoomGoblin database snapshot");
  const signingKeystore=path.join(SIGNING_ROOT,"android-agent","RoomGoblin-Display-Agent.keystore"),signingPassword=path.join(SIGNING_ROOT,"android-agent","password");
  if(scope==="full"&&fs.existsSync(signingKeystore)!==fs.existsSync(signingPassword))throw Error("Full Recovery Export found an incomplete Android signing identity");
  const baseFilter=backupFilter(scope),filter=(full,rel,ent)=>{if(/classroom-hub\.db(?:-wal|-shm)?$/.test(rel))return false;return baseFilter(full,rel,ent)};
  if(scope==="diagnostic"){
    let application=null;try{application=await mainAppStatus()}catch{application={ok:false}}
    let containers=[];try{containers=await dockerContainers()}catch{}
    const documents=diagnosticSupportDocuments({createdAt:new Date().toISOString(),agentVersion:"1.0.0-alpha.79",application,containers,system:{platform:os.platform(),architecture:os.arch(),cpuCount:os.cpus().length,memoryBytes:os.totalmem()}});
    zip.addFile("summary.json",Buffer.from(JSON.stringify(documents.summary,null,2)));
    zip.addFile("docker/containers.json",Buffer.from(JSON.stringify(documents.containers,null,2)));
  }else if(scope==="full")copyIntoZip(zip,path.join(HUB_ROOT,"data"),"classroom-hub/data",filter);
  else copyIntoZip(zip,HUB_ROOT,"classroom-hub",filter);
  if(hasDbSnapshot)zip.addLocalFile(dbSnapshot,"classroom-hub/data","classroom-control-hub.db");
  if(scope==="full"||scope==="operational")copyIntoZip(zip,Classroom_ROOT,"services",filter);
  if(scope==="full")zip.addFile("recovery-secrets/classroom-hub-master.key",parseMasterKey(fs.readFileSync(MASTER_KEY_FILE)),"",0o600);
  if(scope==="full"&&fs.existsSync(signingKeystore))copyIntoZip(zip,SIGNING_ROOT,"recovery-secrets/android-agent-signing",filter);
  const hasServiceState=zip.getEntries().some(entry=>!entry.isDirectory&&entry.entryName.startsWith("services/"));
  const capabilities={configuration:["configuration","operational","full"].includes(scope),database:hasDbSnapshot,data:["operational","full"].includes(scope)&&hasDbSnapshot,services:hasServiceState,secrets:scope==="full"};
  const manifest=scope==="diagnostic"
    ?{version:4,createdAt:new Date().toISOString(),scope,applicationVersion:applicationVersion(),databaseSnapshot:false,containsSecrets:false,containsSensitiveData:false,requiresMasterKey:false,capabilities}
    :scope==="full"
      ?{version:5,createdAt:new Date().toISOString(),scope,applicationVersion:applicationVersion(),databaseSchemaVersion:hasDbSnapshot?Number(String((await run("sqlite3",[dbSnapshot,"SELECT COALESCE(MAX(version),0) FROM schema_migrations;"],{timeout:60000})).stdout||0).trim())||0:null,databaseSnapshot:true,containsSecrets:true,containsSensitiveData:true,requiresMasterKey:true,confidentiality:"plaintext-sensitive",integrityAlgorithm:"sha256",capabilities,files:archiveInventory(zip.getEntries())}
      :{version:4,createdAt:new Date().toISOString(),scope,applicationVersion:applicationVersion(),databaseSnapshot:hasDbSnapshot,containsSecrets:false,containsSensitiveData,requiresMasterKey:hasDbSnapshot,capabilities};
  zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify(manifest,null,2)));writeZipAtomic(zip,dest);
  res.json({ok:true,name,size:fs.statSync(dest).size,sha256:sha256File(dest),download:`/backup/${encodeURIComponent(name)}`,containsSecrets:scope==="full",containsSensitiveData})
}catch(e){res.status(500).json({ok:false,error:e.message})}finally{if(dbSnapshot)try{fs.rmSync(dbSnapshot,{force:true})}catch{}}});
app.get("/backups",(_req,res)=>{const items=fs.readdirSync(BACKUP_DIR).filter(x=>x.endsWith(".zip")).map(n=>{const info=statInfo(path.join(BACKUP_DIR,n),BACKUP_DIR);try{const plan=backupRestorePlan(n);return {...info,containsSensitiveData:plan.containsSensitiveData,capabilities:plan.capabilities,restoreModes:plan.restoreModes}}catch(e){return {...info,restorable:false,error:e.message,capabilities:{}}}}).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));res.json({ok:true,items})});
app.get("/backups/catalog",(_req,res)=>{try{
  const managed=fs.readdirSync(BACKUP_DIR).filter(x=>x.endsWith(".zip")).map(n=>{const info=statInfo(path.join(BACKUP_DIR,n),BACKUP_DIR);try{const plan=backupRestorePlan(n);return {...info,source:"managed",restorable:plan.restoreModes.length>0,containsSensitiveData:plan.containsSensitiveData,capabilities:plan.capabilities,restoreModes:plan.restoreModes}}catch(e){return {...info,source:"managed",restorable:false,error:e.message,capabilities:{},restoreModes:[]}}});
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
    if(!hasDbSnapshot)throw Error("Operational backup requires a consistent RoomGoblin database snapshot");
    const zip=new AdmZip();
    const filter=(full,rel,ent)=>{if(/classroom-hub\.db(?:-wal|-shm)?$/.test(rel))return false;return backupFilter("operational")(full,rel,ent)};
    copyIntoZip(zip,HUB_ROOT,"classroom-hub",filter);
    zip.addLocalFile(dbSnapshot,"classroom-hub/data","classroom-control-hub.db");
    zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify({version:4,scope:"operational",createdAt:new Date().toISOString(),reason:prefix,applicationVersion:applicationVersion(),databaseSnapshot:true,containsSecrets:false,containsSensitiveData:true,requiresMasterKey:true,capabilities:{configuration:true,database:true,data:true,services:false,secrets:false}},null,2)));
    writeZipAtomic(zip,dest);return {name,dest,size:fs.statSync(dest).size,sha256:sha256File(dest)};
  }finally{fs.rmSync(dbSnapshot,{force:true})}
}
function backupRestorePlan(name){
  const safeName=cleanName(name);if(safeName!==String(name||"")||!safeName.endsWith(".zip"))throw Error("Invalid backup name");
  const p=path.join(BACKUP_DIR,safeName);
  if(!fs.existsSync(p))throw Error("Backup not found");
  const zip=new AdmZip(p),entries=zip.getEntries();
  if(entries.length>100000)throw Error("Restore archive contains too many entries");
  let expandedBytes=0;const seenEntries=new Set(),foldedEntries=new Set();
  for(const entry of entries){
    const normalized=entry.entryName.replace(/\\/g,"/");
    if(!normalized||normalized.startsWith("/")||normalized.split("/").includes(".."))throw Error(`Unsafe archive path: ${normalized}`);
    const folded=normalized.toLowerCase();if(seenEntries.has(normalized)||foldedEntries.has(folded))throw Error(`Restore archive contains a duplicate or case-colliding entry: ${normalized}`);seenEntries.add(normalized);foldedEntries.add(folded);
    const allowed=normalized==="backup-manifest.json"||normalized.startsWith("classroom-hub/")||normalized.startsWith("services/")||normalized.startsWith("recovery-secrets/");
    if(!allowed)throw Error(`Unexpected restore entry: ${normalized}`);
    const unixType=(Number(entry.header?.attr||0)>>>16)&0xf000;if(unixType===0xa000)throw Error(`Symbolic links are not permitted in restore archives: ${normalized}`);
    expandedBytes+=Number(entry.header?.size||0);if(expandedBytes>RESTORE_MAX_EXPANDED_BYTES)throw Error("Restore archive exceeds the configured expanded-size limit");
  }
  let manifest=null;const me=entries.find(e=>e.entryName==="backup-manifest.json");
  if(me)try{manifest=JSON.parse(me.getData().toString("utf8"))}catch{}
  const integrityVerified=manifest?.scope==="full"?(verifyArchiveInventory(entries,manifest),true):false;
  const names=entries.map(e=>e.entryName.replace(/\\/g,"/"));
  const hasConfig=names.some(n=>n.startsWith("classroom-hub/config/")),hasData=names.some(n=>n.startsWith("classroom-hub/data/")),hasDatabase=names.includes("classroom-hub/data/classroom-control-hub.db"),hasEnv=names.includes("classroom-hub/.env"),hasMasterKey=names.includes("recovery-secrets/classroom-hub-master.key"),hasServices=names.some(n=>n.startsWith("services/"));
  const capabilities={configuration:!!(manifest?.capabilities?.configuration??(hasConfig||hasDatabase))&&hasDatabase,database:!!(manifest?.capabilities?.database??hasDatabase)&&hasDatabase,data:!!(manifest?.capabilities?.data??hasData)&&hasData&&hasDatabase,services:!!(manifest?.capabilities?.services??hasServices)&&hasServices,secrets:!!(manifest?.capabilities?.secrets??(hasEnv&&hasMasterKey))&&hasMasterKey};
  const containsSensitiveData=manifest?.containsSensitiveData===true||backupContainsSensitiveData(manifest?.scope);
  return {name:safeName,path:p,manifest,entries:entries.length,expandedBytes,hasConfig,hasData,hasDatabase,hasEnv,hasMasterKey,integrityVerified,containsSensitiveData,capabilities,fullRecoveryRestorable:false,restoreModes:[...(capabilities.database?["configuration"]:[]),...(capabilities.data&&capabilities.database?["data","configuration-data"]:[])],preview:names.slice(0,100)};
}
function assertFullArchiveKeyCompatible(plan){
  if(plan.manifest?.scope!=="full")return;
  if(!fs.existsSync(MASTER_KEY_FILE))throw Error("This Full Recovery Export cannot be partially restored without an installed master key");
  const zip=new AdmZip(plan.path),entry=zip.getEntry("recovery-secrets/classroom-hub-master.key");
  if(!entry)throw Error("Full Recovery Export is missing its master key");
  const archived=parseMasterKey(entry.getData()),installed=parseMasterKey(fs.readFileSync(MASTER_KEY_FILE));
  if(!crypto.timingSafeEqual(archived,installed))throw Error("This Full Recovery Export uses a different master key; partial database/data restore is blocked until atomic full recovery is available");
}
app.get("/backup/:name/restore-plan",(req,res)=>{try{res.json({ok:true,plan:backupRestorePlan(req.params.name)})}catch(e){res.status(400).json({ok:false,error:e.message})}});
app.post("/backup/import",(req,res)=>{
  const requested=String(req.get("x-backup-name")||""),name=cleanName(requested);
  if(!name||name!==requested||!name.endsWith(".zip"))return res.status(400).json({ok:false,error:"A safe .zip name is required in x-backup-name"});
  const declared=Number(req.get("content-length")||0);if(!Number.isFinite(declared)||declared<=0||declared>RESTORE_MAX_ARCHIVE_BYTES)return res.status(413).json({ok:false,error:"Recovery archive size is missing or exceeds the configured limit"});
  const dest=path.join(BACKUP_DIR,name),partial=`${dest}.import-${process.pid}-${Date.now()}`;if(fs.existsSync(dest))return res.status(409).json({ok:false,error:"A backup with this name already exists"});
  let bytes=0,done=false;const stream=fs.createWriteStream(partial,{flags:"wx",mode:0o600});
  const fail=(status,error)=>{if(done)return;done=true;stream.destroy();fs.rmSync(partial,{force:true});if(!res.headersSent)res.status(status).json({ok:false,error})};
  req.on("data",chunk=>{bytes+=chunk.length;if(bytes>RESTORE_MAX_ARCHIVE_BYTES)fail(413,"Recovery archive exceeds the configured limit")});req.on("aborted",()=>fail(400,"Recovery archive upload was interrupted"));req.on("error",e=>fail(400,e.message));stream.on("error",e=>fail(500,e.message));
  stream.on("finish",()=>{if(done)return;try{if(bytes!==declared)throw Error("Recovery archive upload length does not match content-length");fs.renameSync(partial,dest);fs.chmodSync(dest,0o600);const plan=backupRestorePlan(name);if(plan.manifest?.scope!=="full"||plan.integrityVerified!==true)throw Error("Only a verified Full Recovery Export can be imported");done=true;res.status(201).json({ok:true,name,size:bytes,sha256:sha256File(dest),plan})}catch(e){fs.rmSync(partial,{force:true});fs.rmSync(dest,{force:true});done=true;res.status(400).json({ok:false,error:e.message})}});req.pipe(stream);
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
app.post("/backup/:name/restore",async(req,res)=>{
  let stopped=false,temp=null,safety=null,mutationStarted=false;
  try{
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
  const documents=diagnosticSupportDocuments({createdAt:new Date().toISOString(),agentVersion:"1.0.0-alpha.79",application,containers,system:{platform:os.platform(),architecture:os.arch(),cpuCount:os.cpus().length,memoryBytes:os.totalmem()}});
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
app.post("/modules/:id/deploy",async(req,res)=>{const id=String(req.params.id||""),m=MODULES[id];if(!m)return res.status(404).json({ok:false,error:"Unknown integration"});if(m.externalOnly)return res.status(409).json({ok:false,error:"This integration is externally managed and can be monitored/adopted without recreating it."});try{const configured=await mainAppRequest("PUT",`/api/v1/internal/maintenance/integrations/${encodeURIComponent(id)}`,{settings:req.body?.settings||{}}),resolved=configured.resolved||{};const exists=await containerExists(m.container);if(exists&&!req.body?.recreate)return res.json({ok:true,id,adopted:true,message:"Existing container adopted. Use recreate to apply managed settings."});let args=["run","-d","--network","host","--name",m.container,"--restart","unless-stopped"];
  if(id==="mosquitto"){
    const username=String(resolved.username||"classroom-hub").replace(/[^A-Za-z0-9._-]/g,""),password=String(resolved.password||"");if(!username||password.length<16)throw Error("MQTT broker requires a username and password of at least 16 characters");const port=validPort(resolved.port,1883);const base=path.join(Classroom_ROOT,"mosquitto");for(const d of ["config","data","log"])fs.mkdirSync(path.join(base,d),{recursive:true});const salt=crypto.randomBytes(12),hash=crypto.pbkdf2Sync(password,salt,101,64,"sha512"),passwordFile=path.join(base,"config","passwords");fs.writeFileSync(passwordFile,`${username}:$7$101$${salt.toString("base64").replace(/=+$/g,"")}$${hash.toString("base64").replace(/=+$/g,"")}\n`,{mode:0o600});const conf=path.join(base,"config","mosquitto.conf");fs.writeFileSync(conf,`persistence true\npersistence_location /mosquitto/data/\nlog_dest stdout\nlistener ${port}\nallow_anonymous false\npassword_file /mosquitto/config/passwords\n`,{mode:0o600});args.push("-v",`${base}/config:/mosquitto/config`,`-v`,`${base}/data:/mosquitto/data`,`-v`,`${base}/log:/mosquitto/log`);
  } else if(id==="govee2mqtt"){
    args.push("-e",`GOVEE_MQTT_HOST=${serviceHost(resolved.mqttHost||"127.0.0.1",["mosquitto"],"host")}`,"-e",`GOVEE_MQTT_PORT=${resolved.mqttPort||1883}`,"-e",`GOVEE_LAN_BROADCAST_ALL=${resolved.lanBroadcast===false?"false":"true"}`,"-e",`GOVEE_TEMPERATURE_SCALE=${resolved.temperatureScale||"F"}`,"-e",`TZ=${resolved.timezone||process.env.TZ||"UTC"}`);if(resolved.mqttUsername)args.push("-e",`GOVEE_MQTT_USER=${resolved.mqttUsername}`);if(resolved.mqttPassword)args.push("-e",`GOVEE_MQTT_PASSWORD=${resolved.mqttPassword}`);if(resolved.apiKey)args.push("-e",`GOVEE_API_KEY=${resolved.apiKey}`);if(resolved.email)args.push("-e",`GOVEE_EMAIL=${resolved.email}`);if(resolved.password)args.push("-e",`GOVEE_PASSWORD=${resolved.password}`);
  } else if(id==="nodered"){
    const data=path.join(Classroom_ROOT,"nodered");fs.mkdirSync(data,{recursive:true});args.push("-e",`PORT=${validPort(resolved.port,1880)}`,"-v",`${data}:/data`,`-e`,`TZ=${resolved.timezone||process.env.TZ||"UTC"}`);if(resolved.credentialSecret)args.push("-e",`NODE_RED_CREDENTIAL_SECRET=${resolved.credentialSecret}`);
  }
  args.push(m.image);if(exists)await run("docker",["rm","-f",m.container],{timeout:30000});const r=await run("docker",args,{timeout:120000,maxBuffer:16*1024*1024});res.json({ok:true,id,container:m.container,output:r.stdout.trim()})}catch(e){res.status(500).json({ok:false,error:e.message,output:(e.stdout||"")+(e.stderr||"")})}});
app.post("/modules/:id/remove",async(req,res)=>{const id=String(req.params.id||""),m=MODULES[id];if(!m)return res.status(404).json({ok:false,error:"Unknown integration"});if(m.externalOnly)return res.status(409).json({ok:false,error:"Externally managed integrations are not removed from RoomGoblin."});try{if(await containerExists(m.container))await run("docker",["rm","-f",m.container],{timeout:30000});res.json({ok:true,id})}catch(e){res.status(500).json({ok:false,error:e.message})}});
const safeCommands={
  "docker-ps":["docker",["ps","-a"]],"docker-stats":["docker",["stats","--no-stream"]],"disk-usage":["df",["-h"]],"memory":["free",["-h"]],"network":["ip",["addr"]],"routes":["ip",["route"]],"dns":["cat",["/etc/resolv.conf"]],"compose-status":["docker",["compose","ps"]]
};
app.post("/command",async(req,res)=>{try{const preset=String(req.body?.preset||"");if(!preset||!safeCommands[preset])return res.status(403).json({ok:false,error:"Only fixed diagnostic presets are supported"});const [cmd,args]=safeCommands[preset],r=await run(cmd,args,{timeout:30000,maxBuffer:16*1024*1024,cwd:preset==="compose-status"?HUB_ROOT:undefined});return res.json({ok:true,preset,output:(r.stdout||"")+(r.stderr||"")})}catch(e){res.status(500).json({ok:false,error:e.message,output:(e.stdout||"")+(e.stderr||"")})}});
const server=app.listen(PORT,BIND_ADDRESS,()=>console.log(`RoomGoblin Maintenance Agent listening on ${PORT}`));
let stopping=false;function stop(signal){if(stopping)return;stopping=true;console.log(`${signal} received; draining maintenance agent`);const force=setTimeout(()=>process.exit(1),10000);force.unref();server.close(()=>{clearTimeout(force);process.exit(0)})}
process.once("SIGTERM",()=>stop("SIGTERM"));process.once("SIGINT",()=>stop("SIGINT"));
