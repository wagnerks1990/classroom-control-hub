"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const net=require("node:net");
const http=require("node:http");
const {spawn}=require("node:child_process");
const AdmZip=require("adm-zip");

const ROOT=path.resolve(__dirname,"..");

function freePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{const {port}=server.address();server.close(error=>error?reject(error):resolve(port))});
  });
}

function put(file,contents){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,contents)}

async function startAgent(t,{database=true,masterKey=true}={}){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"roomgoblin-full-recovery-"));
  const hub=path.join(temp,"hub"),services=path.join(temp,"services"),signing=path.join(temp,"signing"),bin=path.join(temp,"bin"),master=path.join(temp,"master.key");
  fs.mkdirSync(bin,{recursive:true});fs.mkdirSync(path.join(hub,"data","backups"),{recursive:true});fs.mkdirSync(services,{recursive:true});fs.mkdirSync(signing,{recursive:true});
  put(path.join(hub,"VERSION"),"1.0.0-test\n");
  if(database)put(path.join(hub,"data","classroom-control-hub.db"),"SQLITE_SNAPSHOT_SENTINEL");
  if(masterKey)put(master,"ab".repeat(32));
  const fakeSqlite=path.join(bin,"sqlite3");
  put(fakeSqlite,"#!/usr/bin/env node\nconst fs=require('fs');const command=process.argv[3]||'';const match=command.match(/^\\.backup '(.+)'$/);if(match)fs.copyFileSync(process.argv[2],match[1].replace(/''/g,\"'\"));else if(command==='PRAGMA quick_check;')process.stdout.write('ok\\n');else if(command.includes('schema_migrations'))process.stdout.write('1\\n');else process.exit(2);\n");
  fs.chmodSync(fakeSqlite,0o755);
  const hostSocket=path.join(temp,"host-agent.sock"),hostMock=path.join(temp,"mock-host-agent.cjs");
  put(hostMock,`"use strict";
const fs=require("node:fs"),http=require("node:http"),{EventEmitter}=require("node:events"),{Readable}=require("node:stream");
// The managed test sandbox rejects chown(2), even to its current uid/gid. The
// production ownership calls are covered separately by installer/security tests.
fs.chownSync=()=>{};fs.lchownSync=()=>{};
const original=http.request;
http.request=function(options,callback){
  if(!options||options.socketPath!==process.env.HOST_AGENT_SOCKET)return original.apply(this,arguments);
  const request=new EventEmitter();
  request.write=()=>true;request.setTimeout=()=>request;request.destroy=error=>{if(error)request.emit("error",error)};
  request.end=()=>process.nextTick(()=>{
    const payload={ok:true,stdout:"",stderr:""};
    const response=Readable.from([Buffer.from(JSON.stringify(payload))]);response.statusCode=200;callback(response);
  });
  return request;
};
`);
  const mainPort=await freePort(),main=http.createServer((_req,res)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify({ok:true,database:{file:"/app/data/classroom-control-hub.db",schemaVersion:1}}))});
  await new Promise((resolve,reject)=>main.listen(mainPort,"127.0.0.1",resolve).once("error",reject));
  const port=await freePort(),token="full-recovery-test-token";
  const child=spawn(process.execPath,[path.join(ROOT,"maintenance-agent/server.js")],{env:{...process.env,PORT:String(port),MAINTENANCE_TOKEN:token,MANAGED_HUB_ROOT:hub,MANAGED_SERVICES_ROOT:services,MASTER_KEY_FILE:master,ANDROID_AGENT_SIGNING_ROOT:signing,MAINTENANCE_WORK_DIR:path.join(temp,"uploads"),HOST_AGENT_SOCKET:hostSocket,MAIN_APP_URL:`http://127.0.0.1:${mainPort}`,APP_UID:String(process.getuid?.()??10001),APP_GID:String(process.getgid?.()??10001),NODE_OPTIONS:`--require=${hostMock}`,PATH:`${bin}:${process.env.PATH}`},stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);
  t.after(()=>{if(child.exitCode==null)child.kill("SIGKILL");main.close();fs.rmSync(temp,{recursive:true,force:true})});
  const base=`http://127.0.0.1:${port}`;
  for(let attempt=0;attempt<50;attempt++){
    try{await fetch(`${base}/backups`,{headers:{"x-maintenance-token":token}});return {base,token,hub,services,signing,master,output:()=>output}}catch{}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw Error(`maintenance agent did not start: ${output}`);
}

async function request(agent,url,options={}){
  const response=await fetch(agent.base+url,{...options,headers:{"x-maintenance-token":agent.token,...options.headers}});
  const body=await response.json();return {status:response.status,body};
}

async function importArchive(agent,name,bytes){
  return request(agent,"/backup/import",{method:"POST",headers:{"content-type":"application/zip","content-length":String(bytes.length),"x-backup-name":name},body:bytes});
}

test("one full export contains the database, master key, assets, ADB trust, and managed-service state",async t=>{
  const agent=await startAgent(t);
  put(path.join(agent.hub,".env"),"MAINTENANCE_TOKEN=bootstrap-secret\n");
  put(path.join(agent.hub,"data","media","welcome.mp4"),"MEDIA_SENTINEL");
  put(path.join(agent.hub,"data","android-tv","devices.json"),JSON.stringify({version:1,devices:[{id:"display-1",serial:"SERIAL_SENTINEL",agentV2:{token:"DEVICE_TOKEN_SENTINEL"}}]}));
  put(path.join(agent.hub,"data","android-tv",".android","adbkey"),"ADB_KEY_SENTINEL");
  put(path.join(agent.hub,"data","backups","nested.zip"),"NESTED_BACKUP_SENTINEL");
  put(path.join(agent.hub,"data","legacy","old.json"),"LEGACY_SENTINEL");
  put(path.join(agent.hub,"node_modules","cache.bin"),"CACHE_SENTINEL");
  put(path.join(agent.hub,"src","server.js"),"SOURCE_TREE_SENTINEL");
  put(path.join(agent.services,"music-assistant","state.db"),"SERVICE_SENTINEL");
  put(path.join(agent.signing,"android-agent","RoomGoblin-Display-Agent.keystore"),"SIGNING_SENTINEL");
  put(path.join(agent.signing,"android-agent","password"),"SIGNING_PASSWORD_SENTINEL");

  const created=await request(agent,"/backup/create",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scope:"full",confirmSensitiveData:true,confirmSecrets:true})});
  assert.equal(created.status,200,JSON.stringify(created.body));
  assert.equal(created.body.containsSecrets,true);
  assert.match(created.body.sha256,/^[0-9a-f]{64}$/);

  const archivePath=path.join(agent.hub,"data","backups",created.body.name),zip=new AdmZip(archivePath);
  const entries=new Map(zip.getEntries().filter(entry=>!entry.isDirectory).map(entry=>[entry.entryName,entry.getData().toString("utf8")]));
  assert.equal(entries.get("classroom-hub/data/classroom-control-hub.db"),"SQLITE_SNAPSHOT_SENTINEL");
  assert.equal(zip.getEntry("recovery-secrets/classroom-hub-master.key").getData().toString("hex"),"ab".repeat(32));
  assert.equal(entries.get("classroom-hub/data/media/welcome.mp4"),"MEDIA_SENTINEL");
  assert.deepEqual(JSON.parse(entries.get("classroom-hub/data/android-tv/devices.json")),{version:1,devices:[{id:"display-1",serial:"SERIAL_SENTINEL",agentV2:{token:"DEVICE_TOKEN_SENTINEL"}}]});
  assert.equal(entries.get("classroom-hub/data/android-tv/.android/adbkey"),"ADB_KEY_SENTINEL");
  assert.equal(entries.get("services/music-assistant/state.db"),"SERVICE_SENTINEL");
  assert.equal(entries.get("recovery-secrets/android-agent-signing/android-agent/RoomGoblin-Display-Agent.keystore"),"SIGNING_SENTINEL");
  assert.equal([...entries.values()].some(value=>value.includes("NESTED_BACKUP_SENTINEL")||value.includes("LEGACY_SENTINEL")||value.includes("CACHE_SENTINEL")||value.includes("SOURCE_TREE_SENTINEL")),false);
  const manifest=JSON.parse(entries.get("backup-manifest.json"));
  assert.equal(manifest.scope,"full");
  assert.equal(manifest.version,5);
  assert.equal(manifest.databaseSchemaVersion,1);
  assert.equal(manifest.databaseSnapshot,true);
  assert.equal(manifest.requiresMasterKey,true);
  assert.deepEqual(manifest.capabilities,{configuration:true,database:true,data:true,services:true,secrets:true});
  assert.ok(manifest.files.some(file=>file.path==="classroom-hub/data/classroom-control-hub.db"&&file.role==="database"&&/^[0-9a-f]{64}$/.test(file.sha256)));
  assert.ok(manifest.files.some(file=>file.path==="recovery-secrets/classroom-hub-master.key"&&file.role==="master-key"));
  assert.ok(manifest.files.some(file=>file.path==="classroom-hub/data/android-tv/devices.json"&&file.role==="android-inventory"),"transitional managed-device inventory must be declared in the recovery inventory");

  const plan=await request(agent,`/backup/${encodeURIComponent(created.body.name)}/restore-plan`);
  assert.equal(plan.status,200);
  assert.equal(plan.body.plan.hasDatabase,true);
  assert.equal(plan.body.plan.hasMasterKey,true);
  assert.equal(plan.body.plan.containsSensitiveData,true);
  assert.equal(plan.body.plan.restoreModes.includes("full-recovery"),false,"alpha.79 must not advertise incomplete clean-host restoration");
});

