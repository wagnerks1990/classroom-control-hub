const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const layoutPath = path.join(root, 'public', 'display', 'layout.mjs');
const indexPath = path.join(root, 'public', 'display', 'index.html');

test('display renderer keeps auto-grow close to configured scene sizes', async () => {
  const layout = await import(pathToFileURL(layoutPath).href + `?t=${Date.now()}`);
  assert.equal(layout.LAYOUT_REVISION, 'single-fit-20260909-4');
  assert.equal(layout.AUTO_GROW_FACTOR, 1.10);
  assert.deepEqual(layout.FONT_CAPS, { title: 118, subtitle: 82, body: 120, timer: 132 });

  const source = fs.readFileSync(layoutPath, 'utf8');
  assert.match(source, /autoCap\(o\.size, fallback, FONT_CAPS\[name\]\)/,
    'title/subtitle/body auto-fit must be based on the configured size');
  assert.match(source, /autoCap\(state\.fontSize, 64, FONT_CAPS\.timer\)/,
    'timer auto-fit must be based on the configured timer size');
});

test('configured font size can never override hard rendered containment', () => {
  const source = fs.readFileSync(layoutPath, 'utf8');
  assert.match(source, /function renderedContained\(el, box\)/);
  assert.match(source, /range\.getClientRects\(\)/,
    'fitter must validate actual painted text rectangles, not only scroll metrics');
  assert.match(source, /while \(!fits\(el, box\) && fontSize > 1/,
    'fitter must continue shrinking when browser rounding still leaves overflow');
  assert.match(source, /while \(!renderedContained\(el, box\) && scale > 0\.05/,
    'pathological content must remain bounded after fallback scaling');
});

test('timer overlay remains a compact box inside its reserved region', () => {
  const source = fs.readFileSync(layoutPath, 'utf8');
  assert.match(source, /timerOverlay\.style\.width = 'max-content'/,
    'timer must wrap its content instead of stretching across the receiver');
  assert.doesNotMatch(source, /timerOverlay\.style\.width = '100%'/,
    'full-width timer chrome is the regression this test prevents');
});

test('receiver cache key matches active renderer revision', () => {
  const source = fs.readFileSync(indexPath, 'utf8');
  assert.match(source, /layout\.mjs\?v=single-fit-20260909-4/);
  assert.match(source, /layout\.css\?v=single-fit-20260909-4/);
  assert.match(source, /DISPLAY_BUILD='1\.0\.0-alpha\.72'/);
});
