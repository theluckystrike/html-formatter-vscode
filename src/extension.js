'use strict';
// HTML Formatter & CSS Formatter by Zovo. Free: Format Document and Format Selection for HTML, CSS, SCSS and LESS with
// the bundled js-beautify (MIT), .editorconfig support and an opt-in format on save. Everything runs locally: no
// network call, no telemetry. Pro tools (pro.js) run only when the user starts one.

const vscode = require('vscode');
const path = require('path');
const { formatText, formatRange, detectIndent, LANGS } = require('./web/format');
const { propertiesFor } = require('./web/editorconfig');
const minify = require('./web/minify');
const lintMod = require('./web/lint');
const { createPro } = require('./pro');
const { createRatingPrompt } = require('./rate');
const { registerSupport } = require('./support');

const PREFIX = 'zovoHtmlFormat';
const EXT_ID = 'zovo.zovo-html-formatter';
const SCHEME = 'zovo-html-format';
const SELECTOR = [...LANGS].flatMap((language) => [{ language, scheme: 'file' }, { language, scheme: 'untitled' }, { language, scheme: 'vscode-vfs' }]);

let pro;
let rating = { success() {}, failure() {} };
let lintDiagnostics;
const previews = new Map(); // preview uri -> text
const previewEmitter = new vscode.EventEmitter();

const cfg = () => vscode.workspace.getConfiguration(PREFIX);
const setting = (k, d) => { const v = cfg().get(k); return v === undefined || v === null ? d : v; };
const langOfPath = (p) => { const e = path.extname(p).toLowerCase(); return e === '.html' || e === '.htm' ? 'html' : e === '.css' ? 'css' : e === '.scss' ? 'scss' : e === '.less' ? 'less' : null; };
const languageOf = (doc) => (LANGS.has(doc.languageId) ? doc.languageId : langOfPath(doc.fileName || ''));

function settingsObject() {
  return {
    wrapLineLength: setting('wrapLineLength', 0),
    wrapAttributes: setting('wrapAttributes', 'auto'),
    indentInnerHtml: (() => { const v = setting('indentInnerHtml', 'auto'); return v === 'auto' ? 'auto' : v === true || v === 'true'; })(),
    maxPreserveNewlines: setting('maxPreserveNewlines', 2),
    newlineBetweenRules: setting('newlineBetweenRules', false),
    selectorSeparatorNewline: setting('selectorSeparatorNewline', false),
    spaceAroundCombinator: setting('spaceAroundCombinator', true),
    unformatted: setting('unformatted', []),
    contentUnformatted: setting('contentUnformatted', []),
  };
}

function editorconfigFor(uri) {
  if (setting('useEditorConfig', true) === false || !uri || uri.scheme !== 'file') return {};
  try { return propertiesFor(uri.fsPath); } catch { return {}; }
}

function optionsForDoc(doc, formatting) {
  return {
    lang: languageOf(doc),
    tabSize: formatting ? formatting.tabSize : 2,
    insertSpaces: formatting ? formatting.insertSpaces : true,
    editorconfig: editorconfigFor(doc.uri),
    settings: settingsObject(),
    eol: doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
  };
}

