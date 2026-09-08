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
    "ghcr.io/music-assistant/server:latest",
    "veyon/webapi-proxy:latest"
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

test("setup wizard keeps receiver IDs editable and removes stale group members",()=>{
  const setup=read("public/setup/index.html");
  assert.match(setup,/id="receiverIds"/);
  const receiverTag=setup.match(/<input[^>]+id="receiverIds"[^>]*>/)?.[0]||"";
  assert.doesNotMatch(receiverTag,/\bdisabled\b/);
  assert.match(setup,/parseReceiverIds/);
  assert.match(setup,/filter\(id=>keep\[id\]\)/,"display groups must be pruned to saved receivers");
  assert.match(setup,/new Set\(receiverIds\)/,"receiver IDs must reject duplicates");
});

test("maintenance Compose health does not depend on main application readiness",()=>{
  const compose=read("docker-compose.yml");
  assert.match(compose,/3010\/host\/agent\/health/);
  const maintenance=compose.slice(compose.indexOf("maintenance-agent:"));
  const health=maintenance.slice(maintenance.indexOf("healthcheck:"),maintenance.indexOf("security_opt:"));
  assert.doesNotMatch(health,/3010\/ready/);
});
