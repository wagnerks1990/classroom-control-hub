const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('managed display lifecycle supports safe enable disable and remove',()=>{
  const source=read('maintenance-agent/android-tv-agent-v2.js');
  assert.match(source,/action==="enable"/);
  assert.match(source,/action==="disable"/);
  assert.match(source,/action==="remove"/);
  assert.match(source,/STORE\.deleteDevice\(d\.id\)/);
  assert.match(source,/dataPreserved:true/);
  assert.match(source,/\/android\/devices\/:id\/lifecycle/);
});

test('managed display UI exposes lifecycle controls with destructive confirmation',()=>{
  const source=read('public/managed-displays/agent-v2-ui.js');
  assert.match(source,/Enable enrollment/);
  assert.match(source,/Disable enrollment/);
  assert.match(source,/Remove from Hub/);
  assert.match(source,/will not uninstall the Android app, factory-reset the TV, or delete other Classroom Hub data/);
});

test('device admin activation uses Android system approval flow',()=>{
  const source=read('maintenance-agent/android-tv-agent-v2.js');
  assert.match(source,/android\.app\.action\.ADD_DEVICE_ADMIN/);
  assert.match(source,/android\.app\.extra\.DEVICE_ADMIN/);
  assert.match(source,/AgentDeviceAdminReceiver/);
  assert.match(source,/requiresUserConfirmation:true/);
});

test('v2 configure synchronizes persistent adb policy',()=>{
  const source=read('maintenance-agent/android-tv-agent-v2.js');
  assert.match(source,/--ez","persistent_adb"/);
  assert.match(source,/--ei","target_adb_port"/);
  assert.match(source,/d\.persistentAdb\?\.enabled===true/);
});