/** One replacement { start, end, text } that turns a into b, or null. */
function minimalEdit(a, b) {
  if (a === b) return null;
  let p = 0;
  const max = Math.min(a.length, b.length);
  while (p < max && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < max - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { start: p, end: a.length - s, text: b.slice(p, b.length - s) };
}

const counted = new Set();
function documentEdits(doc, formatting) {
  const src = doc.getText();
  let out;
  try { out = formatText(src, optionsForDoc(doc, formatting)); } catch (e) {
    vscode.window.setStatusBarMessage(`HTML Formatter: not formatted (${e.message}).`, 8000);
    rating.failure();
    return [];
  }
  if (!counted.has(doc.uri.toString())) { counted.add(doc.uri.toString()); rating.success(doc.uri); }
  const e = minimalEdit(src, out);
  return e ? [vscode.TextEdit.replace(new vscode.Range(doc.positionAt(e.start), doc.positionAt(e.end)), e.text)] : [];
}

function rangeEdits(doc, range, formatting) {
  const full = new vscode.Range(range.start.with(undefined, 0), range.end);
  const text = doc.getText(full);
  if (!text.trim()) return [];
  const base = /^[ \t]*/.exec(text)[0];
  let out;
  try { out = formatRange(text.slice(base.length), optionsForDoc(doc, formatting), base); } catch { return []; }
  return [vscode.TextEdit.replace(full, base + out)];
}

// ---------------- Pro tools ----------------

function findTargetFolder(arg) {
  if (arg && arg.fsPath) return arg;
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.uri.scheme === 'file') {
    const wf = vscode.workspace.getWorkspaceFolder(ed.document.uri);
    if (wf) return wf.uri;
  }
  const f = (vscode.workspace.workspaceFolders || [])[0];
  return f ? f.uri : null;
}

async function isDirectory(uri) {
  try { return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0; } catch { return false; }
}

async function filesUnder(uri, exts) {
  if (!(await isDirectory(uri))) return exts.includes(path.extname(uri.fsPath).toLowerCase()) ? [uri] : [];
  const excl = setting('exclude', ['**/node_modules/**', '**/.git/**', '**/*.min.*', '**/dist/**', '**/vendor/**']);
  const glob = `**/*{${exts.join(',')}}`;
  const max = Math.max(10, Number(setting('maxFiles', 2000)) || 2000);
  const list = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, glob), excl.length ? `{${excl.join(',')}}` : undefined, max);
  return list.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

