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

const projectRoot=path.resolve(__dirname,"..");
let child,baseUrl,wsUrl,cookie,tempDir,logs="";

function availablePort(){
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const port=server.address().port;
      server.close(err=>err?reject(err):resolve(port));
    });
  });
}

async function request(urlPath,{method="GET",body,authenticated=false,headers={}}={}){
  const response=await fetch(baseUrl+urlPath,{
    method,
    headers:{...(body===undefined?{}:{"content-type":"application/json"}),...(authenticated&&cookie?{cookie}:{}),...headers},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const text=await response.text();
  let json;try{json=JSON.parse(text)}catch{json={text}}
  return {response,json};
}

async function waitForServer(){
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`Server exited early (${child.exitCode})\n${logs}`);
    try{const response=await fetch(baseUrl+"/health");if(response.ok)return}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Timed out waiting for server\n${logs}`);
}

test.before(async()=>{
  tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"classroom-hub-test-"));
  const keyFile=path.join(tempDir,"master.key");
  fs.writeFileSync(keyFile,Buffer.from("11".repeat(32),"hex"),{mode:0o600});
  const port=await availablePort();
  baseUrl=`http://127.0.0.1:${port}`;
  wsUrl=`ws://127.0.0.1:${port}/ws`;
  child=spawn(process.execPath,["src/server.js"],{
    cwd:projectRoot,
    env:{...process.env,PORT:String(port),DATA_DIR:tempDir,DATABASE_FILE:path.join(tempDir,"hub.db"),MASTER_KEY_FILE:keyFile,SETUP_TOKEN:"test-setup-secret",DISPLAY_TOKEN:"test-display-secret",CONTROL_TOKEN:"",MAINTENANCE_TOKEN:"test-maintenance-secret",MAINTENANCE_PROXY_ENABLED:"false",SESSION_PARTICIPATION_ENABLED:"false",MQTT_URL:"",TRUST_PROXY_HOPS:"0"},
    stdio:["ignore","pipe","pipe"]
  });
  child.stdout.on("data",chunk=>{logs+=chunk});
  child.stderr.on("data",chunk=>{logs+=chunk});
  await waitForServer();
});

test.after(async()=>{
  if(child&&child.exitCode===null){
    child.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve=>child.once("exit",resolve)),
      new Promise(resolve=>setTimeout(resolve,2000))
    ]);
    if(child.exitCode===null)child.kill("SIGKILL");
  }
  if(tempDir)fs.rmSync(tempDir,{recursive:true,force:true});
});

test("fresh appliance fails closed and requires the one-use setup token",async()=>{
  let result=await request("/api/v1/admin/config");
  assert.ok([401,403].includes(result.response.status));

  result=await request("/api/v1/setup/administrator",{method:"POST",body:{username:"admin",password:"correct-horse-battery-staple"}});
  assert.equal(result.response.status,403);

  result=await request("/api/v1/setup/administrator",{method:"POST",headers:{"x-setup-token":"test-setup-secret"},body:{username:"admin",displayName:"Administrator",password:"correct-horse-battery-staple",enableAuth:false}});
  assert.equal(result.response.status,201);
  assert.equal(result.json.authEnabled,true);
  cookie=String(result.response.headers.get("set-cookie")||"").split(";")[0];
  assert.match(cookie,/^classroom_hub_session=/);

  result=await request("/api/v1/setup/administrator",{method:"POST",headers:{"x-setup-token":"test-setup-secret"},body:{username:"second",password:"correct-horse-battery-staple"}});
  assert.equal(result.response.status,409);
});

test("authentication cannot be disabled and privileged maintenance is off by default",async()=>{
  let result=await request("/api/v1/admin/auth",{method:"PUT",authenticated:true,body:{enabled:false}});
  assert.equal(result.response.status,400);

  result=await request("/api/v1/maintenance/system",{authenticated:true});
  assert.equal(result.response.status,503);
});

test("sensitive diagnostics and participation endpoints reject anonymous access",async()=>{
  let result=await request("/api/v1/diagnostics/export");
  assert.ok([401,403].includes(result.response.status));

  result=await request("/api/v1/lab/computers/example/history");
  assert.ok([401,403].includes(result.response.status));

  result=await request("/api/v1/sessions/arbitrary-session");
  assert.equal(result.response.status,503);
});

