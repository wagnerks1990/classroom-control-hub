"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseOverrides,parseAllowedHosts,gatewayPathFor,parseGatewayRequest}=require("../src/display-gateway");

test("display gateway defaults the Carlisle stream hostname to the controller override",()=>{
  const overrides=parseOverrides();
  assert.equal(overrides.get("stream.carlisleschools.org"),"100.88.92.111");
  assert.equal(parseAllowedHosts("",overrides).has("stream.carlisleschools.org"),true);
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
});

test("display media policy routes the approved stream hostname through the Hub",async()=>{
  const {authorizeMediaUrl}=await import("../public/display/security.mjs");
  const result=new URL(authorizeMediaUrl("https://stream.carlisleschools.org/LiveApp/play.html?id=test","http://172.16.127.5:3000"));
  assert.equal(result.origin,"http://172.16.127.5:3000");
  assert.equal(result.pathname,"/display-gateway/https/stream.carlisleschools.org/LiveApp/play.html");
  assert.equal(result.searchParams.get("id"),"test");
});
