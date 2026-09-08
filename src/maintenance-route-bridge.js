"use strict";

// Adds narrowly scoped maintenance-agent mirrors for integration configuration
// handlers without giving the maintenance container an administrator session.
// The mirrored handlers are the application's existing database-backed handlers,
// so encrypted secrets and live runtime apply logic remain owned by server.js.
const crypto=require("crypto");
const express=require("express");
const {DatabaseSync}=require("node:sqlite");

const TOKEN=String(process.env.MAINTENANCE_TOKEN||"");
function tokenEqual(actual,expected){
  const a=Buffer.from(String(actual||"")),b=Buffer.from(String(expected||""));
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
function requireMaintenance(req,res,next){
  if(!TOKEN)return res.status(503).json({ok:false,error:"Maintenance token not configured"});
  if(!tokenEqual(req.get("x-maintenance-token"),TOKEN))return res.status(401).json({ok:false,error:"Unauthorized"});
  next();
}

// Background Music is intentionally dormant until Music Assistant credentials
// exist. Older alpha.71 behavior invoked the scheduler every five seconds even
// when no token was configured, generating repeated WebSocket/HTTP 401 errors.
// This startup guard preserves the saved schedule and automatically begins
// normal polling as soon as the encrypted token appears in SQLite.
let integrationReadDb=null;
function musicAssistantTokenConfigured(){
  const file=String(process.env.DATABASE_FILE||"").trim();if(!file)return false;
  try{
    if(!integrationReadDb)integrationReadDb=new DatabaseSync(file,{readOnly:true});
    return !!integrationReadDb.prepare("SELECT 1 FROM secret_store WHERE name='musicassistant.token' LIMIT 1").get();
  }catch{return false}
}
function isBackgroundMusicTimer(fn,delay){return Number(delay)<=5000&&/backgroundMusicTick/.test(String(fn||""))}
const nativeSetInterval=global.setInterval,nativeSetTimeout=global.setTimeout;
global.setInterval=function(fn,delay,...args){
  if(typeof fn==="function"&&isBackgroundMusicTimer(fn,delay))return nativeSetInterval.call(global,()=>{if(musicAssistantTokenConfigured())return fn(...args)},delay);
  return nativeSetInterval.call(global,fn,delay,...args);
};
global.setTimeout=function(fn,delay,...args){
  if(typeof fn==="function"&&isBackgroundMusicTimer(fn,delay))return nativeSetTimeout.call(global,()=>{if(musicAssistantTokenConfigured())return fn(...args)},delay);
  return nativeSetTimeout.call(global,fn,delay,...args);
};

function wrapVeyonStatusHandler(handler){
  return async function(req,res,next){
    const json=res.json.bind(res);
    res.json=body=>{
      // Native Veyon WebAPI intentionally returns 404 for unsupported GET /.
      // Reachability is useful, but it is not proof of Veyon authentication or
      // workstation control. Operational readiness is evaluated through the
      // computer/authentication endpoint instead.
      if(body&&Number(body.httpStatus)===404){
        body={...body,ok:false,webapi:true,reachable:true,operational:false,health:"reachable-unvalidated",warning:"Veyon WebAPI is reachable, but the root endpoint is not an operational control test. Check authenticated computer status."};
      }
      return json(body);
    };
    return handler(req,res,next);
  }
}

const originalGet=express.application.get;
express.application.get=function(route,...handlers){
  if(route==="/api/v1/admin/config"&&handlers.length){
    const handler=handlers[handlers.length-1];
    originalGet.call(this,"/api/v1/internal/maintenance/config",requireMaintenance,handler);
  }
  if(route==="/api/v1/music-assistant/status"&&handlers.length){
    const handler=handlers[handlers.length-1];
    originalGet.call(this,"/api/v1/internal/maintenance/music-assistant/status",requireMaintenance,handler);
  }
  if(route==="/api/v1/veyon/computers"&&handlers.length){
    const handler=handlers[handlers.length-1];
    originalGet.call(this,"/api/v1/internal/maintenance/veyon/computers",requireMaintenance,handler);
  }
  if(route==="/api/v1/veyon/status"&&handlers.length){
    const handler=handlers[handlers.length-1];
    originalGet.call(this,"/api/v1/internal/maintenance/veyon/status",requireMaintenance,wrapVeyonStatusHandler(handler));
    handlers[handlers.length-1]=wrapVeyonStatusHandler(handler);
  }
  return originalGet.call(this,route,...handlers);
};

const originalPut=express.application.put;
express.application.put=function(route,...handlers){
  if(route==="/api/v1/admin/integration-connections"&&handlers.length){
    const handler=handlers[handlers.length-1];
    originalPut.call(this,"/api/v1/internal/maintenance/integration-connections",requireMaintenance,handler);
  }
  if(route==="/api/v1/music-assistant/config"&&handlers.length){
    const handler=handlers[handlers.length-1];
    originalPut.call(this,"/api/v1/internal/maintenance/music-assistant/config",requireMaintenance,handler);
  }
  return originalPut.call(this,route,...handlers);
};
