"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const net=require("node:net");
const {spawn}=require("node:child_process");
const {DatabaseSync}=require("node:sqlite");
const {WebSocket}=require("ws");

const root=path.resolve(__dirname,"..");
let child,base,wsBase,temp,cookie,viewerCookie,logs="";

function port(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once("error",reject);server.listen(0,"127.0.0.1",()=>{const value=server.address().port;server.close(error=>error?reject(error):resolve(value))})})}
async function request(pathname,{method="GET",body,session=cookie}={}){
  const response=await fetch(base+pathname,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(session?{cookie:session}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let json;try{json=JSON.parse(text)}catch{json={text}}return {response,json,text};
}
async function waitForServer(){const deadline=Date.now()+15000;while(Date.now()<deadline){if(child.exitCode!==null)throw Error(`server exited ${child.exitCode}: ${logs}`);try{if((await fetch(base+"/health")).ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}throw Error(`server startup timeout: ${logs}`)}
function displayConnection(){return new Promise((resolve,reject)=>{const ws=new WebSocket(wsBase,{headers:{Origin:base}}),timer=setTimeout(()=>reject(Error("display websocket timeout")),4000);ws.on("open",()=>ws.send(JSON.stringify({type:"hello",role:"display",deviceId:"secure-tv",clientVersion:"1.0.0-alpha.80"})));ws.on("message",raw=>{const message=JSON.parse(String(raw));if(message.type==="hello.ack"){clearTimeout(timer);resolve(ws)}else if(message.type==="error"){clearTimeout(timer);reject(Error(message.error))}});ws.on("error",reject)})}
function browserConnection(role,session){return new Promise((resolve,reject)=>{const ws=new WebSocket(wsBase,{headers:{Origin:base,Cookie:session}}),timer=setTimeout(()=>reject(Error(`${role} websocket timeout`)),4000);ws.on("open",()=>ws.send(JSON.stringify({type:"hello",role,...(role==="preview"?{deviceId:"secure-tv"}:{})})));ws.on("message",raw=>{const message=JSON.parse(String(raw));if(message.type==="hello.ack"){clearTimeout(timer);resolve({ws,ack:message})}else if(message.type==="error"){clearTimeout(timer);reject(Error(message.error))}});ws.on("error",reject)})}
function nextWebCommand(ws){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("announcement command timeout")),5000);const onMessage=raw=>{const message=JSON.parse(String(raw));if(message.type==="command"&&message.command?.type==="display.web"){clearTimeout(timer);ws.off("message",onMessage);resolve(message.command)}};ws.on("message",onMessage)})}
function nextControllerCommand(ws){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("controller command timeout")),5000);const onMessage=raw=>{const message=JSON.parse(String(raw));if(message.type==="command.executed"&&message.command?.type==="display.web"){clearTimeout(timer);ws.off("message",onMessage);resolve(message)}};ws.on("message",onMessage)})}

