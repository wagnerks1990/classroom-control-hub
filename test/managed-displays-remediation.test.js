"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const {JsonStore}=require("../maintenance-agent/android-tv-lib");

test("managed Android inventory permissions survive install and GUI update paths",()=>{
  const installer=read("install.sh");
  const updater=read("host-agent/app-update-runner.sh");

  for(const source of [installer,updater]){
    assert.match(source,/install -d -m 2770 -o root -g (?:"\$HUB_INSTALL_GROUP"|10001) "?\$[A-Z_]+\/data\/android-tv"?/);
    assert.match(source,/chmod 0660 .*data\/android-tv\/devices\.json/);
  }

  assert.match(updater,/docker volume inspect classroom-control-hub-android-adb/);
  assert.match(updater,/test -r \/managed\/classroom-hub\/data\/android-tv\/\.android/);
  assert.match(updater,/test ! -e \/managed\/classroom-hub\/data\/android-tv\/devices\.json \|\| test -r \/managed\/classroom-hub\/data\/android-tv\/devices\.json/);
  assert.match(installer,/test -r \/managed\/classroom-hub\/data\/android-tv\/\.android/);
  assert.match(installer,/Managed Android display inventory is not readable/);
});

test("managed display inventory does not silently become empty when unreadable or invalid",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"managed-display-store-"));
  try{
    const store=new JsonStore(dir);
    store.save({version:1,devices:[],profiles:[]});
    assert.equal(fs.statSync(path.join(dir,"devices.json")).mode&0o777,0o660);

    fs.writeFileSync(path.join(dir,"devices.json"),"{ invalid json\n");
    assert.throws(()=>store.load(),/Managed display inventory is unreadable/);
  }finally{
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test("display-agent status uses fast authoritative package and process probes",()=>{
  const app=read("public/managed-displays/app.js");
  const probe=app.match(/async function probeAgent\([\s\S]*?\nasync function probeAllAgents/);
  assert.ok(probe,"Managed Displays agent probe was not found");
  assert.match(probe[0],/pm path/);
  assert.match(probe[0],/pidof/);
  assert.ok(probe[0].indexOf("pm path")<probe[0].indexOf("pidof"));
  assert.doesNotMatch(probe[0],/dumpsys\s+package/);
  assert.match(probe[0],/runShell\(id,script,8000\)/);
});
