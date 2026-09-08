"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("fs");
const os=require("os");
const path=require("path");
const net=require("net");
const {spawn}=require("node:child_process");
const {DatabaseSync}=require("node:sqlite");

const projectRoot=path.resolve(__dirname,"..");
function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p))})})}
async function wait(url,child){for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(`server exited ${child.exitCode}`);try{const r=await fetch(url+"/health");if(r.ok)return}catch{};await new Promise(r=>setTimeout(r,100))}throw Error("server did not become healthy")}

test("HTTP login preserves punctuation in passwords and startup repairs incomplete administrator capabilities",async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hub-alpha71-"));
  const dbFile=path.join(dir,"classroom-hub.db"),keyFile=path.join(dir,"master.key");
  fs.writeFileSync(keyFile,Buffer.from("22".repeat(32),"hex"),{mode:0o600});
  const p=await port(),base=`http://127.0.0.1:${p}`;
  let child=spawn(process.execPath,["src/startup-recovery.js"],{cwd:projectRoot,env:{...process.env,PORT:String(p),DATA_DIR:dir,DATABASE_FILE:dbFile,MASTER_KEY_FILE:keyFile,SETUP_TOKEN:"setup-alpha71",MAINTENANCE_PROXY_ENABLED:"false",MQTT_URL:"",TRUST_PROXY_HOPS:"0"},stdio:"ignore"});
  try{
    await wait(base,child);
    const password="Symbol!Hash#VLAN27$And&More";
    let response=await fetch(base+"/api/v1/setup/administrator",{method:"POST",headers:{"content-type":"application/json","x-setup-token":"setup-alpha71"},body:JSON.stringify({username:"symbol-admin",displayName:"Symbol Administrator",password})});
    assert.equal(response.status,201,await response.text());
    response=await fetch(base+"/api/v1/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"symbol-admin",password})});
    assert.equal(response.status,200,await response.text());
  }finally{child.kill("SIGTERM");await new Promise(r=>setTimeout(r,250))}

  const db=new DatabaseSync(dbFile);
  const profile=db.prepare("SELECT config_json FROM access_profiles WHERE id='administrator'").get();
  const broken=JSON.parse(profile.config_json);delete broken.capabilities;
  db.prepare("UPDATE access_profiles SET config_json=? WHERE id='administrator'").run(JSON.stringify(broken));
  db.close();

  child=spawn(process.execPath,["src/startup-recovery.js"],{cwd:projectRoot,env:{...process.env,PORT:String(p),DATA_DIR:dir,DATABASE_FILE:dbFile,MASTER_KEY_FILE:keyFile,MAINTENANCE_PROXY_ENABLED:"false",MQTT_URL:"",TRUST_PROXY_HOPS:"0"},stdio:"ignore"});
  try{await wait(base,child)}finally{child.kill("SIGTERM");await new Promise(r=>setTimeout(r,250))}
  const verify=new DatabaseSync(dbFile,{readOnly:true});
  const repaired=JSON.parse(verify.prepare("SELECT config_json FROM access_profiles WHERE id='administrator'").get().config_json);
  verify.close();
  assert.deepEqual(repaired.capabilities,["*"]);
  fs.rmSync(dir,{recursive:true,force:true});
});
