"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const express=require("express"),{rateLimit}=require("express-rate-limit");
const source=fs.readFileSync(path.join(__dirname,"../src/server.js"),"utf8");
function limiters(){
  const start=source.indexOf("const musicAssistantStatusLimit=rateLimit({");
  const end=source.indexOf('app.get("/api/v1/music-assistant/status",',start);
  assert.ok(start>=0&&end>start);
  return vm.runInNewContext(source.slice(start,end)+";[musicAssistantStatusLimit,musicAssistantMutationLimit]",{rateLimit},{timeout:1000});
}
test("touched Music Assistant routes keep authorization behind distinct explicit rate budgets",()=>{
  assert.match(source,/app\.get\("\/api\/v1\/music-assistant\/status",musicAssistantStatusLimit,requireControl,/);
  assert.match(source,/app\.put\("\/api\/v1\/music-assistant\/config",musicAssistantMutationLimit,requireAdmin,/);
  assert.match(source,/app\.post\("\/api\/v1\/music-assistant\/tv-bridge",musicAssistantMutationLimit,requireControl,/);
});
test("actual HTTP middleware bounds writes and polling independently and returns Retry-After",{timeout:10000},async t=>{
  // Execute the actual production middleware options with the real library.
  const [status,mutation]=limiters(),app=express();let writes=0,reads=0;
  app.put("/config",mutation,(_req,res)=>{writes++;res.json({ok:true})});
  app.post("/attach",mutation,(_req,res)=>{writes++;res.json({ok:true})});
  app.get("/status",status,(_req,res)=>{reads++;res.json({ok:true})});
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(let i=0;i<30;i++){
    const response=await fetch(base+(i%2?"/attach":"/config"),{method:i%2?"POST":"PUT",headers:{"x-forwarded-for":`192.0.2.${i+1}`}});
    assert.equal(response.status,200);await response.text();
  }
  let response=await fetch(base+"/attach",{method:"POST"});
  assert.equal(response.status,429);assert.equal((await response.json()).ok,false);
  assert.ok(Number(response.headers.get("retry-after"))>0);assert.equal(writes,30);
  for(let i=0;i<120;i++){
    response=await fetch(base+"/status");assert.equal(response.status,200);await response.text();
  }
  response=await fetch(base+"/status");assert.equal(response.status,429);await response.text();
  assert.ok(Number(response.headers.get("retry-after"))>0);assert.equal(reads,120);
  mutation.resetKey("music-assistant-mutations");
  response=await fetch(base+"/config",{method:"PUT"});assert.equal(response.status,200);await response.text();
  assert.equal(writes,31);
});
