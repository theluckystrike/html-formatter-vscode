// Runs inside a real VS Code extension host (extensionTestsPath), with the sample workspace of scripts/make-sample.sh
// open. Writes PASS/FAIL lines to SMOKE_OUT.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const out = process.env.SMOKE_OUT;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(150); } return null; }

exports.run = async function () {
  const log = [];
  const check = (name, ok, extra) => log.push((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : ''));
  try {
    const ext = vscode.extensions.getExtension('zovo.zovo-html-formatter');
    check('extension found', !!ext);
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    check('sample workspace open', !!ws, ws && ws.uri.fsPath);
    const P = (rel) => vscode.Uri.joinPath(ws.uri, rel);
    const { formatText } = require(path.join(ext.extensionPath, 'src', 'web', 'format'));
    const apply = async (doc, edits) => { const we = new vscode.WorkspaceEdit(); for (const e of edits || []) we.replace(doc.uri, e.range, e.newText); await vscode.workspace.applyEdit(we); };

    const html = await vscode.workspace.openTextDocument(P('index.html'));
    await vscode.window.showTextDocument(html);
    await until(() => ext.isActive, 15000);
    check('activates on an HTML file', ext.isActive);
    const api = ext.exports;
    const src = html.getText();

    // free core: Format Document through VS Code's formatting API
    const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', html.uri, { tabSize: 2, insertSpaces: true });
    await apply(html, edits);
    const want = formatText(src, { lang: 'html', tabSize: 2, insertSpaces: true, editorconfig: { end_of_line: 'lf', insert_final_newline: 'true' } });
    check('Format Document (HTML)', html.getText() === want, JSON.stringify(html.getText().slice(0, 160)));
    check('style and script blocks formatted inside HTML', /\n {4}body \{\n {6}margin: 0;/.test(html.getText()) && /function add\(a, b\)/.test(html.getText()));
    check('<pre> kept byte for byte', html.getText().includes('<pre>\n  keep   this\n    exactly\n</pre>'));
    check('inline tags stay on their line', html.getText().includes('<nav><a href="/" class="logo" id="top">Home</a> <a href="/cart">Cart <b>(2)</b></a></nav>'));
    await vscode.commands.executeCommand('workbench.action.files.revert');

    // .editorconfig: 4 spaces for CSS, even though the editor says 2
    const css = await vscode.workspace.openTextDocument(P('styles/messy.css'));
    await vscode.window.showTextDocument(css);
    await apply(css, await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', css.uri, { tabSize: 2, insertSpaces: true }));
    check('.editorconfig indent_size = 4 for CSS', /\n {4}color: red;\n/.test(css.getText()) && /padding: 1px 2px; \/\* keep me here \*\//.test(css.getText()), JSON.stringify(css.getText().slice(0, 120)));
    await vscode.commands.executeCommand('workbench.action.files.revert');

    // SCSS maps keep their layout
    const scss = await vscode.workspace.openTextDocument(P('styles/theme.scss'));
    await vscode.window.showTextDocument(scss);
    await apply(scss, await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', scss.uri, { tabSize: 2, insertSpaces: true }));
    check('SCSS map kept, nesting indented', scss.getText().startsWith('$theme: (\n  "primary": $blue,') && /\n {8}&-#\{\$name\} \{/.test(scss.getText()), JSON.stringify(scss.getText().slice(0, 200)));
    await vscode.commands.executeCommand('workbench.action.files.revert');

    // format selection
    await vscode.window.showTextDocument(html);
    const lines = html.getText().split('\n');
    const gl = lines.findIndex((l) => l.startsWith('<div class="grid">'));
    const rEdits = await vscode.commands.executeCommand('vscode.executeFormatRangeProvider', html.uri, new vscode.Range(gl, 0, gl, lines[gl].length), { tabSize: 2, insertSpaces: true });
    await apply(html, rEdits);
    const after = html.getText().split('\n');
    check('Format Selection touches only the selection', after[gl] === '<div class="grid">' && after[gl + 1] === '  <div class="card" data-sku="MUG-RED"><img src="red.png" alt="Red mug">' && after[0] === lines[0] && after[gl - 1] === lines[gl - 1], JSON.stringify(after.slice(gl, gl + 3)));
    await vscode.commands.executeCommand('workbench.action.files.revert');

    // the editor command after "Use as Default Formatter"
    await vscode.commands.executeCommand('zovoHtmlFormat.setDefault');
    await sleep(400);
    const dflt = vscode.workspace.getConfiguration('editor', { languageId: 'html' }).get('defaultFormatter');
    check('Use as Default Formatter writes the user setting', dflt === 'zovo.zovo-html-formatter', dflt);
    let viaCmd = null;
    let wantEd = '';
    for (let i = 0; i < 3 && !viaCmd; i++) {
      const edh = await vscode.window.showTextDocument(html, { preserveFocus: false });
      await sleep(400);
      // the editor's own indentation (VS Code picks 4 for a file with no indented line)
      wantEd = formatText(src, { lang: 'html', tabSize: Number(edh.options.tabSize), insertSpaces: edh.options.insertSpaces !== false, editorconfig: { end_of_line: 'lf', insert_final_newline: 'true' } });
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      await sleep(300);
      await vscode.commands.executeCommand('editor.action.formatDocument');
      viaCmd = await until(() => (html.getText() === wantEd ? true : null), 3000);
    }
    const ae = vscode.window.activeTextEditor;
    if (!viaCmd && !vscode.window.state.focused) log.push('SKIP editor.action.formatDocument :: the test window had no OS focus, so editor actions do not run; the same provider passed through vscode.executeFormatDocumentProvider above');
    else check('editor.action.formatDocument uses it', !!viaCmd, `focused=${vscode.window.state.focused} active=${ae && path.basename(ae.document.fileName)} tab=${ae && ae.options.tabSize} ` + JSON.stringify(html.getText().slice(40, 120)));
    await vscode.commands.executeCommand('workbench.action.files.revert');

    // opt-in format on save
    await vscode.workspace.getConfiguration('zovoHtmlFormat').update('formatOnSave', true, vscode.ConfigurationTarget.Global);
    const about = await vscode.workspace.openTextDocument(P('site/about.html'));
    const ed = await vscode.window.showTextDocument(about);
    await ed.edit((b) => b.insert(new vscode.Position(about.lineCount - 1, 0), '<p>new</p>\n'));
    await about.save();
    check('format on save (setting on)', /\n {4}<h1>Mugs<\/h1>\n/.test(about.getText()) && !about.isDirty, JSON.stringify(about.getText().slice(0, 120)));
    await vscode.workspace.getConfiguration('zovoHtmlFormat').update('formatOnSave', false, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    // Pro 1: folder format (apply), try 1 of 3
    check('3 free tries per tool at start', JSON.stringify(api.tries()) === JSON.stringify({ folder: 3, minify: 3, lint: 3 }), JSON.stringify(api.tries()));
    const site = P('site');
    const r = await vscode.commands.executeCommand('zovoHtmlFormat.formatFolder', { folder: ws.uri.fsPath, apply: true });
    const rep = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.getText();
    check('folder format writes the files and opens a report', r && r.written >= 3 && /^# Folder formatted/.test(rep || ''), JSON.stringify(r) + ' ' + (rep || '').slice(0, 80));
    check('folder format result on disk', /\n {2}<head>|\n<head>\n {2}<meta/.test(fs.readFileSync(path.join(ws.uri.fsPath, 'index.html'), 'utf8')) && /\n {4}padding: 4px;/.test(fs.readFileSync(path.join(ws.uri.fsPath, 'site', 'css', 'site.css'), 'utf8')));
    check('folder try counted', api.tries().folder === 2, JSON.stringify(api.tries()));

    // Pro 2: minify the site folder
    const m = await vscode.commands.executeCommand('zovoHtmlFormat.minify', vscode.Uri.file(site.fsPath));
    const minCss = path.join(site.fsPath, 'css', 'site.min.css');
    check('minify writes .min files and a report', m && m.files >= 3 && fs.existsSync(minCss) && fs.readFileSync(minCss, 'utf8') === 'a{color:red}.card{padding:4px;margin:0 auto}', JSON.stringify(m));
    check('minify report', /^# Minify report/.test(vscode.window.activeTextEditor.document.getText()));

    // Pro 3: lint report, 3 tries then the gate
    const lr = await vscode.commands.executeCommand('zovoHtmlFormat.lint', vscode.Uri.file(path.join(site.fsPath, 'contact.html')));
    check('lint report with 12 findings', lr && lr.findings === 12 && /^# HTML lint report/.test(vscode.window.activeTextEditor.document.getText()), JSON.stringify(lr));
    const diags = vscode.languages.getDiagnostics(vscode.Uri.file(path.join(site.fsPath, 'contact.html')));
    check('lint findings in the Problems panel', diags.length === 12 && diags.every((d) => d.source === 'HTML lint'), diags.length);
    await vscode.commands.executeCommand('zovoHtmlFormat.lint', vscode.Uri.file(site.fsPath));
    await vscode.commands.executeCommand('zovoHtmlFormat.lint', vscode.Uri.file(site.fsPath));
    check('3 lint tries used', api.tries().lint === 0, JSON.stringify(api.tries()));
    const before = vscode.workspace.textDocuments.filter((d) => d.isUntitled).length;
    vscode.commands.executeCommand('zovoHtmlFormat.lint', vscode.Uri.file(site.fsPath)); // 4th: the Pro panel (modal)
    await sleep(1500);
    check('4th lint is gated (no new report)', vscode.workspace.textDocuments.filter((d) => d.isUntitled).length === before);

    const all = await vscode.commands.getCommands(true);
    check('Explorer Pro commands registered', ['zovoHtmlFormat.zovoPro.formatFolder', 'zovoHtmlFormat.zovoPro.minify', 'zovoHtmlFormat.zovoPro.lint'].every((c) => all.includes(c)));
  } catch (e) {
    log.push('FAIL exception :: ' + (e && e.stack || e));
  }
  fs.writeFileSync(out, log.join('\n') + '\n');
};
