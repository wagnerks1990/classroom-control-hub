"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {parseOverrides,parseAllowedHosts,gatewayPathFor,parseGatewayRequest,upstreamRequestHeaders}=require("../src/display-gateway");

test("display gateway has no school-specific default override",()=>{
  const overrides=parseOverrides();
  assert.equal(overrides.size,0);
  assert.equal(parseAllowedHosts("",overrides).size,0);
});

test("compose passes protected display gateway configuration into the Hub",()=>{
  const compose=fs.readFileSync(require("node:path").join(__dirname,"..","docker-compose.yml"),"utf8");
  assert.match(compose,/DISPLAY_GATEWAY_OVERRIDES:\s*\$\{DISPLAY_GATEWAY_OVERRIDES:-\}/);
  assert.match(compose,/DISPLAY_GATEWAY_ALLOWED_HOSTS:\s*\$\{DISPLAY_GATEWAY_ALLOWED_HOSTS:-\}/);
});

test("display gateway preserves target hostname and path in same-origin URLs",()=>{
  const out=gatewayPathFor("https://stream.carlisleschools.org/LiveApp/play.html?id=morning","http://172.16.127.5:3000");
  assert.equal(out,"http://172.16.127.5:3000/display-gateway/https/stream.carlisleschools.org/LiveApp/play.html?id=morning");
  const parsed=parseGatewayRequest(new URL(out).pathname+new URL(out).search,new Set(["stream.carlisleschools.org"]));
  assert.equal(parsed.href,"https://stream.carlisleschools.org/LiveApp/play.html?id=morning");
});

test("display gateway rejects arbitrary hosts",()=>{
  assert.throws(()=>parseGatewayRequest("/display-gateway/https/127.0.0.1/admin",new Set(["stream.carlisleschools.org"])),/not allowed/);
  assert.throws(()=>parseGatewayRequest("/display-gateway/http/example.com/",new Set(["stream.carlisleschools.org"])),/not allowed/);
  assert.throws(()=>parseGatewayRequest("/display-gateway/https/stream.carlisleschools.org%3A8443/admin",new Set(["stream.carlisleschools.org"])),/port is not allowed/);
});

test("display gateway strips Hub credentials and forwarding identity",()=>{
  const headers=upstreamRequestHeaders({cookie:"classroom_hub_session=secret",authorization:"Bearer secret","x-setup-token":"secret","x-maintenance-token":"secret","x-forwarded-for":"127.0.0.1",accept:"text/html"});
  assert.deepEqual(headers,{accept:"text/html","accept-encoding":"identity"});
});

test("display media policy routes the approved stream hostname through the Hub",async()=>{
  const {authorizeMediaUrl,setDisplayGatewayHosts}=await import("../public/display/security.mjs");
  setDisplayGatewayHosts(["stream.carlisleschools.org"]);
  const result=new URL(authorizeMediaUrl("https://stream.carlisleschools.org/LiveApp/play.html?id=test","http://172.16.127.5:3000"));
  assert.equal(result.origin,"http://172.16.127.5:3000");
  assert.equal(result.pathname,"/display-gateway/https/stream.carlisleschools.org/LiveApp/play.html");
  assert.equal(result.searchParams.get("id"),"test");
});
