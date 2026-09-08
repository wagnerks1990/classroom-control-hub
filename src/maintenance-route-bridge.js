"use strict";

// Adds narrowly scoped maintenance-agent mirrors for integration configuration
// handlers without giving the maintenance container an administrator session.
// The mirrored handlers are the application's existing database-backed handlers,
// so encrypted secrets and live runtime apply logic remain owned by server.js.
const crypto=require("crypto");
const express=require("express");

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

const originalGet=express.application.get;
express.application.get=function(route,...handlers){
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
    originalGet.call(this,"/api/v1/internal/maintenance/veyon/status",requireMaintenance,handler);
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
