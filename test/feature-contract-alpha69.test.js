"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

function quotedValues(source){
  return [...source.matchAll(/["']([^"']+)["']/g)].map(match=>match[1]);
}

function routeRegistration(source,method,route){
  const escaped=route.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const match=source.match(new RegExp(`app\\.${method}\\(\\s*["']${escaped}["']\\s*,\\s*([^,\\n]+)`));
  assert.ok(match,`${method.toUpperCase()} ${route} is not registered`);
  return match[1].trim();
}

test("Windows agent implements and declares every server-advertised action",()=>{
  const server=read("src/server.js");
  const agent=read("public/lab-agent/ClassroomHubAgent.ps1");
  const allowed=server.match(/const\s+LAB_ALLOWED_ACTIONS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(allowed,"LAB_ALLOWED_ACTIONS must remain an explicit auditable set");

  const advertised=new Set(quotedValues(allowed[1]));
  const commandBody=agent.match(/function\s+Invoke-AgentCommand\b[\s\S]*?switch\(\[string\]\$Command\.action\)\s*\{([\s\S]*?)\n\s*\}\s*catch\s*\{/);
  assert.ok(commandBody,"Windows agent command dispatcher was not found");
  const implemented=new Set([...commandBody[1].matchAll(/^\s*'([^']+)'\s*\{/gm)].map(match=>match[1]));
  const missing=[...advertised].filter(action=>!implemented.has(action));
  assert.deepEqual(missing,[],`Server advertises Windows actions that the shipped agent cannot execute: ${missing.join(", ")}`);

  assert.match(agent,/\$(?:SupportedActions|AgentCapabilities)\s*=/,"Windows agent must maintain an explicit capability declaration");
  assert.match(agent,/type='hello'[\s\S]{0,500}(?:supportedActions|capabilities)\s*=/,"Windows agent hello must report its supported actions/capabilities");
});

test("release version converges across independently deployed runtime surfaces",()=>{
  const version=read("VERSION").trim();
  assert.match(version,/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(require(path.join(root,"package.json")).version,version);
  assert.equal(require(path.join(root,"maintenance-agent","package.json")).version,version);

  const surfaces=[
    "maintenance-agent/server.js",
    "host-agent/server.py",
    "public/lab-agent/ClassroomHubAgent.ps1",
    "public/controller/app.js",
    "public/display/index.html"
  ];
  const releasePattern=/\b\d+\.\d+\.\d+-alpha\.\d+\b/g;
  for(const file of surfaces){
    const found=[...new Set(read(file).match(releasePattern)||[])];
    assert.ok(found.length,`${file} must expose the release version or load it from VERSION`);
    assert.deepEqual(found,[version],`${file} contains a stale or divergent release version`);
  }

  // Historical changelog entries and protocol compatibility fixtures may
  // legitimately mention older releases. Current-baseline documentation may not.
  for(const file of ["AGENTS.md","README.md","docs/AI-CONTEXT.md","docs/DEVELOPMENT.md","wiki/Home.md","wiki/Development.md"]){
    const found=[...new Set(read(file).match(releasePattern)||[])];
    assert.deepEqual(found,[version],`${file} contains a stale current-baseline version`);
  }
});

test("runtime source contains no classroom-specific identity or missing legacy lesson assets",()=>{
  const files=[
    "src/server.js",
    "public/controller/index.html",
    "public/controller/app.js",
    "public/antmedia-player/index.html"
  ];
  const forbidden=[
    /\bHerdTV\b/i,
    /\bMr\.\s*Wagner\b/i,
    /\bL-127\b/i,
    /opening-day\/it1/i,
    /\bit1-opening\b/i
  ];
  for(const file of files){
    const source=read(file);
    for(const pattern of forbidden)assert.equal(pattern.test(source),false,`${file} contains deployment-specific classroom content (${pattern})`);
  }
});

test("generated browser action arguments are encoded before entering inline handlers",()=>{
  const files=fs.readdirSync(path.join(root,"public","controller"))
    .filter(file=>file.endsWith(".js")||file.endsWith(".html"))
    .map(file=>`public/controller/${file}`);
  const unsafe=/\bon(?:click|change|input|submit|load|error)\s*=\s*["'][^"']*\$\{(?!inlineJsArg\(|jsArg\()[^}]*(?:\.(?:id|name|url|username|storedName)|esc\(|String\()/gi;
  for(const file of files){
    unsafe.lastIndex=0;
    assert.equal(unsafe.test(read(file)),false,`${file} interpolates unencoded runtime data into an inline event handler`);
  }
  const controller=read("public/controller/app.js"),lab=read("public/controller/lab.html");
  assert.match(controller,/function inlineJsArg\(v\)\{return `decodeInlineValue\('\$\{encodeInlineValue\(v\)\}'\)`\}/);
  assert.match(lab,/const jsArg=value=>`decodeInlineValue\('\$\{encodeInlineValue\(value\)\}'\)`/);
  assert.doesNotMatch(controller,/inlineJsArg\(v\)\{return esc\(JSON\.stringify/);
  assert.doesNotMatch(lab,/jsArg=value=>esc\(JSON\.stringify/);
});

test("student-sensitive and diagnostic routes use explicit authorization boundaries",()=>{
  const source=read("src/server.js");
  const capabilityRoutes=[
    ["get","/api/v1/diagnostics","diagnostics.read"],
    ["get","/api/v1/diagnostics/events","diagnostics.read"],
    ["post","/api/v1/diagnostics/test","diagnostics.run"],
    ["get","/api/v1/lab/computers/:id/history","lab.sensitive.read"],
    ["get","/api/v1/lab/computers/:id/history/export","lab.sensitive.read"],
    ["get","/api/v1/lab/computers/:id/screenshot","lab.sensitive.read"],
    ["get","/api/v1/lab/computers/:id/screenshot/download","lab.sensitive.read"],
    ["get","/api/v1/lab/computers/:id/screenshots","lab.sensitive.read"],
    ["get","/api/v1/lab/computers/:id/screenshots/file","lab.sensitive.read"],
    ["get","/api/v1/lab/computers/:id/screenshots/download","lab.sensitive.read"],
    ["get","/api/v1/lab/ai-monitor","lab.sensitive.read"]
  ];
  for(const [method,route,capability] of capabilityRoutes){
    assert.equal(routeRegistration(source,method,route),`requireCapability("${capability}")`,`${method.toUpperCase()} ${route} must require ${capability}`);
  }

  for(const route of ["/api/v1/database/status","/api/v1/database/schema","/api/v1/database/telemetry","/api/v1/database/audit","/api/v1/diagnostics/export"]){
    assert.equal(routeRegistration(source,"get",route),"requireAdmin",`GET ${route} must remain administrator-only`);
  }
});

test("health endpoints distinguish liveness from dependency readiness",()=>{
  const main=read("src/server.js");
  const maintenance=read("maintenance-agent/server.js");
  const mainHealth=main.match(/app\.get\(["']\/health["'][\s\S]*?\n\}\);/);
  assert.ok(mainHealth,"Main health endpoint was not found");
  assert.match(mainHealth[0],/database/i,"Main readiness must report database status");
  assert.match(mainHealth[0],/ready/i,"Main health response must expose readiness separately from liveness");
  assert.match(mainHealth[0],/res\.status\(/,"Main health endpoint must be able to return a non-success readiness status");

  const maintenanceHealth=maintenance.match(/app\.get\(["']\/health["'][\s\S]*?\n?app\.get\(["']\/system["']/);
  assert.ok(maintenanceHealth,"Maintenance health endpoint was not found");
  assert.match(maintenanceHealth[0],/ready/i,"Maintenance health response must expose readiness");
  assert.match(maintenanceHealth[0],/res\.status\(/,"Maintenance readiness must fail when required dependencies are unavailable");
  assert.equal(/res\.json\(\{ok:true,/.test(maintenanceHealth[0]),false,"Maintenance health must not report unconditional success");
});

test("application update and rollback restore state before starting the application",()=>{
  const runner=read("host-agent/app-update-runner.sh");
  const rollback=runner.match(/rollback\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(rollback,"Updater rollback function was not found");
  const failureRestore=rollback[1].indexOf('restore_safety_backup "$FAILUREBACKUPNAME"');
  const rollbackStart=rollback[1].indexOf("docker compose up -d");
  assert.ok(failureRestore>=0,"Failed updates must restore their safety backup");
  assert.ok(rollbackStart>=0,"Failed updates must restart the Compose application");
  assert.ok(failureRestore<rollbackStart,"Failed-update data must be restored while the application is stopped");

  const deployment=runner.slice(runner.indexOf('write_state switching'));
  const revertRestore=deployment.indexOf('restore_safety_backup "$BACKUPNAME"');
  const deploymentStart=deployment.indexOf("docker compose up -d");
  assert.ok(revertRestore>=0,"Manual revert must restore the matching release backup");
  assert.ok(deploymentStart>=0,"Updater deployment start was not found");
  assert.ok(revertRestore<deploymentStart,"Manual-revert data must be restored before the reverted application starts");
});

test("all persisted clock values use strict 24-hour validation",()=>{
  const server=read("src/server.js");
  assert.equal(/\^\\d\{2\}:\\d\{2\}\$/.test(server),false,"Do not use shape-only clock validation; use the shared strict validTime helper");
  for(const operation of ["normalizeAutomation","normalizeClassSchedule","app-updates/settings","pluto/schedules"]){
    const position=server.indexOf(operation);
    assert.notEqual(position,-1,`${operation} contract is missing`);
    assert.match(server.slice(position,position+2200),/validTime\(/,`${operation} must validate persisted clocks with validTime()`);
  }
});

test("GitHub release checks are bounded and cannot hang the controller",()=>{
  const server=read("src/server.js");
  const check=server.match(/async function githubReleaseCheck\b[\s\S]*?\n\}/);
  assert.ok(check,"GitHub release checker was not found");
  assert.match(check[0],/(?:AbortSignal\.timeout|AbortController)/,"GitHub release requests must have a deadline");
  assert.match(check[0],/signal\s*:/,"The release request must pass its timeout signal to fetch");
});
