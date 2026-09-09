"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("supported optional integrations can be adopted or Hub-managed",()=>{
  const ext=read("maintenance-agent/extensions.js");
  const host=read("host-agent/start.py");
  const dockerfile=read("maintenance-agent/Dockerfile");
  for(const image of [
    "eclipse-mosquitto:latest",
    "ghcr.io/wez/govee2mqtt:latest",
    "ghcr.io/music-assistant/server:latest"
  ]){
    assert.ok(ext.includes(image),`maintenance add-on catalog missing ${image}`);
    assert.ok(host.includes(image),`Host Agent allowlist missing ${image}`);
  }
  for(const container of ["mosquitto","govee2mqtt","music-assistant-server","veyon-webapi"]){
    assert.ok(host.includes(container),`Host Agent managed container set missing ${container}`);
  }
  assert.match(ext,/Existing container adopted by Classroom Control Hub without recreation/);
  assert.match(ext,/dataPreserved:true/);
  assert.match(ext,/musicassistant[\s\S]*?--network","host"/);
  assert.match(host,/_adopt_existing/);
  assert.match(host,/docker','inspect'/);
  assert.match(dockerfile,/NODE_OPTIONS=--require=\/app\/extensions\.js/);
});

test("native Veyon WebAPI is host-managed but remains fully configurable",()=>{
  const ext=read("maintenance-agent/extensions.js");
  const hostServer=read("host-agent/server.py");
  const hostUnit=read("host-agent/classroom-control-hub-host-agent.service");
  const keySync=read("host-agent/sync-veyon-key.sh");
  const bridge=read("src/maintenance-route-bridge.js");
  const ui=read("public/shared/integration-setup.js");
  assert.match(hostServer,/"veyon\.service"/);
  assert.match(hostServer,/"veyon-webapi\.service"/);
  assert.match(ext,/NATIVE_VEYON_URL="http:\/\/127\.0\.0\.1:11080"/);
  assert.match(ext,/nativeService:"veyon-webapi\.service"/);
  assert.match(ext,/management:"host-managed"/);
  assert.match(ext,/canRemove:false/);
  assert.match(ext,/externalOnly:false/);
  assert.match(ext,/saveVeyonSettings/);
  assert.match(ext,/internal\/maintenance\/integration-connections/);
  assert.match(ui,/keyName\|\|"master"/);
  assert.match(ui,/placeholder:"master"/);
  assert.match(ui,/windowsCredentialPassword/);
  assert.match(ui,/linuxSshCredentialPrivateKey/);
  assert.match(keySync,/VEYON_KEY_NAME:-master/);
  assert.match(keySync,/authkeys export "\$KEY_NAME\/private"/);
  assert.match(keySync,/authkeys export "\$KEY_NAME\/public"/);
  assert.match(hostUnit,/ExecStartPre=\/bin\/bash \/opt\/classroom-hub\/host-agent\/sync-veyon-key\.sh/);
  assert.match(hostUnit,/ReadWritePaths=.*\/etc\/classroom-control-hub/);
  assert.match(bridge,/internal\/maintenance\/veyon\/computers/);
  assert.match(bridge,/internal\/maintenance\/integration-connections/);
});

test("Veyon legacy inventory is migrated into SQLite and active JSON is retired",()=>{
  const startup=read("src/startup-recovery.js");
  const server=read("src/server.js");
  assert.match(startup,/migrateLegacyVeyonInventory/);
  assert.match(startup,/namespace='veyon-computers'/);
  assert.match(startup,/sqlite:object_store\/veyon-computers/);
  assert.match(startup,/fs\.rmSync\(legacy,\{force:true\}\)/);
  assert.match(server,/databaseBackedFile\(file\)/);
  assert.match(server,/VEYON_COMPUTERS_FILE/);
  assert.match(server,/dbStore\.hasSecret\("veyon\.private-key"\)/);
});

test("Music Assistant setup requires a validated long-lived token and exposes guided setup",()=>{
  const ext=read("maintenance-agent/extensions.js");
  const bridge=read("src/maintenance-route-bridge.js");
  const ui=read("public/shared/integration-setup.js");
  const branding=read("public/shared/branding.js");
  assert.doesNotThrow(()=>new Function(ui),"guided integration setup JavaScript must parse");
  assert.match(ext,/Music Assistant access token is required/);
  assert.match(ext,/API authentication failed/);
  assert.match(ext,/setupRequired:true/);
  assert.match(ext,/musicStatus\(\)/);
  assert.match(bridge,/internal\/maintenance\/music-assistant\/config/);
  assert.match(bridge,/internal\/maintenance\/music-assistant\/status/);
  assert.match(ui,/Long-lived access token/);
  assert.match(ui,/Open Music Assistant/);
  assert.match(ui,/Settings → Profile/);
  assert.match(ui,/Save & Verify/);
  assert.match(branding,/integration-setup\.js/);
});

test("setup wizard keeps receiver IDs editable and removes stale group members",()=>{
  const setup=read("public/setup/index.html");
  assert.match(setup,/id="receiverIds"/);
  const receiverTag=setup.match(/<input[^>]+id="receiverIds"[^>]*>/)?.[0]||"";
  assert.doesNotMatch(receiverTag,/\bdisabled\b/);
  assert.match(setup,/function receiverIdList\(\)/);
  assert.match(setup,/unique=\[\.\.\.new Set\(ids\)\]/,"receiver IDs must reject duplicates");
  assert.match(setup,/const allowed=new Set\(ids\)/);
  assert.match(setup,/filter\(id=>allowed\.has\(id\)\)/,"display groups must be pruned to saved receivers");
  assert.match(setup,/groups\.all=\[\.\.\.ids\]/);
});

test("maintenance Compose health does not depend on main application readiness",()=>{
  const compose=read("docker-compose.yml");
  assert.match(compose,/process\.env\.PORT\+\x27\/host\/agent\/health/);
  const maintenance=compose.slice(compose.indexOf("  maintenance-agent:\n"));
  const health=maintenance.slice(maintenance.indexOf("healthcheck:"),maintenance.indexOf("security_opt:"));
  assert.doesNotMatch(health,/\/ready/);
});
