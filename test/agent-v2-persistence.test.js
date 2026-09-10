"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {JsonStore,normalizeAgentV2}=require("../maintenance-agent/android-tv-lib");

test("Device Agent v2 enrollment survives device normalization and store reload",()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"hub-agent-v2-"));
  try{
    const token="a".repeat(64);
    const store=new JsonStore(root);
    store.upsertDevice({
      id:"room-127",
      name:"Room 127 TV",
      host:"192.168.1.50",
      port:5555,
      agentV2:{enabled:true,port:8765,token,configuredAt:"2026-09-10T15:44:00.000Z"}
    });
    const loaded=new JsonStore(root).getDevice("room-127");
    assert.deepEqual(loaded.agentV2,{enabled:true,port:8765,token,configuredAt:"2026-09-10T15:44:00.000Z"});
  }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test("Device Agent v2 persistence rejects malformed secrets",()=>{
  assert.equal(normalizeAgentV2({enabled:true,port:8765,token:"not-a-secret"}),null);
});
