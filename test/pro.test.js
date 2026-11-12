'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createPro, TRIAL_USES, TRIAL_KEY, FEATURES } = require('../src/pro');

function fakeVscode(messages) {
  class EventEmitter { constructor() { this.l = []; this.event = (f) => { this.l.push(f); return { dispose() {} }; }; } fire(v) { for (const f of this.l) f(v); } dispose() {} }
  return { EventEmitter, window: { setStatusBarMessage: (m) => messages.push(m) } };
}
function ctx() { const m = new Map(); return { subscriptions: [], globalState: { get: (k) => m.get(k), update: async (k, v) => { m.set(k, v); } } }; }

test('3 free tries per tool, counted only after output, then the Pro panel with the surface', async () => {
  const msgs = []; const asked = [];
  const license = { isPro: () => false, requirePro: async (title, d) => { asked.push([title, d.surface]); return false; }, onDidChange() {} };
  const p = createPro({ vscode: fakeVscode(msgs), context: ctx(), license });
  assert.equal(TRIAL_USES, 3);
  for (let i = 0; i < 3; i++) { assert.equal(await p.allowed('lint'), true); await p.produced('lint'); }
  assert.equal(p.left('lint'), 0);
  assert.equal(p.left('minify'), 3);
  assert.equal(await p.allowed('lint', { surface: 'toolbar' }), false);
  assert.equal(await p.allowed('lint', { fsPath: '/x.html', scheme: 'file' }), false);
  assert.deepEqual(asked, [['HTML lint report', 'toolbar'], ['HTML lint report', 'ctx']]);
  assert.match(msgs[2], /free try 3 of 3/);
  assert.deepEqual(p.tries(), { folder: 3, minify: 3, lint: 0 });
});

test('a stale globalState read never gives tries back or drops another tool', async () => {
  const c = ctx();
  const p = createPro({ vscode: fakeVscode([]), context: c, license: { isPro: () => false, requirePro: async () => false, onDidChange() {} } });
  await p.produced('folder');
  await c.globalState.update(TRIAL_KEY, undefined); // what a late storage echo looks like
  await p.produced('minify');
  assert.deepEqual(c.globalState.get(TRIAL_KEY), { folder: 1, minify: 1 });
  assert.deepEqual(p.tries(), { folder: 2, minify: 2, lint: 3 });
});

test('a licensed user never uses tries', async () => {
  const c = ctx();
  const p = createPro({ vscode: fakeVscode([]), context: c, license: { isPro: () => true, requirePro: async () => assert.fail('no panel'), onDidChange() {} } });
  for (let i = 0; i < 5; i++) { assert.equal(await p.allowed('folder'), true); await p.produced('folder'); }
  assert.equal(c.globalState.get(TRIAL_KEY), undefined);
});

test('package.json: id, name, phrase first, 5 keywords, engines, activation, Pro and Explorer commands', () => {
  const pk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(`${pk.publisher}.${pk.name}`, 'zovo.zovo-html-formatter');
  assert.ok(pk.displayName.length <= 30);
  assert.ok(pk.displayName.startsWith('HTML Formatter'));
  assert.ok(pk.description.startsWith('HTML formatter'));
  assert.equal(pk.keywords.length, 5);
  assert.ok(!pk.activationEvents.includes('*'));
  assert.match(pk.engines.vscode, /^\^1\.(7\d|8\d)\./);
  const cmds = new Map(pk.contributes.commands.map((c) => [c.command, c.title]));
  for (const c of ['zovoHtmlFormat.formatFolder', 'zovoHtmlFormat.minify', 'zovoHtmlFormat.lint', 'zovoHtmlFormat.getPro', 'zovoHtmlFormat.enterLicenseKey']) assert.ok(cmds.has(c), c);
  // Explorer entries: own commands whose title starts with "Zovo Pro:" (VS Code ignores a title on a menu item)
  const ctxMenu = pk.contributes.menus['explorer/context'];
  assert.equal(ctxMenu.length, 3);
  for (const m of ctxMenu) { assert.match(cmds.get(m.command), /^Zovo Pro: /); assert.equal(m.title, undefined); }
  const hidden = new Set(pk.contributes.menus.commandPalette.filter((m) => m.when === 'false').map((m) => m.command));
  for (const m of ctxMenu) assert.ok(hidden.has(m.command), m.command);
  assert.equal(Object.keys(FEATURES).length, 3);
  assert.ok(fs.existsSync(path.join(__dirname, '..', pk.icon)));
});

test('activation shows no message on its own; no network module anywhere in the product code', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.js'), 'utf8');
  const act = src.slice(src.indexOf('function activate('), src.indexOf('function deactivate('));
  assert.ok(!/show(Information|Warning|Error)Message/.test(act));
  const files = ['extension.js', 'pro.js', ...fs.readdirSync(path.join(__dirname, '..', 'src', 'web')).map((f) => `web/${f}`), 'vendor/beautifier.js'];
  for (const f of files) {
    const s = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    assert.ok(!/require\(['"](https?|net|tls|dgram)['"]\)|fetch\(|XMLHttpRequest/.test(s), f);
  }
});

test('the bundled js-beautify is the MIT build with its license', () => {
  const lic = fs.readFileSync(path.join(__dirname, '..', 'src', 'vendor', 'js-beautify-LICENSE.txt'), 'utf8');
  assert.match(lic, /The MIT License/);
  const b = require('../src/vendor/beautifier');
  assert.deepEqual(Object.keys(b).sort(), ['css', 'html', 'js']);
});
