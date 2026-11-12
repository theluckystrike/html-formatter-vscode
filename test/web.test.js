'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { formatText, formatRange, detectInnerIndent, detectIndent } = require('../src/web/format');
const { parseIni, globToRegExp, propertiesFor } = require('../src/web/editorconfig');
const minify = require('../src/web/minify');
const { lint, markdown } = require('../src/web/lint');
const { tokenize } = require('../src/web/htmltok');

const FX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const fmt = (text, lang, extra = {}) => formatText(text, { lang, tabSize: 2, insertSpaces: true, ...extra });
const words = (s) => tokenize(s).filter((x) => x.type === 'text').map((x) => x.text).join(' ').split(/\s+/).filter(Boolean).join(' ');
const tags = (s) => tokenize(s).filter((x) => x.type === 'tag' || x.type === 'endtag').map((x) => x.type + x.name + JSON.stringify((x.attrs || []).map((a) => [a.name, a.value]))).join('|');

// ---------- formatting ----------

test('HTML: messy page is indented; style and script blocks are formatted inside', () => {
  const out = fmt(read('messy.html'), 'html');
  assert.match(out, /\n<head>\n {2}<meta charset="utf-8">\n {2}<title>Shop<\/title>\n {2}<style>\n {4}body \{\n {6}margin: 0;/);
  assert.match(out, /\.card > h2 \+ p \{/);
  assert.match(out, /\n {6}function add\(a, b\) \{ return a \+ b \}\n {4}<\/script>/);
  assert.match(out, /<nav><a href="\/" class="logo" id="top">Home<\/a> <a href="\/cart">Cart <b>\(2\)<\/b><\/a><\/nav>/, 'inline tags stay on their line');
  assert.equal(fmt(out, 'html'), out, 'idempotent');
  assert.equal(words(out), words(read('messy.html')));
  assert.equal(tags(out), tags(read('messy.html')), 'same tags, same attributes in the same order');
});

test('HTML: <pre> and <textarea> contents stay byte for byte', () => {
  const out = fmt(read('messy.html'), 'html');
  assert.ok(out.includes('<pre>\n  keep   this\n    exactly\n</pre>'));
  assert.ok(out.includes('<textarea name="note">  also\n this </textarea>'));
});

test('HTML: head/body indentation style is detected and kept', () => {
  assert.equal(detectInnerIndent('<html>\n<head>'), false);
  assert.equal(detectInnerIndent('<html>\n  <head>'), true);
  const flat = fmt('<html>\n<head><title>x</title></head>\n<body><p>a</p></body>\n</html>\n', 'html');
  assert.match(flat, /^<html>\n<head>/);
  const nested = fmt('<html>\n  <head><title>x</title></head>\n  <body><p>a</p></body>\n</html>\n', 'html');
  assert.match(nested, /^<html>\n {2}<head>/);
  assert.equal(fmt(read('h5bp-index.html'), 'html'), read('h5bp-index.html'), 'a tidy page comes back unchanged');
});

test('HTML: real page keeps every word, tag and attribute and is idempotent', () => {
  const src = read('dashboard.html');
  const out = fmt(src, 'html');
  assert.equal(words(out), words(src));
  assert.equal(tags(out), tags(src));
  assert.equal(fmt(out, 'html'), out);
});

test('CSS: rules indented, trailing comments stay, blank lines kept (at most one)', () => {
  const out = fmt(read('messy.css'), 'css');
  assert.equal(out, 'a {\n  color: red;\n  background: blue\n}\n.btn, .btn:hover {\n  padding: 1px 2px; /* keep me here */\n  margin: 0\n}\n\n@media (min-width:600px) {\n  .btn {\n    display: block\n  }\n}\n');
  assert.equal(fmt(out, 'css'), out);
});

test('CSS: normalize.css (trailing /* 1 */ comments) changes only nothing', () => {
  const src = read('normalize.css');
  assert.equal(fmt(src, 'css'), src);
});

test('SCSS: multi-line maps keep their layout, nesting is indented, // comments stay', () => {
  const out = fmt(read('maps.scss'), 'scss');
  assert.ok(out.startsWith('$theme: (\n  "primary": $blue,\n  "secondary": #{$gray-600},\n);\n'));
  assert.match(out, /margin-bottom: 1rem; \/\/ the space below\n {2}@each \$name, \$value in \$theme \{\n {4}&-#\{\$name\} \{\n {6}color: \$value;/);
  assert.equal(fmt(out, 'scss'), out);
});

test('CSS: multi-line @media prelude keeps its lines', () => {
  const src = '@media print,\n  (min-resolution: 2dppx) {\n  a { color: red }\n}\n';
  assert.equal(fmt(src, 'css'), '@media print,\n  (min-resolution: 2dppx) {\n  a {\n    color: red\n  }\n}\n');
});

test('tabs, CRLF and the final newline follow the editor and .editorconfig', () => {
  assert.equal(fmt('a{b:c}', 'css', { insertSpaces: false }), 'a {\n\tb: c\n}');
  assert.equal(fmt('a{b:c}\r\n', 'css'), 'a {\r\n  b: c\r\n}\r\n');
  assert.equal(fmt('a{b:c}\n', 'css', { editorconfig: { indent_style: 'space', indent_size: '4', end_of_line: 'crlf', insert_final_newline: 'false' } }), 'a {\r\n    b: c\r\n}');
});

test('format selection keeps the indentation of the first line', () => {
  assert.equal(formatRange('<div><p>a</p><p>b</p></div>', { lang: 'html', tabSize: 2, insertSpaces: true }, '    '), '<div>\n      <p>a</p>\n      <p>b</p>\n    </div>');
});

test('indentation of files on disk is detected', () => {
  assert.deepEqual(detectIndent('a {\n    b: c;\n}\n'), { insertSpaces: true, tabSize: 4 });
  assert.deepEqual(detectIndent('a {\n\tb: c;\n}\n'), { insertSpaces: false, tabSize: 2 });
  assert.deepEqual(detectIndent(read('normalize.css')), { insertSpaces: true, tabSize: 2 });
});

// ---------- .editorconfig ----------

test('editorconfig: sections, globs and the root chain', () => {
  const ini = parseIni('root = true\n[*]\nindent_style = space\nindent_size = 2\n\n[*.{css,scss}]\nindent_size = 4 # comment\n[lib/**.html]\nindent_style = tab\n');
  assert.equal(ini.root, true);
  assert.equal(ini.sections.length, 3);
  assert.ok(globToRegExp('*.{css,scss}').test('a/b/x.scss'));
  assert.ok(!globToRegExp('*.{css,scss}').test('x.less'));
  assert.ok(globToRegExp('lib/**.html').test('lib/a/b.html'));
  assert.ok(globToRegExp('file[!a].txt').test('fileb.txt') && !globToRegExp('file[!a].txt').test('filea.txt'));
  assert.ok(globToRegExp('v{1..3}.css').test('v2.css') && !globToRegExp('v{1..3}.css').test('v4.css'));
  const files = { '/p/.editorconfig': 'root = true\n[*]\nindent_size = 2\nend_of_line = lf\n', '/p/web/.editorconfig': '[*.css]\nindent_size = 4\n' };
  const props = propertiesFor('/p/web/site.css', (f) => files[f] || null);
  assert.equal(props.indent_size, '4');
  assert.equal(props.end_of_line, 'lf');
  assert.equal(propertiesFor('/p/web/page.html', (f) => files[f] || null).indent_size, '2');
});

// ---------- minify ----------

test('minify CSS: comments and whitespace go, strings, calc() and /*! */ stay', () => {
  assert.equal(minify.minifyCss('/* x */\na , b > c :hover {\n  color : red ;\n  margin: calc( 1px + 2px ) ;\n  content: "; }" ;\n}\n/*! license */\n@media screen and (min-width: 1px) {\n  .a { background: url( img/a.png ) }\n}\n'),
    'a,b > c :hover{color:red;margin:calc( 1px + 2px );content:"; }"}/*! license */@media screen and (min-width: 1px){.a{background:url(img/a.png)}}');
  const src = read('normalize.css');
  const out = minify.minifyCss(src);
  const norm = (s) => s.replace(/\/\*(?!!)[\s\S]*?\*\//g, '').replace(/\s+/g, '').replace(/;}/g, '}');
  assert.equal(norm(out), norm(src));
  assert.ok(out.length < src.length * 0.4);
});

test('minify HTML: whitespace between blocks goes, inline spacing, pre, script and IE comments stay', () => {
  const out = minify.minifyHtml('<!doctype html>\n<html>\n  <head>\n    <!--[if IE]><p>old</p><![endif]-->\n    <!-- note -->\n    <style>\n      a { color : red; }\n    </style>\n  </head>\n  <body>\n    <p>Hello   <b>big</b>   <i>world</i>\n    </p>\n    <pre>  keep\n   this </pre>\n    <script>  let a = 1;\n</script>\n  </body>\n</html>\n');
  assert.equal(out, '<!doctype html><html><head><!--[if IE]><p>old</p><![endif]--><style>a{color:red}</style></head><body><p>Hello <b>big</b> <i>world</i></p><pre>  keep\n   this </pre><script>  let a = 1;\n</script></body></html>');
  const page = read('dashboard.html');
  const m = minify.minifyHtml(page);
  assert.equal(words(m), words(page));
  assert.equal(tags(m), tags(page));
  const s = minify.sizes(page, m);
  assert.ok(s.saved > 0 && s.gzAfter <= s.gzBefore);
});

// ---------- lint ----------

test('lint: every check fires once on the sample page, with lines', () => {
  const f = lint(read('page-lint.html'));
  const by = (r) => f.filter((x) => x.rule === r).map((x) => x.line);
  assert.deepEqual(by('heading-order'), [6]);
  assert.deepEqual(by('img-alt'), [7]);
  assert.deepEqual(by('input-label'), [9]);
  assert.deepEqual(by('link-name'), [13]);
  assert.deepEqual(by('target-blank'), [16]);
  assert.deepEqual(by('button-name'), [17]);
  assert.deepEqual(by('duplicate-id'), [19]);
  assert.deepEqual(by('iframe-title'), [20]);
  assert.deepEqual(by('deprecated-element'), [21]);
  assert.deepEqual(by('multiple-h1'), [22]);
  assert.deepEqual(by('html-lang'), [2]);
  assert.deepEqual(by('document-title'), [2]);
  assert.equal(f.length, 12);
  const md = markdown([{ file: 'page-lint.html', findings: f }], { when: new Date('2026-11-12T00:00:00Z') });
  assert.match(md, /^# HTML lint report/);
  assert.match(md, /\| Image without alt text \| 1 \|/);
  assert.match(md, /- line 7: &lt;img src="a\.png"> has no alt attribute/);
});

test('lint: a clean page has no findings', () => {
  assert.deepEqual(lint('<!doctype html><html lang="en"><head><title>T</title></head><body><h1>A</h1><h2>B</h2><img src="a.png" alt="A"><label for="q">Q</label><input id="q"><a href="/">Home</a><button aria-label="Close"></button></body></html>'), []);
});
