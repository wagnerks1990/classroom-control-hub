"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {parseOverrides,parseAllowedHosts,gatewayPathFor,validateAllowedTarget,parseGatewayRequest,upstreamRequestHeaders}=require("../src/display-gateway");

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
  const out=gatewayPathFor("https://stream.example.edu/LiveApp/play.html?id=morning","http://192.0.2.10:3000");
  assert.equal(out,"http://192.0.2.10:3000/display-gateway/https/stream.example.edu/LiveApp/play.html?id=morning");
  const parsed=parseGatewayRequest(new URL(out).pathname+new URL(out).search,new Set(["stream.example.edu"]));
  assert.equal(parsed.href,"https://stream.example.edu/LiveApp/play.html?id=morning");
});

test("display gateway rejects arbitrary hosts",()=>{
  assert.throws(()=>parseGatewayRequest("/display-gateway/https/127.0.0.1/admin",new Set(["stream.example.edu"])),/not allowed/);
  assert.throws(()=>parseGatewayRequest("/display-gateway/http/example.com/",new Set(["stream.example.edu"])),/not allowed/);
  assert.throws(()=>parseGatewayRequest("/display-gateway/https/stream.example.edu%3A8443/admin",new Set(["stream.example.edu"])),/port is not allowed/);
});

test("shared outbound target policy rejects credentials and unsafe ports unless the exact host is configured",()=>{
  const allowed=new Set(["stream.example.edu"]);
  assert.throws(()=>validateAllowedTarget("https://example.com/live",allowed),/not allowed/);
  assert.throws(()=>validateAllowedTarget("https://user:secret@stream.example.edu/live",allowed),/without credentials/);
  assert.throws(()=>validateAllowedTarget("https://stream.example.edu:8443/live",allowed),/port is not allowed/);
  assert.equal(validateAllowedTarget("https://stream.example.edu/live",allowed).hostname,"stream.example.edu");
  // Private/local destinations are allowed only when explicitly configured.
  assert.equal(validateAllowedTarget("http://127.0.0.1/live",new Set(["127.0.0.1"])).hostname,"127.0.0.1");
});

test("display gateway strips Hub credentials and forwarding identity",()=>{
  const headers=upstreamRequestHeaders({cookie:"classroom_hub_session=secret",authorization:"Bearer secret","x-setup-token":"secret","x-maintenance-token":"secret","x-forwarded-for":"127.0.0.1",accept:"text/html"});
  assert.deepEqual(headers,{accept:"text/html","accept-encoding":"identity"});
});

test("display media policy routes the approved stream hostname through the Hub",async()=>{
  const {authorizeMediaUrl,setDisplayGatewayHosts}=await import("../public/display/security.mjs");
  setDisplayGatewayHosts(["stream.example.edu"]);
  const result=new URL(authorizeMediaUrl("https://stream.example.edu/LiveApp/play.html?id=test","http://192.0.2.10:3000"));
  assert.equal(result.origin,"http://192.0.2.10:3000");
  assert.equal(result.pathname,"/display-gateway/https/stream.example.edu/LiveApp/play.html");
  assert.equal(result.searchParams.get("id"),"test");
});
