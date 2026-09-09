'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const hotfix = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'shared', 'automation-hotfix.js'),
  'utf8'
);

test('linked automation list uses the first resolved occurrence time', () => {
  assert.match(hotfix, /path==="\/api\/v1\/automations"&&method==="GET"/);
  assert.match(hotfix, /event\.legacyTime=event\.time/);
  assert.match(hotfix, /event\.time=primary\.time/);
});

test('linked automation schedule description is derived from resolved occurrences', () => {
  assert.match(hotfix, /window\.scheduleDescription=function patchedScheduleDescription/);
  assert.match(hotfix, /event\?\.resolvedOccurrences/);
  assert.match(hotfix, /originalScheduleDescription\(occ\)/);
  assert.match(hotfix, /\.join\(" \| "\)/);
});
