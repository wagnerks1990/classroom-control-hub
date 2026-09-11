"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {isLoopbackAddress,recoveryTransportAllowed,validRecoveryId,boundedRecoveryStatus}=require("../src/recovery-transport-policy");

function request({peer="192.0.2.20",secure=false,protocol="http",forwarded=""}={}){return {secure,protocol,socket:{remoteAddress:peer,encrypted:secure},headers:{"x-forwarded-proto":forwarded},get(name){return this.headers[String(name).toLowerCase()]||""}}}

test("full recovery secrets require HTTPS or a direct loopback peer",()=>{
  assert.equal(recoveryTransportAllowed(request()).allowed,false);
  assert.equal(recoveryTransportAllowed(request({secure:true})).allowed,true);
  assert.equal(recoveryTransportAllowed(request({peer:"::ffff:127.0.0.1"})).allowed,true);
  assert.equal(recoveryTransportAllowed(request({peer:"::1"})).allowed,true);
  assert.equal(isLoopbackAddress("127.44.2.9"),true);
});

test("forwarded HTTPS is ignored unless the proxy is explicitly trusted",()=>{
  const spoofed=request({forwarded:"https"});
  assert.equal(recoveryTransportAllowed(spoofed,{trustProxyHops:0}).allowed,false);
  assert.equal(recoveryTransportAllowed(spoofed,{trustProxyHops:1}).encrypted,false,"a direct remote peer cannot spoof TLS even when proxy hops are configured");
  assert.equal(recoveryTransportAllowed(request({peer:"127.0.0.1",forwarded:"https"}),{trustProxyHops:1}).encrypted,true);
  assert.equal(recoveryTransportAllowed(request({peer:"127.0.0.1",forwarded:"http, https"}),{trustProxyHops:2}).encrypted,false);
});

test("public recovery status requires an unguessable matching id and exposes bounded fields",()=>{
  const id="A".repeat(32);
  assert.equal(validRecoveryId("short"),false);
  assert.equal(boundedRecoveryStatus({job:{recoveryId:"B".repeat(32)}},id),null);
  const status=boundedRecoveryStatus({job:{recoveryId:id,phase:"applying\n",running:true,ok:false,message:"x".repeat(900),updatedAt:"2026-09-11T00:00:00Z",reloginRequired:true,secret:"never",rollback:{attempted:true,ok:false,detail:"private"}}},id);
  assert.deepEqual(Object.keys(status).sort(),["message","ok","phase","reloginRequired","rollback","running","updatedAt"].sort());
  assert.equal(status.message.length,500);
  assert.equal(status.phase,"applying ");
  assert.deepEqual(status.rollback,{attempted:true,ok:false});
});