test.before(async()=>{
  temp=fs.mkdtempSync(path.join(os.tmpdir(),"roomgoblin-secret-projection-"));
  const keyFile=path.join(temp,"master.key");fs.writeFileSync(keyFile,Buffer.from("42".repeat(32),"hex"),{mode:0o600});
  const listenPort=await port();base=`http://127.0.0.1:${listenPort}`;wsBase=`ws://127.0.0.1:${listenPort}/ws`;
  child=spawn(process.execPath,["src/server.js"],{cwd:root,env:{...process.env,PORT:String(listenPort),DATA_DIR:temp,DATABASE_FILE:path.join(temp,"hub.db"),MASTER_KEY_FILE:keyFile,SETUP_TOKEN:"setup-secret",CONTROL_TOKEN:"",DISPLAY_TOKEN:"",MAINTENANCE_PROXY_ENABLED:"false",MAINTENANCE_TOKEN:"maintenance-secret",MQTT_URL:"",DISPLAY_GATEWAY_ALLOWED_HOSTS:"media.example.test"},stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",chunk=>{logs+=chunk});child.stderr.on("data",chunk=>{logs+=chunk});await waitForServer();
  let result=await request("/api/v1/setup/administrator",{method:"POST",session:"",body:{username:"admin",password:"correct-horse-battery-staple"}});
  // Repeat with the one-use header through a direct fetch because the helper is
  // intentionally limited to ordinary authenticated requests.
  if(result.response.status!==201){
    const response=await fetch(base+"/api/v1/setup/administrator",{method:"POST",headers:{"content-type":"application/json","x-setup-token":"setup-secret"},body:JSON.stringify({username:"admin",password:"correct-horse-battery-staple"})});
    const text=await response.text();assert.equal(response.status,201,text);cookie=String(response.headers.get("set-cookie")||"").split(";")[0];
  }else cookie=String(result.response.headers.get("set-cookie")||"").split(";")[0];
  result=await request("/api/v1/admin/displays",{method:"PUT",body:{devices:{"secure-tv":{name:"Secure TV",enabled:true}},displayGroups:{}}});assert.equal(result.response.status,200,result.text);
  result=await request("/api/v1/admin/users",{method:"POST",body:{username:"viewer",displayName:"Viewer",role:"viewer",profileId:"read-only",password:"viewer-password-123",enabled:true}});assert.equal(result.response.status,200,result.text);
  result=await request("/api/v1/auth/login",{method:"POST",session:"",body:{username:"viewer",password:"viewer-password-123"}});assert.equal(result.response.status,200,result.text);viewerCookie=String(result.response.headers.get("set-cookie")||"").split(";")[0];
});

test.after(async()=>{if(child&&child.exitCode===null){child.kill("SIGTERM");await Promise.race([new Promise(resolve=>child.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,2000))]);if(child.exitCode===null)child.kill("SIGKILL")}if(temp)fs.rmSync(temp,{recursive:true,force:true})});

test("announcement bearer URL is encrypted, redacted from browser projections, and retained for physical playback",async()=>{
  const token="ANNOUNCEMENT_TOKEN_SENTINEL_91af";
  const subscriber="SUBSCRIBER_CODE_SENTINEL_2bd1";
  const streamUrl=`https://media.example.test/WebRTCApp/play.html?id=morning&token=${token}&subscriberCode=${subscriber}`;
  let result=await request("/api/v1/automations/morning-announcements",{method:"PUT",body:{enabled:true,streamUrl,startTime:"07:00",endTime:"08:30",targets:["all"]}});
  assert.equal(result.response.status,200,result.text);assert.equal(result.json.config.streamUrl,"••••••••");assert.equal(result.json.config.streamUrlConfigured,true);assert.doesNotMatch(result.text,new RegExp(`${token}|${subscriber}`));

  // Saving the redacted sentinel must preserve the encrypted URL.
  result=await request("/api/v1/automations/morning-announcements",{method:"PUT",body:{...result.json.config,volumePercent:67}});assert.equal(result.response.status,200,result.text);
  const display=await displayConnection(),controller=(await browserConnection("controller",cookie)).ws;const delivered=nextWebCommand(display),controllerEvent=nextControllerCommand(controller);
  result=await request("/api/v1/automations/morning-announcements/start",{method:"POST",body:{targets:["secure-tv"]}});assert.equal(result.response.status,200,result.text);assert.doesNotMatch(result.text,new RegExp(`${token}|${subscriber}`));
  const command=await delivered;assert.match(command.payload.url,new RegExp(token));assert.match(command.payload.url,new RegExp(subscriber));
  const event=await controllerEvent;assert.doesNotMatch(JSON.stringify(event),new RegExp(`${token}|${subscriber}`));controller.close();display.close();

  const preview=await browserConnection("preview",viewerCookie);assert.doesNotMatch(JSON.stringify(preview.ack),new RegExp(`${token}|${subscriber}`));preview.ws.close();

  for(const pathname of ["/api/v1/automations/morning-announcements","/api/v1/status","/api/v1/devices/secure-tv"]){result=await request(pathname,{session:viewerCookie});assert.equal(result.response.status,200,result.text);assert.doesNotMatch(result.text,new RegExp(`${token}|${subscriber}`),pathname)}
  const db=new DatabaseSync(path.join(temp,"hub.db"));
  const stored=db.prepare("SELECT value_json FROM object_store WHERE namespace IN ('morning-announcements','state') ORDER BY namespace").all();
  const secret=db.prepare("SELECT cipher_text FROM secret_store WHERE name='automation.morning-announcements.stream-url'").get();
  assert.ok(secret?.cipher_text);assert.doesNotMatch(JSON.stringify(stored),new RegExp(`${token}|${subscriber}`));assert.doesNotMatch(secret.cipher_text,new RegExp(`${token}|${subscriber}`));db.close();
});

test("failed command secrets are redacted before audit persistence and every read projection",async()=>{
  const secret="FAILED_COMMAND_SECRET_87ca";
  let result=await request("/api/v1/commands",{method:"POST",body:{type:"display.web",target:"missing-display",payload:{url:`https://media.example.test/private?token=${secret}&signature=${secret}`}}});assert.equal(result.response.status,400,result.text);
  for(const [pathname,session] of [["/api/v1/events",viewerCookie],["/api/v1/diagnostics/events",cookie],["/api/v1/database/audit",cookie],["/api/v1/diagnostics/export",cookie]]){result=await request(pathname,{session});assert.equal(result.response.status,200,result.text);assert.doesNotMatch(result.text,new RegExp(secret),pathname)}
  const db=new DatabaseSync(path.join(temp,"hub.db"));const rows=db.prepare("SELECT payload_json FROM audit_events").all();assert.doesNotMatch(JSON.stringify(rows),new RegExp(secret));db.close();
});

test("MQTT endpoint logging uses the endpoint-only projection",()=>{
  const source=fs.readFileSync(path.join(root,"src/server.js"),"utf8");
  assert.match(source,/console\.log\("MQTT connected:", endpointForLog\(MQTT_URL\)\)/);
  assert.match(source,/console\.log\(`MQTT: \$\{endpointForLog\(MQTT_URL\)/);
  assert.doesNotMatch(source,/console\.log\("MQTT connected:", MQTT_URL\)/);
});

test("startup migrates and scrubs a legacy plaintext announcement URL",async()=>{
  const legacyDir=fs.mkdtempSync(path.join(os.tmpdir(),"roomgoblin-legacy-announcement-"));
  const legacySecret="LEGACY_STREAM_SECRET_c12e",legacyUrl=`https://media.example.test/play?id=legacy&token=${legacySecret}`;
  const keyFile=path.join(legacyDir,"master.key"),legacyFile=path.join(legacyDir,"morning-announcements.json");
  fs.writeFileSync(keyFile,Buffer.from("73".repeat(32),"hex"),{mode:0o600});
  fs.writeFileSync(legacyFile,JSON.stringify({enabled:false,streamUrl:legacyUrl,startTime:"07:00",endTime:"08:30",targets:["all"]}),{mode:0o600});
  const listenPort=await port(),legacyBase=`http://127.0.0.1:${listenPort}`;
  let output="";const processUnderTest=spawn(process.execPath,["src/server.js"],{cwd:root,env:{...process.env,PORT:String(listenPort),DATA_DIR:legacyDir,DATABASE_FILE:path.join(legacyDir,"hub.db"),MASTER_KEY_FILE:keyFile,SETUP_TOKEN:"setup-secret",CONTROL_TOKEN:"",DISPLAY_TOKEN:"",MAINTENANCE_PROXY_ENABLED:"false",MAINTENANCE_TOKEN:"maintenance-secret",MQTT_URL:"",DISPLAY_GATEWAY_ALLOWED_HOSTS:"media.example.test"},stdio:["ignore","pipe","pipe"]});
  processUnderTest.stdout.on("data",chunk=>{output+=chunk});processUnderTest.stderr.on("data",chunk=>{output+=chunk});
  const deadline=Date.now()+15000;let ready=false;while(Date.now()<deadline){if(processUnderTest.exitCode!==null)break;try{if((await fetch(legacyBase+"/health")).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}assert.equal(ready,true,output);
  processUnderTest.kill("SIGTERM");await Promise.race([new Promise(resolve=>processUnderTest.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,2500))]);if(processUnderTest.exitCode===null)processUnderTest.kill("SIGKILL");
  assert.doesNotMatch(fs.readFileSync(legacyFile,"utf8"),new RegExp(legacySecret));
  const db=new DatabaseSync(path.join(legacyDir,"hub.db"));
  const stored=db.prepare("SELECT value_json FROM object_store WHERE namespace='morning-announcements'").get(),encrypted=db.prepare("SELECT cipher_text FROM secret_store WHERE name='automation.morning-announcements.stream-url'").get();
  assert.ok(stored?.value_json);assert.doesNotMatch(stored.value_json,new RegExp(legacySecret));assert.ok(encrypted?.cipher_text);assert.doesNotMatch(encrypted.cipher_text,new RegExp(legacySecret));db.close();
  fs.rmSync(legacyDir,{recursive:true,force:true});
});
