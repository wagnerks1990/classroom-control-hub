'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const load=()=>import('../public/display/layout.mjs');

test('automatic caps permit growth beyond legacy preferred sizes',async()=>{
  const {FONT_CAPS}=await load();
  assert.deepEqual(Object.keys(FONT_CAPS).sort(),['body','subtitle','timer','title']);
  assert.ok(FONT_CAPS.body>54 && FONT_CAPS.title>72 && FONT_CAPS.subtitle>40);
  assert.ok(Object.isFrozen(FONT_CAPS));
});
test('invalid and missing preferred sizes use finite safe defaults',async()=>{
  const {bounded}=await load();
  for(const value of [null,undefined,'',NaN,Infinity,'invalid'])assert.equal(bounded(value,64,1,2000),64);
  assert.equal(bounded(-5,64,1,2000),1);
  assert.equal(bounded(4000,64,1,2000),2000);
});
