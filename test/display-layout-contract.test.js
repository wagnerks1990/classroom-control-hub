'use strict';
const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');

test('viewport transforms are separate from logical fitting',()=>{
  const page=fs.readFileSync('public/display/index.html','utf8');
  const engine=fs.readFileSync('public/display/layout.mjs','utf8');
  assert.match(page,/const LOGICAL_WIDTH=1920,LOGICAL_HEIGHT=1080/);
  assert.match(page,/Math\.min\(m\.viewportWidth\/LOGICAL_WIDTH,m\.viewportHeight\/LOGICAL_HEIGHT\)/);
  assert.doesNotMatch(engine,/devicePixelRatio|screen\.width|innerWidth/);
});
test('full-width padded children are not rejected by subtracting their own padding twice',async()=>{
  const {fits}=await import('../public/display/layout.mjs');
  const saved=global.getComputedStyle;
  global.getComputedStyle=()=>({paddingLeft:'0',paddingRight:'0',paddingTop:'0',paddingBottom:'0'});
  try{
    const box={clientWidth:1740,clientHeight:511};
    assert.equal(fits({scrollWidth:1740,offsetWidth:1740,scrollHeight:500,offsetHeight:500},box),true);
    assert.equal(fits({scrollWidth:1740,offsetWidth:1740,scrollHeight:600,offsetHeight:600},box),false);
  }finally{global.getComputedStyle=saved;}
});
