"use strict";

const net=require("net");

function normalizeAddress(value){
  let address=String(value||"").trim().toLowerCase();
  if(address.startsWith("[")){const end=address.indexOf("]");if(end>0)address=address.slice(1,end)}
  if(address.startsWith("::ffff:"))address=address.slice(7);
  const zone=address.indexOf("%");if(zone>=0)address=address.slice(0,zone);
  return address;
}

function isLoopbackAddress(value){
  const address=normalizeAddress(value);
  if(address==="localhost"||address==="::1")return true;
  if(net.isIP(address)===4){const first=Number(address.split(".")[0]);return first===127}
  return false;
}

function forwardedHttps(req,trustProxyHops=0){
  if(Number(trustProxyHops)<=0)return false;
  const values=String(req.get?.("x-forwarded-proto")||req.headers?.["x-forwarded-proto"]||"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
  return values.length>0&&values.slice(-Math.max(1,Number(trustProxyHops)||1)).every(value=>value==="https");
}

function recoveryTransportAllowed(req,{trustProxyHops=0}={}){
  const peer=req.socket?.remoteAddress||req.connection?.remoteAddress||"";
  const loopback=isLoopbackAddress(peer);
  // RoomGoblin's reviewed TLS termination model is a same-host proxy. Requiring
  // its immediate peer to be loopback prevents a direct client from turning a
  // trusted-hop setting into an X-Forwarded-Proto spoofing bypass.
  const encrypted=req.socket?.encrypted===true||(loopback&&forwardedHttps(req,trustProxyHops));
  return {allowed:encrypted||loopback,encrypted,loopback};
}

function validRecoveryId(value){return /^[A-Za-z0-9_-]{32,128}$/.test(String(value||""))}

function boundedRecoveryStatus(input,id){
  const source=input?.job&&typeof input.job==="object"?input.job:input||{};
  if(!validRecoveryId(id)||String(source.recoveryId||"")!==String(id))return null;
  const clean=(value,max)=>String(value||"").replace(/[\u0000-\u001f\u007f]/g," ").slice(0,max);
  const rollback=source.rollback&&typeof source.rollback==="object"?{attempted:source.rollback.attempted===true,ok:source.rollback.ok===true}:undefined;
  return {ok:source.ok===true,running:source.running===true,phase:clean(source.phase,64)||"unknown",message:clean(source.message,500),updatedAt:clean(source.updatedAt,64)||null,reloginRequired:source.reloginRequired===true,...(rollback?{rollback}:{})};
}

module.exports={normalizeAddress,isLoopbackAddress,recoveryTransportAllowed,validRecoveryId,boundedRecoveryStatus};
