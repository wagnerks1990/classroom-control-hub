"use strict";
const crypto=require("crypto");
const ROLE_CAPABILITIES=Object.freeze({
  viewer:["classroom.read"],
  operator:["classroom.read","classroom.control","schedule.manage","automation.manage","media.manage","integrations.control","lab.read","lab.control","diagnostics.read"],
  admin:["*"]
});
function secureTokenEqual(actual,expected){const a=Buffer.from(String(actual||"")),b=Buffer.from(String(expected||""));return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b)}
function capabilitiesFor(user,profile=null){
  if(!user)return [];
  // An explicitly assigned profile is an authorization boundary. If it was
  // disabled, deleted, or cannot be resolved, fail closed instead of silently
  // restoring the broader built-in permissions for the user's role.
  if(user.profileId&&(!profile||profile.enabled===false))return [];
  const configured=profile?.config?.capabilities;
  if(profile)return Array.isArray(configured)?configured:[];
  // Role defaults are retained only for legacy users which predate profiles.
  return ROLE_CAPABILITIES[user.role]||[];
}
function hasCapability(user,capability,profile=null){const caps=capabilitiesFor(user,profile);return caps.includes("*")||caps.includes(capability)}
module.exports={ROLE_CAPABILITIES,secureTokenEqual,capabilitiesFor,hasCapability};
