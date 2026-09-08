"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("installer backs up every SQLite database and canonicalizes the configured active database safely",()=>{
  const installer=read("install.sh");
  assert.match(installer,/find \"\$TARGET\/data\" -maxdepth 1 -type f -name '\*\.db' -print0/);
  assert.match(installer,/docker compose stop classroom-hub/);
  assert.match(installer,/sqlite3 \"\$CURRENT_DB_HOST\" \"\.backup '\$DB_STAGE'\"/);
  assert.match(installer,/PRAGMA quick_check/);
  assert.match(installer,/CANONICAL_DATABASE=\/app\/data\/classroom-control-hub\.db/);
  assert.match(installer,/set_env_path DATABASE_FILE \"\$CANONICAL_DATABASE\"/);
  assert.doesNotMatch(installer,/rm -f \"\$CURRENT_DB_HOST\"/);
});

test("startup recovery restores missing built-in capabilities before the application starts",()=>{
  const recovery=read("src/startup-recovery.js"),dockerfile=read("Dockerfile");
  assert.match(dockerfile,/CMD \["node", "src\/startup-recovery\.js"\]/);
  assert.match(recovery,/administrator:[\s\S]*?capabilities:\["\*"\]/);
  assert.match(recovery,/if\(validCapabilityArray\(config\.capabilities\)\)continue/);
  assert.match(recovery,/UPDATE access_profiles SET config_json=\?,updated_at=\?/);
});

test("setup wizard keeps receiver IDs editable and removes stale group members",()=>{
  const setup=read("public/setup/index.html");
  assert.match(setup,/id="receiverIds"/);
  assert.doesNotMatch(setup,/id="receiverIds"[^>]*disabled/);
  assert.match(setup,/function receiverIdList\(\)/);
  assert.match(setup,/const allowed=new Set\(ids\)/);
  assert.match(setup,/filter\(id=>allowed\.has\(id\)\)/);
  assert.match(setup,/groups\.all=\[\.\.\.ids\]/);
});

test("setup wizard supports adopt, install, and recreate actions returned by module capabilities",()=>{
  const setup=read("public/setup/index.html");
  assert.match(setup,/Adopt Existing/);
  assert.match(setup,/Install/);
  assert.match(setup,/Save & Recreate/);
  assert.match(setup,/m\.canDeploy!==false/);
  const extension=read("maintenance-agent/extensions.js");
  assert.match(extension,/musicassistant:[\s\S]*?externalOnly:false/);
  assert.match(extension,/Existing container adopted by Classroom Control Hub without recreation/);
});
