'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const displayHtml = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'display', 'index.html'),
  'utf8'
);

test('running timers do not continuously refit all display text', () => {
  assert.match(displayHtml, /function paintTimer\(\{refit=false\}=\{\}\)/);
  assert.match(displayHtml, /paintTimer\(\{refit:true\}\)/);
  assert.match(displayHtml, /setInterval\(\(\)=>paintTimer\(\{refit:false\}\),1000\)/);
  assert.doesNotMatch(displayHtml, /setInterval\(paintTimer,250\)/);
});

test('timer repaint only requests global autofit when explicitly requested', () => {
  const start = displayHtml.indexOf('function paintTimer({refit=false}={})');
  const end = displayHtml.indexOf('function applyTimer', start);
  assert.ok(start >= 0 && end > start, 'paintTimer implementation must be present');
  const implementation = displayHtml.slice(start, end);
  assert.match(implementation, /if\(refit\)requestAnimationFrame\(fitAllContent\)/);
  assert.doesNotMatch(implementation, /\n  requestAnimationFrame\(fitAllContent\);\n/);
});
