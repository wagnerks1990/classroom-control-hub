'use strict';
const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');
const page=fs.readFileSync('public/display/index.html','utf8');

test('timer ticks cannot reset the font size chosen by the single layout engine',()=>{
  const code=page.slice(page.indexOf('function paintTimer('),page.indexOf('function applyTimer('));
  assert.doesNotMatch(code,/style\.fontSize|fitElement\(|fitAllContent\(/);
  assert.match(page,/setInterval\(\(\)=>paintTimer\(\{refit:false\}\),1000\)/);
  assert.match(code,/if\(refit\)\{/);
  assert.equal((code.match(/requestDisplayLayout\(\)/g)||[]).length,1);
});
test('receiver source module parses after extraction',()=>{
  const {spawnSync}=require('node:child_process');
  const script=page.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const result=spawnSync(process.execPath,['--input-type=module','--check'],{input:script,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
