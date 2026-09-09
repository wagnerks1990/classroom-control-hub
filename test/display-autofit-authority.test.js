'use strict';

const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const source=fs.readFileSync(path.join(__dirname,'..','public','shared','display-autofit.js'),'utf8');

test('display autofit does not observe its own style/class writes',()=>{
  assert.match(source,/observer\.observe\(stage,\{subtree:true,childList:true,characterData:true\}\)/);
  assert.doesNotMatch(source,/attributeFilter:\['style','class'\]/);
});

test('body fit compares scroll size directly to logical region',()=>{
  assert.match(source,/el\.scrollWidth<=Math\.max\(1,box\.clientWidth\+1\)/);
  assert.match(source,/el\.scrollHeight<=Math\.max\(1,box\.clientHeight\+1\)/);
  assert.doesNotMatch(source,/box\.clientWidth-padX/);
});

test('routine timer digit mutations do not trigger global refit',()=>{
  assert.match(source,/target\?\.id==='timerValue'/);
  assert.match(source,/return false/);
});

test('logical caps keep short body readable without unbounded growth',()=>{
  assert.match(source,/body:120/);
  assert.match(source,/timer:110/);
});
