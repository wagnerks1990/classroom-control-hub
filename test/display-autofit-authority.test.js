'use strict';
const fs=require('node:fs');
const test=require('node:test');
const assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');

test('only the receiver imports the sizing engine; branding cannot inject a second fitter',()=>{
  assert.match(read('public/display/index.html'),/import \{createDisplayLayout,fitElement,bounded\} from '\/display\/layout\.mjs/);
  assert.doesNotMatch(read('public/shared/branding.js'),/display-autofit\.js/);
  assert.doesNotMatch(read('public/shared/display-autofit.js'),/new MutationObserver|requestAnimationFrame\s*\(|\.style\./);
  assert.doesNotMatch(read('public/display/index.html'),/function fitAllContent|function fitText|function timerFits/);
  assert.doesNotMatch(read('public/display/layout.mjs'),/MutationObserver|ResizeObserver/);
});
test('source guardrails are complemented by actual browser geometry tests in CI',()=>{
  const workflow=read('.github/workflows/display-browser.yml');
  assert.match(workflow,/browser: \[chromium, firefox\]/);
  assert.match(workflow,/unittest discover -s test\/browser/);
  assert.match(read('test/browser/test_display.py'),/getClientRects/);
});
