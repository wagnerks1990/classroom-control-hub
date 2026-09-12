"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const net=require("node:net");
const {spawn,spawnSync}=require("node:child_process");

const ROOT=path.resolve(__dirname,"..");
function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const value=server.address().port;server.close(error=>error?reject(error):resolve(value))})})}
async function jsonRequest(base,pathname,{method="GET",body,headers={}}={}){const response=await fetch(base+pathname,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...headers},body:body===undefined?undefined:JSON.stringify(body)}),text=await response.text();let json;try{json=JSON.parse(text)}catch{json={text}}return {status:response.status,json,text,headers:response.headers}}

test("real application freeze rejects mutations and exact one-use thaw restores writes",async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"roomgoblin-export-freeze-")),keyFile=path.join(temp,"master.key");
  fs.writeFileSync(keyFile,Buffer.from("59".repeat(32),"hex"),{mode:0o600});
  const port=await freePort(),base=`http://127.0.0.1:${port}`;let logs="";
  const child=spawn(process.execPath,["src/server.js"],{cwd:ROOT,env:{...process.env,PORT:String(port),DATA_DIR:temp,DATABASE_FILE:path.join(temp,"hub.db"),MASTER_KEY_FILE:keyFile,SETUP_TOKEN:"freeze-setup-token",MAINTENANCE_TOKEN:"freeze-maintenance-token",CONTROL_TOKEN:"",DISPLAY_TOKEN:"",MQTT_URL:"",MAINTENANCE_PROXY_ENABLED:"false"},stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",chunk=>logs+=chunk);child.stderr.on("data",chunk=>logs+=chunk);
  t.after(async()=>{if(child.exitCode===null){child.kill("SIGTERM");await Promise.race([new Promise(resolve=>child.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);if(child.exitCode===null)child.kill("SIGKILL")}fs.rmSync(temp,{recursive:true,force:true})});
  const deadline=Date.now()+15000;while(Date.now()<deadline){if(child.exitCode!==null)throw Error(`server exited ${child.exitCode}: ${logs}`);try{if((await fetch(base+"/health")).ok)break}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  let result=await jsonRequest(base,"/api/v1/setup/administrator",{method:"POST",body:{username:"admin",password:"correct-horse-battery-staple"},headers:{"x-setup-token":"freeze-setup-token"}});
  assert.equal(result.status,201,result.text);const cookie=String(result.headers.get("set-cookie")||"").split(";")[0],maintenance={"x-maintenance-token":"freeze-maintenance-token"};

  result=await jsonRequest(base,"/api/v1/internal/maintenance/export-freeze",{method:"POST",body:{confirm:"FREEZE_FULL_EXPORT"},headers:maintenance});
  assert.equal(result.status,200,result.text);assert.match(result.json.freezeToken,/^[A-Za-z0-9_-]{40,}$/);const freezeToken=result.json.freezeToken;
  result=await jsonRequest(base,"/api/v1/admin/setup-state",{method:"PUT",body:{completed:true},headers:{cookie}});assert.equal(result.status,423,result.text);
  result=await jsonRequest(base,"/api/v1/internal/maintenance/export-thaw",{method:"POST",body:{freezeToken:`${freezeToken}x`},headers:maintenance});assert.equal(result.status,409,result.text);
  result=await jsonRequest(base,"/api/v1/internal/maintenance/export-thaw",{method:"POST",body:{freezeToken},headers:maintenance});assert.equal(result.status,200,result.text);
  result=await jsonRequest(base,"/api/v1/internal/maintenance/export-thaw",{method:"POST",body:{freezeToken},headers:maintenance});assert.equal(result.status,409,result.text);
  result=await jsonRequest(base,"/api/v1/admin/setup-state",{method:"PUT",body:{completed:true},headers:{cookie}});assert.equal(result.status,200,result.text);
});

test("Host Agent export freeze owns the appliance lock with an exact one-use token",()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"roomgoblin-host-export-freeze-"));
  try{
    const script=`import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('roomgoblin_host',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nx=m.acquire_export_freeze();blocked=False\ntry:m.acquire_export_freeze()\nexcept RuntimeError:blocked=True\nprint(json.dumps({'token':bool(x.get('freezeToken')),'blocked':blocked,'bad':m.release_export_freeze(x['freezeToken']+'x'),'good':m.release_export_freeze(x['freezeToken']),'reused':m.release_export_freeze(x['freezeToken'])}))\n`;
    const result=spawnSync("python3",["-c",script,path.join(ROOT,"host-agent","server.py")],{encoding:"utf8",env:{...process.env,CLASSROOM_HUB_MUTATION_LOCK:path.join(temp,"appliance.lock")}});
    assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()),{token:true,blocked:true,bad:false,good:true,reused:false});
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
