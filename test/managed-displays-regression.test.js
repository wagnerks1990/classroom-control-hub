const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('maintenance compose gives adb a narrow persistent writable key volume',()=>{
  const override=read('docker-compose.override.yml');
  assert.match(override,/classroom-hub-android-adb:\/managed\/classroom-hub\/data\/android-tv\/\.android/);
  assert.match(override,/name: classroom-control-hub-android-adb/);
  assert.doesNotMatch(override,/privileged:\s*true/);
  assert.doesNotMatch(override,/cap_add:/);
});

test('classroom overview exposes Managed Displays beside Refresh',()=>{
  const source=read('public/shared/branding.js');
  assert.match(source,/managedDisplaysOverviewLink/);
  assert.match(source,/link\.href="\/managed-displays\/"/);
  assert.match(source,/refresh\.after\(link\)/);
});

test('managed displays preserves inventory while adb is unavailable',()=>{
  const source=read('public/managed-displays/app.js');
  assert.match(source,/error\.payload=j/);
  assert.match(source,/if\(Array\.isArray\(j\.devices\)\)state\.devices=/);
  assert.match(source,/setBridge\(false/);
  assert.match(source,/\.controls button:not\(\[data-op="edit"\]\)/);
  assert.match(source,/classroom-control-hub-android-adb volume is mounted/);
});
