'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ui = require('../public/shared/workspace.js');

test('all thirteen existing pages have exactly one of six workspaces', () => {
  assert.equal(ui.ROUTES.length, 13);
  assert.equal(ui.GROUPS.length, 6);
  assert.equal(new Set(ui.ROUTES.map(x => x.id)).size, 13);
  for (const route of ui.ROUTES) assert.ok(ui.GROUPS.some(group => group.id === route.group));
  assert.throws(() => { ui.ROUTES[0].id = 'other'; }, TypeError);
});
test('search recognizes everyday and legacy terminology', () => {
  for (const [term, id] of [['timer', 'display'], ['Veyon', 'lab'], ['Pluto', 'av'], ['backups', 'system'], ['powerpoint', 'presentations']]) {
    assert.ok(ui.search(term).some(route => route.id === id));
  }
  assert.equal(ui.search('ROOM lights')[0].id, 'lights');
  assert.equal(ui.search('room lighting')[0].id, 'lights');
});
test('search only returns the explicitly authorized route set', () => {
  assert.deepEqual(ui.search('', ['overview']).map(x => x.id), ['overview']);
  assert.deepEqual(ui.search('backup', ['overview', 'display']), []);
  assert.deepEqual(ui.search('', []), []);
});
test('hash routes are allowlisted, including display tools', () => {
  assert.deepEqual(ui.parseRoute('#/display/timer'), { page: 'display', work: 'timer' });
  assert.deepEqual(ui.parseRoute('#/system'), { page: 'system', work: '' });
  for (const hash of ['#//example.com', '#/unknown', '#/system/timer', '#/display/execute', '#/display/../../system', '#/display?token=x', '#/display/<script>']) assert.equal(ui.parseRoute(hash), null);
});
test('operator scope excludes receivers and other public renderers', () => {
  for (const url of ['/controller/', '/controller', '/controller/index.html', '/controller/display.html', '/controller/lab.html', '/controller/veyon.html', '/setup/']) assert.equal(ui.supports(url), true, url);
  for (const url of ['/display/', '/display/tv1', '/document-viewer/', '/antmedia-player/', '/lab-agent/', '/schoology/', '/controller/unknown.html']) assert.equal(ui.supports(url), false, url);
});
test('classic fallback is explicit and inherited only through readable parent context', () => {
  const own = { location: { search: '?workspace=classic' } }; own.parent = own;
  assert.equal(ui.classic(own), true);
  assert.equal(ui.classic({ location: { search: '' }, parent: own }), true);
  const normal = { location: { search: '' } }; normal.parent = normal;
  assert.equal(ui.classic(normal), false);
});
test('workspace script parses and builds text safely without device API calls', () => {
  const source = fs.readFileSync(path.join(root, 'public/shared/workspace.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source));
  assert.doesNotMatch(source, /\.innerHTML\s*=|\beval\s*\(|\bfetch\s*\(|\bXMLHttpRequest\b/);
  assert.match(source, /win\.showPage\(id\)/);
  assert.match(source, /dataset\.authorized !== 'false'/);
  assert.match(source, /dialog\.showModal\(\)/);
});
test('every route and display subtool still exists in canonical controller markup', { skip: !fs.existsSync(path.join(root, 'public/controller/index.html')) }, () => {
  const controller = fs.readFileSync(path.join(root, 'public/controller/index.html'), 'utf8');
  const display = fs.readFileSync(path.join(root, 'public/controller/display.html'), 'utf8');
  for (const route of ui.ROUTES) {
    assert.ok(controller.includes(`id="${route.id}"`), `${route.id} section missing`);
    assert.ok(controller.includes(`data-page="${route.id}"`), `${route.id} navigation missing`);
  }
  for (const tool of ui.DISPLAY_WORK) assert.ok(display.includes(`data-work="${tool}"`), tool);
});

test('branding loads workspace only on the operator allowlist', () => {
  const source = fs.readFileSync(path.join(root, 'public/shared/branding.js'), 'utf8');
  for (const pathname of ['/controller/', '/controller/display.html', '/setup/', '/display/tv1', '/document-viewer/', '/antmedia-player/', '/schoology/']) {
    const loaded = [];
    const document = {
      documentElement: { lang: 'en', dataset: {} },
      querySelector: () => null,
      createElement: () => ({}),
      head: { append: node => loaded.push(node.src) }
    };
    vm.runInNewContext(source, { document, location: { pathname }, window: {}, fetch: () => new Promise(() => {}) });
    assert.deepEqual(loaded, ui.supports(pathname) ? ['/shared/workspace.js'] : [], pathname);
  }
});
