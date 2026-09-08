"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {ClassroomHubStorage}=require("../src/storage");

function withStore(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hub-storage-recovery-"));
  const store=new ClassroomHubStorage({dataDir:dir,dbFile:path.join(dir,"hub.db"),masterKeyFile:path.join(dir,"missing")});
  try{return fn(store,dir)}finally{store.db.close();fs.rmSync(dir,{recursive:true,force:true})}
}

test("database storage is private and migration history is ordered",()=>withStore((store,dir)=>{
  assert.equal(fs.statSync(dir).mode&0o777,0o700);
  assert.equal(fs.statSync(store.dbFile).mode&0o777,0o600);
  assert.deepEqual(store.validateSchemaMigrations(),{ok:true,version:10,count:10});
  store.db.prepare("UPDATE schema_migrations SET name='tampered' WHERE version=3").run();
  assert.throws(()=>store.validateSchemaMigrations(),/Invalid or incomplete/);
}));

test("first administrator setup is atomic and the final effective administrator is protected",()=>withStore(store=>{
  const admin=store.createFirstAdministrator({username:"teacher-admin",displayName:"Teacher Admin"},{password:"correct-horse-battery"});
  assert.equal(admin.role,"admin");
  assert.equal(store.setupCompleted(),true);
  assert.equal(store.effectiveAdministrators().length,1);
  assert.throws(()=>store.putUser({...admin,role:"viewer",profileId:"read-only"}),/effective administrator/);
  assert.equal(store.listUsers()[0].role,"admin");
  assert.throws(()=>store.putAccessProfile({id:"administrator",name:"Administrator",role:"admin",enabled:false,config:{capabilities:["*"]}}),/effective administrator/);
  assert.equal(store.listAccessProfiles().find(x=>x.id==="administrator").enabled,true);
  assert.throws(()=>store.deleteUser(admin.id),/effective administrator/);
  assert.equal(store.userCount(),1);
}));

test("lab computer removal can revoke credentials and pending enrollment atomically",()=>withStore(store=>{
  const pending=store.createLabAgentEnrollment("student-pc-01");
  const enrolled=store.consumeLabAgentEnrollment("student-pc-01",pending.token);
  assert.ok(enrolled?.credential);
  store.createLabAgentEnrollment("student-pc-01");
  const result=store.revokeLabAgentAccess("student-pc-01");
  assert.deepEqual(result,{credentials:1,enrollments:1});
  assert.equal(store.authenticateLabAgent("student-pc-01",enrolled.credential),null);
  assert.equal(store.listLabAgentCredentials().pending.length,0);
}));

test("maintenance backups and restores enforce private files and reject link traversal",()=>{
  const source=fs.readFileSync(path.join(__dirname,"..","maintenance-agent","server.js"),"utf8");
  assert.match(source,/process\.umask\(0o077\)/);
  assert.match(source,/ent\.isSymbolicLink\(\)\)continue/);
  assert.match(source,/Symbolic links are not permitted in restore archives/);
  assert.match(source,/fs\.chmodSync\(dest,0o600\)/);
  assert.match(source,/restoreModes/);
  assert.match(source,/restore-journal\.json/);
  assert.match(source,/fs\.lchownSync/);
  assert.doesNotMatch(source,/zip\.writeZip\(dest\)/);
});
