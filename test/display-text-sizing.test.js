"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const display=fs.readFileSync("public/display/index.html","utf8");

test("display text uses role-specific bounded font ranges",()=>{
  assert.match(display,/FONT_LIMITS=\{title:\{min:52,max:96,step:4\},subtitle:\{min:28,max:52,step:2\},text:\{min:34,max:64,step:2\},timer:\{min:44,max:80,step:2\}\}/);
  assert.match(display,/clampFontTarget\(titleOptions\.size\|\|92,'title'\)/);
  assert.match(display,/clampFontTarget\(textOptions\.size\|\|64,'text'\)/);
});

test("autofit shrinks in predictable steps instead of arbitrary pixel search",()=>{
  assert.match(display,/while\(size>minSize\)/);
  assert.match(display,/size=Math\.max\(minSize,size-step\)/);
  assert.doesNotMatch(display,/let low=minSize,high=maxSize,best=minSize/);
});

test("timer reservation is deterministic",()=>{
  assert.match(display,/const timerBand=Math\.min\(240,Math\.max\(130,Math\.round\(timerFont\*1\.9\)\)\)/);
  assert.doesNotMatch(display,/timerOverlay\.offsetHeight/);
});
