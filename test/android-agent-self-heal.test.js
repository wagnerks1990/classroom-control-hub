const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'agents/android-tv/app/src/main/java/org/classroomhub/display/MainActivity.java'),'utf8');

test('Android agent continuously enforces persistent management policy',()=>{
  assert.match(source,/POLICY_INTERVAL_MS=30000L/);
  assert.match(source,/getBoolean\("persistent_adb",false\)/);
  assert.match(source,/Settings\.Global\.getInt\(getContentResolver\(\),"adb_wifi_enabled",0\)/);
  assert.match(source,/Settings\.Global\.putInt\(getContentResolver\(\),"adb_wifi_enabled",1\)/);
  assert.match(source,/policyHandler\.postDelayed\(this,POLICY_INTERVAL_MS\)/);
  assert.match(source,/enforceManagementPolicy\("resume"\)/);
});

test('Android agent watchdog remains conditional and bounded',()=>{
  assert.match(source,/if\(!prefs\.getBoolean\("persistent_adb",false\)\)return/);
  assert.match(source,/removeCallbacks\(policyWatchdog\)/);
  assert.doesNotMatch(source,/while\s*\(true\)/);
});
