"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {capabilitiesFor,hasCapability}=require("../src/security");

const serverSource=fs.readFileSync(path.join(__dirname,"..","src","server.js"),"utf8");

test("assigned access profiles fail closed when missing or disabled",()=>{
  const user={id:"user-1",role:"operator",profileId:"restricted"};
  assert.deepEqual(capabilitiesFor(user,null),[]);
  assert.deepEqual(capabilitiesFor(user,{id:"restricted",enabled:false,config:{capabilities:["classroom.control"]}}),[]);
  assert.equal(hasCapability(user,"classroom.control",null),false);
  assert.deepEqual(capabilitiesFor({...user,profileId:null},null),[
    "classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","diagnostics.read"
  ]);
});

test("sensitive read routes require their explicit capabilities",()=>{
  assert.match(serverSource,/app\.get\("\/api\/v1\/diagnostics",requireCapability\("diagnostics\.read"\)/);
  assert.match(serverSource,/app\.get\("\/api\/v1\/diagnostics\/events",requireCapability\("diagnostics\.read"\)/);
  assert.match(serverSource,/app\.get\("\/api\/v1\/veyon\/computers",requireCapability\("lab\.read"\)/);
  assert.match(serverSource,/app\.get\("\/api\/v1\/veyon\/connections",requireCapability\("lab\.read"\)/);
});

test("active SVG media and legacy anonymous participation are retired",()=>{
  assert.match(serverSource,/Active SVG media is not served from the application origin/);
  const uploadPolicyStart=serverSource.indexOf("const allowedExt=new Set");
  const uploadPolicyEnd=serverSource.indexOf("const allowedMime=",uploadPolicyStart);
  assert.ok(uploadPolicyStart>=0&&uploadPolicyEnd>uploadPolicyStart);
  assert.doesNotMatch(serverSource.slice(uploadPolicyStart,uploadPolicyEnd),/"\.svg"/);
  assert.match(serverSource,/Legacy anonymous classroom participation has been retired/);
  assert.match(serverSource,/return res\.status\(410\)/);
});

test("login, CSV, host and WebSocket hardening guards remain installed",()=>{
  assert.match(serverSource,/const scryptAsync = promisify\(crypto\.scrypt\)/);
  assert.match(serverSource,/LOGIN_ATTEMPT_CACHE_MAX=10000/);
  assert.match(serverSource,/function csvCell\(value\)/);
  assert.match(serverSource,/if\(\/\^\[\\s\]\*\[=\+\\-@\]\//);
  assert.match(serverSource,/Do not trust X-Forwarded-Host/);
  assert.match(serverSource,/function powerShellLiteral\(value\)/);
  assert.match(serverSource,/function websocketMessageAllowed\(ws\)/);
  assert.match(serverSource,/boundedWsObject\(msg\.state,"Display state",256\*1024\)/);
  assert.match(serverSource,/function disconnectInvalidUserWebSockets\(userId\)/);
  assert.match(serverSource,/authorizationChanged[\s\S]*deleteAllUserSessions\(user\.id\)[\s\S]*disconnectInvalidUserWebSockets\(user\.id\)/);
});