test("class schedule duplication is registered before any delete request",async()=>{
  let result=await request("/api/v1/class-schedules",{method:"POST",authenticated:true,body:{name:"Test class",startTime:"08:00",endTime:"09:00",scheduleMode:"weekly",days:[1]}});
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  const id=result.json.classSchedule.id;

  result=await request(`/api/v1/class-schedules/${encodeURIComponent(id)}/duplicate`,{method:"POST",authenticated:true,body:{name:"Test class copy"}});
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  assert.notEqual(result.json.classSchedule.id,id);
});

test("automation action IDs are scoped to their parent automation",async()=>{
  const make=name=>({name,time:"08:00",action:"display.clear",targets:["all"],actions:[{id:"step-1",action:"display.clear"}]});
  const first=await request("/api/v1/automations",{method:"POST",authenticated:true,body:make("First")});
  const second=await request("/api/v1/automations",{method:"POST",authenticated:true,body:make("Second")});
  assert.equal(first.response.status,200,JSON.stringify(first.json));
  assert.equal(second.response.status,200,JSON.stringify(second.json));
  assert.notEqual(first.json.event.actions[0].id,second.json.event.actions[0].id);
});

test("valid Pluto schedule times are preserved",async()=>{
  const result=await request("/api/v1/pluto/schedules",{method:"POST",authenticated:true,body:{schedules:{"hdmi:1":{enabled:true,onTime:"07:45",offTime:"16:15",days:[1,2,3,4,5]}}}});
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  assert.equal(result.json.schedules["hdmi:1"].onTime,"07:45");
  assert.equal(result.json.schedules["hdmi:1"].offTime,"16:15");
});

test("controller WebSocket rejects role claims without an authenticated session",async()=>{
  await new Promise((resolve,reject)=>{
    const ws=new WebSocket(wsUrl,{headers:{Origin:baseUrl}});
    const timeout=setTimeout(()=>{ws.terminate();reject(new Error("Unauthenticated WebSocket was not rejected"))},3000);
    ws.on("open",()=>ws.send(JSON.stringify({type:"hello",role:"admin",token:""})));
    ws.on("message",raw=>{const msg=JSON.parse(String(raw));if(msg.type==="hello.ack"){clearTimeout(timeout);ws.terminate();reject(new Error("Unauthenticated admin role was accepted"))}});
    ws.on("close",code=>{clearTimeout(timeout);try{assert.equal(code,1008);resolve()}catch(err){reject(err)}});
    ws.on("error",()=>{});
  });
});

test("authenticated administrator WebSocket is accepted",async()=>{
  await new Promise((resolve,reject)=>{
    const ws=new WebSocket(wsUrl,{headers:{Origin:baseUrl,Cookie:cookie}});
    const timeout=setTimeout(()=>{ws.terminate();reject(new Error("Authenticated WebSocket timed out"))},3000);
    ws.on("open",()=>ws.send(JSON.stringify({type:"hello",role:"admin"})));
    ws.on("message",raw=>{const msg=JSON.parse(String(raw));if(msg.type==="hello.ack"){clearTimeout(timeout);assert.equal(msg.role,"admin");ws.close();resolve()}else if(msg.type==="error"){clearTimeout(timeout);ws.terminate();reject(new Error(msg.error))}});
    ws.on("error",reject);
  });
});

test("Kyle Wagner attribution is installed on every current site surface",()=>{
  const surfaces=[
    "public/controller/index.html","public/controller/display.html","public/controller/lab.html",
    "public/controller/veyon.html","public/display/index.html","public/setup/index.html",
    "public/schoology/index.html","public/document-viewer/index.html","public/antmedia-player/index.html"
  ];
  for(const file of surfaces){
    const html=fs.readFileSync(path.join(projectRoot,file),"utf8");
    assert.ok(html.includes("data-kyle-attribution")||html.includes("/shared/attribution.js"),`${file} is missing shared attribution`);
  }
  const component=fs.readFileSync(path.join(projectRoot,"public/shared/attribution.js"),"utf8");
  assert.match(component,/Built by/);
  assert.match(component,/https:\/\/github\.com\/wagnerks1990/);
  assert.match(component,/Kyle Wagner/);
  assert.match(component,/\/shared\/branding\.js/);
  for(const file of surfaces){
    const html=fs.readFileSync(path.join(projectRoot,file),"utf8");
    assert.ok(html.includes("/shared/branding.js")||html.includes("/shared/attribution.js"),`${file} cannot load shared branding`);
  }
});