test("full export fails closed when either indispensable recovery root is absent",async t=>{
  for(const fixture of [{database:false,masterKey:true,expected:/authoritative RoomGoblin database/},{database:true,masterKey:false,expected:/master encryption key/}]){
    await t.test(fixture.database?"missing master key":"missing database",async t=>{
      const agent=await startAgent(t,fixture);
      const result=await request(agent,"/backup/create",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scope:"full",confirmSensitiveData:true,confirmSecrets:true})});
      assert.equal(result.status,500);
      assert.match(result.body.error,fixture.expected);
      assert.deepEqual(fs.readdirSync(path.join(agent.hub,"data","backups")),[]);
    });
  }
});

test("restore planning rejects archive entries outside the recovery roots",async t=>{
  const agent=await startAgent(t),name="malformed-full.zip",zip=new AdmZip();
  zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify({version:4,scope:"full",capabilities:{database:true,data:true,secrets:true}})));
  zip.addFile("unreviewed-host-file",Buffer.from("must-not-restore"));
  zip.writeZip(path.join(agent.hub,"data","backups",name));
  const result=await request(agent,`/backup/${name}/restore-plan`);
  assert.equal(result.status,400);
  assert.match(result.body.error,/Unexpected restore entry/);
});

test("restore planning detects a file changed after the recovery manifest was created",async t=>{
  const agent=await startAgent(t),name="tampered-full.zip",zip=new AdmZip();
  const original=Buffer.from("ORIGINAL"),file={path:"classroom-hub/data/classroom-control-hub.db",size:original.length,sha256:require("node:crypto").createHash("sha256").update(original).digest("hex"),role:"database",mode:"0600"};
  zip.addFile(file.path,Buffer.from("TAMPERED"));
  zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify({version:5,scope:"full",integrityAlgorithm:"sha256",capabilities:{database:true,data:true,secrets:false},files:[file]})));
  zip.writeZip(path.join(agent.hub,"data","backups",name));
  const result=await request(agent,`/backup/${name}/restore-plan`);
  assert.equal(result.status,400);
  assert.match(result.body.error,/integrity check failed/);
});