const readText = async (uri) => {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return { text: open.getText(), dirty: open.isDirty, doc: open };
  return { text: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'), dirty: false };
};
const rel = (uri, root) => path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/') || path.basename(uri.fsPath);

async function openReport(md) {
  const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function formatFolder(arg) {
  if (!(await pro.allowed('folder', arg))) return;
  const root = arg && typeof arg.folder === 'string' ? vscode.Uri.file(arg.folder) : findTargetFolder(arg);
  if (!root) { vscode.window.showWarningMessage('Open a folder first.'); return; }
  const files = await filesUnder(root, ['.html', '.htm', '.css', '.scss', '.less']);
  if (!files.length) { vscode.window.showWarningMessage(`No HTML, CSS, SCSS or LESS files in ${path.basename(root.fsPath)}.`); return; }
  const changed = [];
  const skipped = [];
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Formatting ${files.length} file(s) in memory` }, async () => {
    for (const uri of files) {
      const { text, dirty } = await readText(uri);
      if (dirty) { skipped.push({ uri, why: 'unsaved changes in the editor' }); continue; }
      const lang = langOfPath(uri.fsPath);
      const ed = vscode.workspace.getConfiguration('editor', { languageId: lang, uri });
      const ind = ed.get('detectIndentation', true) ? detectIndent(text, { insertSpaces: ed.get('insertSpaces', true), tabSize: ed.get('tabSize', 2) }) : { insertSpaces: ed.get('insertSpaces', true), tabSize: ed.get('tabSize', 2) };
      let out;
      try { out = formatText(text, { lang, ...ind, editorconfig: editorconfigFor(uri), settings: settingsObject() }); } catch (e) { skipped.push({ uri, why: e.message }); continue; }
      if (out === text) continue;
      const a = text.split('\n'); const b = out.split('\n');
      let lines = 0; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) lines++;
      changed.push({ uri, text, out, lines });
    }
  });
  if (!changed.length) { vscode.window.showInformationMessage(`All ${files.length} file(s) in ${path.basename(root.fsPath)} are already formatted.${skipped.length ? ` ${skipped.length} skipped.` : ''}`); return; }
  for (const c of changed) { c.preview = vscode.Uri.from({ scheme: SCHEME, path: c.uri.path, query: String(Date.now()) }); previews.set(c.preview.toString(), c.out); }
  let pick = changed;
  if (!(arg && arg.apply === true)) {
    pick = await new Promise((resolve) => {
      const qp = vscode.window.createQuickPick();
      qp.title = `Format ${changed.length} of ${files.length} file(s) in ${path.basename(root.fsPath)}: Enter writes the checked files`;
      qp.placeholder = 'Click the diff button of a row to preview it. Uncheck the files to leave alone.';
      qp.canSelectMany = true;
      qp.items = changed.map((c) => ({ label: rel(c.uri, root), description: `${c.lines} line(s) change`, buttons: [{ iconPath: new vscode.ThemeIcon('diff'), tooltip: 'Preview the change' }], c }));
      qp.selectedItems = qp.items;
      qp.onDidTriggerItemButton((e) => vscode.commands.executeCommand('vscode.diff', e.item.c.uri, e.item.c.preview, `${path.basename(e.item.c.uri.fsPath)}: now ↔ formatted`, { preview: true }));
      let done = false;
      qp.onDidAccept(() => { done = true; resolve(qp.selectedItems.map((i) => i.c)); qp.hide(); });
      qp.onDidHide(() => { if (!done) resolve(null); qp.dispose(); });
      qp.show();
      if (changed[0]) vscode.commands.executeCommand('vscode.diff', changed[0].uri, changed[0].preview, `${path.basename(changed[0].uri.fsPath)}: now ↔ formatted`, { preview: true, preserveFocus: true });
    });
  }
  if (!pick || !pick.length) return;
  for (const c of pick) await vscode.workspace.fs.writeFile(c.uri, Buffer.from(c.out, 'utf8'));
  for (const c of changed) previews.delete(c.preview.toString());
  await pro.produced('folder');
  const L = ['# Folder formatted', '', `${pick.length} file(s) written in ${root.fsPath}, ${files.length - changed.length} already formatted.`, '', '| File | Lines changed |', '| --- | --- |'];
  for (const c of pick) L.push(`| ${rel(c.uri, root)} | ${c.lines} |`);
  if (skipped.length) { L.push('', 'Skipped:', ''); for (const s of skipped) L.push(`- ${rel(s.uri, root)}: ${s.why}`); }
  L.push('', 'Use git diff or the Source Control view to review, and git checkout to undo.');
  await openReport(L.join('\n') + '\n');
  return { written: pick.length, files: files.length };
}

async function minifyFiles(arg) {
  if (!(await pro.allowed('minify', arg))) return;
  let target = arg && arg.fsPath ? arg : null;
  const ed = vscode.window.activeTextEditor;
  if (!target && ed && ed.document.uri.scheme === 'file' && /\.(html?|css)$/i.test(ed.document.fileName)) target = ed.document.uri;
  if (!target) target = findTargetFolder(arg);
  if (!target) { vscode.window.showWarningMessage('Open an HTML or CSS file, or a folder, first.'); return; }
  const files = (await filesUnder(target, ['.html', '.htm', '.css'])).filter((u) => !/\.min\.[a-z]+$/i.test(u.fsPath));
  if (!files.length) { vscode.window.showWarningMessage('No .html or .css files here (minified .min. files are skipped).'); return; }
  const base = (await isDirectory(target)) ? target : vscode.Uri.file(path.dirname(target.fsPath));
  const outDir = String(setting('minifyOutDir', '') || '').trim();
  const rows = [];
  for (const uri of files) {
    const { text } = await readText(uri);
    const isCss = /\.css$/i.test(uri.fsPath);
    let out;
    try { out = isCss ? minify.minifyCss(text) : minify.minifyHtml(text); } catch (e) { rows.push({ uri, error: e.message }); continue; }
    const name = path.basename(uri.fsPath).replace(/\.(html?|css)$/i, '.min.$1');
    const dest = outDir ? vscode.Uri.file(path.join(base.fsPath, outDir, path.relative(base.fsPath, path.dirname(uri.fsPath)), name)) : vscode.Uri.file(path.join(path.dirname(uri.fsPath), name));
    await vscode.workspace.fs.writeFile(dest, Buffer.from(out, 'utf8'));
    rows.push({ uri, dest, ...minify.sizes(text, out) });
  }
  if (!rows.some((r) => r.dest)) { vscode.window.showErrorMessage('Nothing was minified.'); return; }
  await pro.produced('minify');
  const kb = (n) => (n >= 10240 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024).toFixed(1)} KB`);
  const ok = rows.filter((r) => r.dest);
  const sum = ok.reduce((a, r) => ({ before: a.before + r.before, after: a.after + r.after, gzB: a.gzB + r.gzBefore, gzA: a.gzA + r.gzAfter }), { before: 0, after: 0, gzB: 0, gzA: 0 });
  const L = ['# Minify report', '', `${ok.length} file(s) minified from ${base.fsPath}. Total ${kb(sum.before)} to ${kb(sum.after)} (${sum.before ? Math.round(((sum.before - sum.after) / sum.before) * 100) : 0} % smaller), gzip ${kb(sum.gzB)} to ${kb(sum.gzA)}.`, '', '| File | Written to | Before | After | Saved | Gzip before | Gzip after |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const r of ok) L.push(`| ${rel(r.uri, base)} | ${rel(r.dest, base)} | ${kb(r.before)} | ${kb(r.after)} | ${r.pct} % | ${kb(r.gzBefore)} | ${kb(r.gzAfter)} |`);
  for (const r of rows.filter((x) => x.error)) L.push(`| ${rel(r.uri, base)} | not written: ${r.error} | | | | | |`);
  L.push('', 'Comments (except /*! ... */ and IE conditional comments) and whitespace that cannot change the page are removed. <pre>, <textarea>, <script> and inline spacing stay as they are. The source files are not changed.');
  await openReport(L.join('\n') + '\n');
  return { files: ok.length, before: sum.before, after: sum.after };
}

async function lintReport(arg) {
  if (!(await pro.allowed('lint', arg))) return;
  let target = arg && arg.fsPath ? arg : null;
  const ed = vscode.window.activeTextEditor;
  if (!target && ed && ed.document.uri.scheme === 'file' && /\.html?$/i.test(ed.document.fileName)) target = ed.document.uri;
  if (!target) target = findTargetFolder(arg);
  if (!target) { vscode.window.showWarningMessage('Open an HTML file or a folder first.'); return; }
  const files = await filesUnder(target, ['.html', '.htm']);
  if (!files.length) { vscode.window.showWarningMessage('No .html files here.'); return; }
  const base = (await isDirectory(target)) ? target : vscode.Uri.file(path.dirname(target.fsPath));
  const results = [];
  lintDiagnostics.clear();
  for (const uri of files) {
    const { text } = await readText(uri);
    const findings = lintMod.lint(text);
    results.push({ file: rel(uri, base), uri, findings });
    if (findings.length) {
      lintDiagnostics.set(uri, findings.map((f) => {
        const d = new vscode.Diagnostic(new vscode.Range(f.line - 1, 0, f.line - 1, 1000), f.message, vscode.DiagnosticSeverity.Warning);
        d.source = 'HTML lint';
        d.code = f.rule;
        return d;
      }));
    }
  }
  await openReport(lintMod.markdown(results, { root: base.fsPath }));
  await pro.produced('lint');
  return { files: results.length, findings: results.reduce((n, r) => n + r.findings.length, 0) };
}

async function setDefaultFormatter() {
  const conf = vscode.workspace.getConfiguration();
  for (const lang of LANGS) {
    const key = `[${lang}]`;
    const cur = conf.inspect(key);
    const val = { ...((cur && cur.globalValue) || {}), 'editor.defaultFormatter': EXT_ID };
    await conf.update(key, val, vscode.ConfigurationTarget.Global);
  }
  vscode.window.showInformationMessage('HTML Formatter is now the default formatter for HTML, CSS, SCSS and LESS in your user settings.');
}

// ---------------- activation ----------------

function activate(context) {
  rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: PREFIX, name: 'HTML Formatter' });
  registerSupport({ vscode, context, prefix: PREFIX, selfId: EXT_ID });
  pro = createPro({ vscode, context });
  lintDiagnostics = vscode.languages.createDiagnosticCollection('html-lint');
  context.subscriptions.push(lintDiagnostics, previewEmitter);
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, { provideDocumentFormattingEdits: (doc, o) => documentEdits(doc, o) }));
  context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider(SELECTOR, { provideDocumentRangeFormattingEdits: (doc, r, o) => rangeEdits(doc, r, o) }));
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, { onDidChange: previewEmitter.event, provideTextDocumentContent: (uri) => previews.get(uri.toString()) || '' }));

  reg(`${PREFIX}.format`, async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed || !languageOf(ed.document)) { vscode.window.setStatusBarMessage('HTML Formatter: open an HTML, CSS, SCSS or LESS file.', 5000); return; }
    const sel = ed.selection;
    const o = { tabSize: Number(ed.options.tabSize) || 2, insertSpaces: ed.options.insertSpaces !== false };
    const edits = sel && !sel.isEmpty ? rangeEdits(ed.document, sel, o) : documentEdits(ed.document, o);
    if (edits.length) await ed.edit((b) => { for (const e of edits) b.replace(e.range, e.newText); });
  });
  reg(`${PREFIX}.setDefault`, setDefaultFormatter);
  reg(`${PREFIX}.formatFolder`, (arg) => formatFolder(arg));
  reg(`${PREFIX}.minify`, (arg) => minifyFiles(arg));
  reg(`${PREFIX}.lint`, (arg) => lintReport(arg));
  // Explorer right-click entries ("Zovo Pro: ..." titles), tagged as the "ctx" surface
  reg(`${PREFIX}.zovoPro.formatFolder`, (uri) => formatFolder(uri && uri.fsPath ? uri : { surface: 'ctx' }));
  reg(`${PREFIX}.zovoPro.minify`, (uri) => minifyFiles(uri && uri.fsPath ? uri : { surface: 'ctx' }));
  reg(`${PREFIX}.zovoPro.lint`, (uri) => lintReport(uri && uri.fsPath ? uri : { surface: 'ctx' }));
  context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: (uri) => pro.handleUri(uri) }));

  // opt-in format on save with this formatter (when VS Code's own editor.formatOnSave is off for the language)
  context.subscriptions.push(vscode.workspace.onWillSaveTextDocument((e) => {
    if (setting('formatOnSave', false) !== true || !languageOf(e.document)) return;
    if (e.reason !== vscode.TextDocumentSaveReason.Manual) return;
    if (vscode.workspace.getConfiguration('editor', e.document).get('formatOnSave')) return;
    const ed = vscode.window.visibleTextEditors.find((x) => x.document === e.document);
    const conf = vscode.workspace.getConfiguration('editor', e.document);
    const o = ed ? { tabSize: Number(ed.options.tabSize) || 2, insertSpaces: ed.options.insertSpaces !== false } : { tabSize: Number(conf.get('tabSize')) || 2, insertSpaces: conf.get('insertSpaces') !== false };
    e.waitUntil(Promise.resolve(documentEdits(e.document, o)));
  }));
  // lint results are for the text that was checked: drop them when the file changes
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => { if (lintDiagnostics.has(e.document.uri) && e.contentChanges.length) lintDiagnostics.delete(e.document.uri); }));

  // a small read-only API (used by the real-app test)
  return { tries: () => pro.tries() };
}

function deactivate() {}

module.exports = { activate, deactivate, _minimalEdit: minimalEdit };