test("school branding is public, database-backed, validated, and contains no secrets",async()=>{
  let result=await request("/api/v1/branding");
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  assert.equal(result.json.branding.productName,"Classroom Control Hub");
  assert.equal(result.json.branding.room,"Classroom");

  result=await request("/api/v1/admin/site",{method:"PUT",authenticated:true,body:{school:"Example School District",room:"Technology Classroom",productName:"Technology Classroom Hub",logoUrl:"/media/brand/logo.svg",faviconUrl:"https://assets.example.test/icon.png",displayPrefix:"TV",timezone:"America/New_York",theme:{mode:"dark",primary:"#123456",accent:"#654321",background:"#101820",surface:"#182630",text:"#fefefe"}}});
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  assert.equal(result.json.site.school,"Example School District");
  assert.equal(result.json.site.room,"Technology Classroom");
  assert.ok(result.json.site.revision>=1);
  assert.equal("organizationName" in result.json.site,false);
  assert.equal("siteName" in result.json.site,false);
  assert.equal("spaceName" in result.json.site,false);

  result=await request("/api/v1/branding");
  assert.equal(result.json.branding.productName,"Technology Classroom Hub");
  assert.equal(result.json.branding.theme.primary,"#123456");
  assert.equal(JSON.stringify(result.json).includes("preferences"),false);
  assert.equal("organizationName" in result.json.branding,false);
  assert.equal("siteName" in result.json.branding,false);
  assert.equal("spaceName" in result.json.branding,false);
  assert.equal("terminology" in result.json.branding,false);

  result=await request("/api/v1/admin/site",{method:"PUT",authenticated:true,body:{theme:{primary:"red"}}});
  assert.equal(result.response.status,400);
  result=await request("/api/v1/admin/site",{method:"PUT",authenticated:true,body:{logoUrl:"javascript:alert(1)"}});
  assert.equal(result.response.status,400);
});

test("maintenance database API is token-bound and keeps secrets masked by default",async()=>{
  let result=await request("/api/v1/internal/maintenance/status");
  assert.equal(result.response.status,401);

  const agentHeaders={"x-maintenance-token":"test-maintenance-secret"};
  result=await request("/api/v1/internal/maintenance/status",{headers:agentHeaders});
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  assert.ok(result.json.database.schemaVersion>=1);

  result=await request("/api/v1/internal/maintenance/integrations/govee2mqtt",{method:"PUT",headers:agentHeaders,body:{settings:{mqttHost:"127.0.0.1",apiKey:"super-secret"}}});
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  assert.equal(result.json.config.apiKey,"••••••••");
  assert.equal(result.json.resolved.apiKey,"super-secret");

  result=await request("/api/v1/internal/maintenance/integrations",{headers:agentHeaders});
  assert.equal(result.json.integrations.modules.govee2mqtt.apiKey,"••••••••");
});

test("classroom integration connections are GUI-managed, database-backed, and secret-safe",async()=>{
  const mqttPassword="mqtt-regression-secret",veyonKey="-----BEGIN PRIVATE KEY-----\nregression-only\n-----END PRIVATE KEY-----";
  let result=await request("/api/v1/admin/integration-connections",{method:"PUT",authenticated:true,body:{mqtt:{url:"",username:"classroom-hub",password:mqttPassword,jsonBridge:true,legacyBridge:false},pluto:{url:"http://192.0.2.20/cgi-bin/instr",timeoutMs:5500,readRetries:3},veyon:{url:"http://host.docker.internal:11080",keyName:"ClassroomControlHub",privateKey:veyonKey,scanSubnet:"192.0.2",scanStart:20,scanEnd:39,poolMax:18,authRetries:1,thumbnailConcurrency:6}}});
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  assert.equal(result.json.applied,true);
  assert.equal(result.json.integrationConnections.mqtt.passwordConfigured,true);
  assert.equal(result.json.integrationConnections.veyon.privateKeyConfigured,true);
  assert.equal(result.json.integrationConnections.pluto.timeoutMs,5500);
  assert.equal(result.json.integrationConnections.veyon.scanSubnet,"192.0.2");
  assert.equal(JSON.stringify(result.json).includes(mqttPassword),false);
  assert.equal(JSON.stringify(result.json).includes("regression-only"),false);

  result=await request("/api/v1/admin/config",{authenticated:true});
  assert.equal(result.json.integrationConnections.mqtt.username,"classroom-hub");
  assert.equal(result.json.integrationConnections.mqtt.legacyBridge,false);
  assert.equal(result.json.integrationConnections.veyon.poolMax,18);
  const db=new DatabaseSync(path.join(tempDir,"hub.db"),{readOnly:true});
  const stored=JSON.parse(db.prepare("SELECT value_json FROM system_preferences WHERE key='integrations.connections'").get().value_json);
  const encrypted=db.prepare("SELECT cipher_text FROM secret_store WHERE name='integration.mqtt.password'").get().cipher_text;
  db.close();
  assert.equal(stored.pluto.url,"http://192.0.2.20/cgi-bin/instr");
  assert.equal(JSON.stringify(stored).includes(mqttPassword),false);
  assert.equal(encrypted.includes(mqttPassword),false);

  result=await request("/api/v1/admin/integration-connections",{method:"PUT",authenticated:true,body:{mqtt:{url:"mqtt://user:secret@example.test:1883"}}});
  assert.equal(result.response.status,400);
  result=await request("/api/v1/admin/integration-connections",{method:"PUT",authenticated:true,body:{veyon:{scanSubnet:"not-a-subnet"}}});
  assert.equal(result.response.status,400);
});