test("authenticated import accepts one portable export and removes rejected archives",async t=>{
  const source=await startAgent(t),target=await startAgent(t);
  put(path.join(source.hub,"data","media","portable.txt"),"PORTABLE_STATE");
  const created=await request(source,"/backup/create",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scope:"full",confirmSensitiveData:true,confirmSecrets:true})});
  assert.equal(created.status,200,JSON.stringify(created.body));
  const bytes=fs.readFileSync(path.join(source.hub,"data","backups",created.body.name));
  const imported=await importArchive(target,"portable-full.zip",bytes);
  assert.equal(imported.status,201,JSON.stringify(imported.body));
  assert.equal(imported.body.plan.integrityVerified,true);
  assert.equal(imported.body.plan.hasDatabase,true);
  assert.equal(imported.body.plan.hasMasterKey,true);
  assert.equal(imported.body.plan.fullRecoveryRestorable,false);
  assert.equal(imported.body.plan.restoreModes.includes("full-recovery"),false);
  assert.match(imported.body.sha256,/^[0-9a-f]{64}$/);

  const ordinary=new AdmZip();ordinary.addFile("backup-manifest.json",Buffer.from(JSON.stringify({version:4,scope:"operational",capabilities:{}})));
  const ordinaryRejected=await importArchive(target,"ordinary.zip",ordinary.toBuffer());
  assert.equal(ordinaryRejected.status,400);
  assert.match(ordinaryRejected.body.error,/Only a verified Full Recovery Export/);
  assert.equal(fs.existsSync(path.join(target.hub,"data","backups","ordinary.zip")),false);

  for(const fixture of [
    {name:"extra-path.zip",entries:[["outside-policy.txt","EXTRA"]]},
    {name:"case-collision.zip",entries:[["classroom-hub/data/Asset.bin","A"],["classroom-hub/data/asset.bin","B"]]}
  ]){
    const zip=new AdmZip();
    for(const [name,value] of fixture.entries)zip.addFile(name,Buffer.from(value));
    zip.addFile("backup-manifest.json",Buffer.from(JSON.stringify({version:5,scope:"full",integrityAlgorithm:"sha256",files:[]})));
    const rejected=await importArchive(target,fixture.name,zip.toBuffer());
    assert.equal(rejected.status,400,`${fixture.name}: ${JSON.stringify(rejected.body)}`);
    assert.equal(fs.existsSync(path.join(target.hub,"data","backups",fixture.name)),false,`${fixture.name} must be removed after rejection`);
  }
});