test("maintenance agent does not own SQLite and restore includes verified rollback",()=>{
  const source=fs.readFileSync(path.join(projectRoot,"maintenance-agent/server.js"),"utf8");
  assert.doesNotMatch(source,/ClassroomHubStorage|\bdbStore\b/);
  assert.match(source,/MANAGED_APP_CONTAINER\|\|"classroom-control-hub"/);
  assert.match(source,/PRAGMA quick_check/);
  assert.match(source,/rollback\.attempted=true/);
  assert.match(source,/waitForMainApplication/);
});

test("application update policy and GitHub token are stored in the database",async()=>{
  let result=await request("/api/v1/admin/app-updates/settings",{authenticated:true});
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  assert.equal(result.json.settings.repository,"wagnerks1990/classroom-control-hub");
  assert.equal(result.json.settings.automatic,false);

  result=await request("/api/v1/admin/app-updates/settings",{method:"PUT",authenticated:true,body:{repository:"example/general-control-hub",channel:"stable",automatic:true,checkIntervalHours:12,maintenanceStart:"01:30",maintenanceEnd:"03:00",token:"github-test-token"}});
  assert.equal(result.response.status,200,JSON.stringify(result.json));
  assert.equal(result.json.tokenConfigured,true);
  assert.equal(result.json.settings.channel,"stable");
  assert.equal(result.json.settings.automatic,true);
  assert.equal(JSON.stringify(result.json).includes("github-test-token"),false);
});

test("verified application updater has a durable host job and GUI rollback controls",()=>{
  const host=fs.readFileSync(path.join(projectRoot,"host-agent/server.py"),"utf8");
  const runner=fs.readFileSync(path.join(projectRoot,"host-agent/app-update-runner.sh"),"utf8");
  const controller=fs.readFileSync(path.join(projectRoot,"public/controller/index.html"),"utf8");
  assert.match(host,/app-updates\/start/);
  assert.match(host,/REVERT_RELEASE/);
  assert.match(runner,/git fetch --force --prune --tags origin/);
  assert.match(runner,/Only semantic-version release tags are accepted/);
  assert.match(runner,/restore_safety_backup/);
  assert.match(controller,/Revert Last Upgrade/);
  assert.match(controller,/Automatically install approved releases/);
  assert.doesNotMatch(controller,/Upload a Classroom Control Hub release ZIP/);
});

test("one-command deployment bootstraps a guarded appliance with unique credentials",()=>{
  const bootstrap=fs.readFileSync(path.join(projectRoot,"deploy/bootstrap.sh"),"utf8");
  const installer=fs.readFileSync(path.join(projectRoot,"install.sh"),"utf8");
  const compose=fs.readFileSync(path.join(projectRoot,"docker-compose.yml"),"utf8");
  assert.match(bootstrap,/Ubuntu Server 24\.04 LTS/);
  assert.match(bootstrap,/download\.docker\.com/);
  assert.match(bootstrap,/signed-by=\/etc\/apt\/keyrings\/docker\.asc/);
  assert.match(bootstrap,/mktemp -d/);
  assert.match(bootstrap,/git clone/);
  assert.match(bootstrap,/CLASSROOM_HUB_REINSTALL/);
  assert.doesNotMatch(bootstrap,/curl[^\n]*\|\s*(?:ba)?sh/);
  for(const name of ["SETUP_TOKEN","CONTROL_TOKEN","DISPLAY_TOKEN","LAB_AGENT_TOKEN","MAINTENANCE_TOKEN"]){
    assert.match(installer,new RegExp(`ensure_secret ${name}`));
  }
  assert.match(installer,/SOURCE_REAL.*TARGET_REAL/);
  assert.match(installer,/First-time setup:/);
  assert.match(compose,/LAB_AGENT_TOKEN:/);
});