test("configuration-data restore replaces runtime data and verifies application health",async t=>{
  const agent=await startAgent(t);
  put(path.join(agent.hub,"data","media","lesson.txt"),"ORIGINAL_ASSET");
  put(path.join(agent.hub,"data","android-tv",".android","adbkey"),"ARCHIVED_ADB_IDENTITY");
  const created=await request(agent,"/backup/create",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({scope:"operational",confirmSensitiveData:true})});
  assert.equal(created.status,200,JSON.stringify(created.body));

  put(path.join(agent.hub,"data","classroom-control-hub.db"),"MUTATED_DATABASE");
  put(path.join(agent.hub,"data","media","lesson.txt"),"MUTATED_ASSET");
  put(path.join(agent.hub,"data","android-tv",".android","adbkey"),"CURRENT_HOST_ADB_IDENTITY");
  put(path.join(agent.hub,"data","should-disappear.txt"),"TRANSIENT_AFTER_EXPORT");
  const restored=await request(agent,`/backup/${encodeURIComponent(created.body.name)}/restore`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({mode:"configuration-data",confirm:"RESTORE"})});
  assert.equal(restored.status,200,JSON.stringify(restored.body));
  assert.equal(restored.body.healthVerified,true);
  assert.deepEqual(restored.body.restored,["data"]);
  assert.equal(fs.readFileSync(path.join(agent.hub,"data","classroom-control-hub.db"),"utf8"),"SQLITE_SNAPSHOT_SENTINEL");
  assert.equal(fs.readFileSync(path.join(agent.hub,"data","media","lesson.txt"),"utf8"),"ORIGINAL_ASSET");
  assert.equal(fs.readFileSync(path.join(agent.hub,"data","android-tv",".android","adbkey"),"utf8"),"CURRENT_HOST_ADB_IDENTITY","partial data restore must preserve host ADB trust state");
  assert.equal(fs.existsSync(path.join(agent.hub,"data","should-disappear.txt")),false);
  assert.equal(fs.existsSync(path.join(agent.hub,"data","backups",created.body.name)),true,"managed backups survive a data restore");
});
