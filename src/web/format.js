'use strict';
// Formatting for HTML, CSS, SCSS and LESS with the bundled js-beautify 1.15.4 (MIT, src/vendor). This file only picks
// the options: the editor's indentation, then .editorconfig, then this extension's settings, with defaults that keep a
// file the way it was written where that is safe (blank lines, the head/body indentation style, the final newline,
// <pre> and <textarea> contents, attribute order).

const beautify = require('../vendor/beautifier');

const LANGS = new Set(['html', 'css', 'scss', 'less']);

/** "auto" for the <head>/<body> indent: true when the file indents <head> under <html>. */
function detectInnerIndent(text) {
  const html = /^([ \t]*)<html[\s>]/im.exec(text);
  const head = /^([ \t]*)<(head|body)[\s>]/im.exec(text);
  if (!html || !head) return false;
  return head[1].length > html[1].length;
}

/**
 * @param {string} text
 * @param {{ lang: string, tabSize?: number, insertSpaces?: boolean, editorconfig?: object, settings?: object, eol?: string }} o
 */
function optionsFor(text, o) {
  const ec = o.editorconfig || {};
  const st = o.settings || {};
  let indentSize = o.tabSize || 2;
  let useTabs = o.insertSpaces === false;
  if (ec.indent_style === 'tab') useTabs = true;
  if (ec.indent_style === 'space') useTabs = false;
  if (ec.indent_size && /^\d+$/.test(String(ec.indent_size))) indentSize = Number(ec.indent_size);
  else if (ec.tab_width && /^\d+$/.test(String(ec.tab_width)) && useTabs) indentSize = Number(ec.tab_width);
  let eol = o.eol || (text.includes('\r\n') ? '\r\n' : '\n');
  if (ec.end_of_line === 'lf') eol = '\n';
  else if (ec.end_of_line === 'crlf') eol = '\r\n';
  else if (ec.end_of_line === 'cr') eol = '\r';
  let endWithNewline = /\n\s*$/.test(text) || text.length === 0;
  if (String(ec.insert_final_newline).toLowerCase() === 'true') endWithNewline = true;
  if (String(ec.insert_final_newline).toLowerCase() === 'false') endWithNewline = false;
  let wrap = 0;
  if (typeof st.wrapLineLength === 'number' && st.wrapLineLength > 0) wrap = st.wrapLineLength;
  else if (ec.max_line_length && /^\d+$/.test(String(ec.max_line_length))) wrap = Number(ec.max_line_length);
  const base = {
    indent_size: useTabs ? 1 : indentSize,
    indent_char: useTabs ? '\t' : ' ',
    indent_with_tabs: useTabs,
    eol,
    end_with_newline: endWithNewline,
    preserve_newlines: true,
    max_preserve_newlines: Number.isFinite(st.maxPreserveNewlines) ? st.maxPreserveNewlines : 2,
    wrap_line_length: wrap,
  };
  if (o.lang === 'html') {
    const inner = st.indentInnerHtml === true || (st.indentInnerHtml !== false && detectInnerIndent(text));
    return {
      ...base,
      indent_inner_html: inner,
      extra_liners: [],
      wrap_attributes: st.wrapAttributes || 'auto',
      indent_scripts: 'normal',
      templating: ['auto'],
      unformatted: st.unformatted || [],
      content_unformatted: ['pre', 'textarea', ...(st.contentUnformatted || [])],
      indent_handlebars: true,
      css: { end_with_newline: false, newline_between_rules: st.newlineBetweenRules === true, selector_separator_newline: st.selectorSeparatorNewline === true, space_around_combinator: st.spaceAroundCombinator !== false },
      js: { end_with_newline: false, brace_style: 'collapse,preserve-inline', space_in_empty_paren: false },
    };
  }
  return {
    ...base,
    newline_between_rules: st.newlineBetweenRules === true,
    selector_separator_newline: st.selectorSeparatorNewline === true,
    space_around_combinator: st.spaceAroundCombinator !== false,
    brace_style: 'collapse',
  };
}


// ---- CSS family: keep multi-line ( ... ) as written, keep trailing comments on their line ----

/** Comments and top-level ( ... ) groups of a CSS, SCSS or LESS text, skipping strings and url(...). */
function cssScan(text, lang) {
  const comments = [];
  const groups = [];
  const lineComments = lang === 'scss' || lang === 'less';
  let depth = 0;
  let gStart = -1;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const j = text.indexOf('*/', i + 2);
      const end = j < 0 ? n : j + 2;
      if (depth === 0) comments.push({ start: i, end, trailing: /\S/.test(text.slice(text.lastIndexOf('\n', i - 1) + 1, i)) });
      i = end;
      continue;
    }
    if (lineComments && c === '/' && text[i + 1] === '/' && (i === 0 || /[\s;{}(,]/.test(text[i - 1]))) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      if (depth === 0) comments.push({ start: i, end: j, trailing: /\S/.test(text.slice(text.lastIndexOf('\n', i - 1) + 1, i)), line: true });
      i = j;
      continue;
    }
    if ((c === 'u' || c === 'U') && /^url\(\s*[^"'\s)]/i.test(text.slice(i, i + 6))) {
      const j = text.indexOf(')', i);
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (c === '@' && depth === 0 && /[a-z-]/i.test(text[i + 1] || '')) {
      const m = /^@[a-z-]+[ \t]*/i.exec(text.slice(i));
      const from = i + m[0].length;
      let j = from;
      let q = null;
      while (j < n && (q || (text[j] !== '{' && text[j] !== ';' && text[j] !== '}'))) {
        if (q) { if (text[j] === q) q = null; } else if (text[j] === '"' || text[j] === "'") q = text[j];
        else if (text[j] === '/' && (text[j + 1] === '*' || (lineComments && text[j + 1] === '/'))) break;
        j++;
      }
      let end = j;
      while (end > from && /\s/.test(text[end - 1])) end--;
      if (text[j] === '{' && text.slice(from, end).includes('\n')) { groups.push({ start: from, end }); i = end; continue; }
    }
    if (c === '(') { if (depth === 0) gStart = i; depth++; }
    else if (c === ')' && depth > 0) {
      depth--;
      if (depth === 0) {
        const body = text.slice(gStart + 1, i);
        // a real { } ; inside resets depth below, so a group that closes here holds only a value
        if (body.includes('\n')) groups.push({ start: gStart + 1, end: i });
      }
    } else if (c === '#' && text[i + 1] === '{') { const j = text.indexOf('}', i); i = j < 0 ? n : j + 1; continue; }
    else if ((c === '{' || c === '}' || c === ';') && depth > 0) { depth = 0; } // unbalanced: give up on this group
    i++;
  }
  return { comments, groups };
}

const lineStartOf = (text, i) => text.lastIndexOf('\n', i - 1) + 1;
const indentAt = (text, i) => /^[ \t]*/.exec(text.slice(lineStartOf(text, i)))[0];

function cssFormat(src, lang, opts) {
  const scan = cssScan(src, lang);
  // 1. multi-line groups become placeholders
  let work = '';
  let last = 0;
  const kept = [];
  scan.groups.forEach((g, k) => {
    work += src.slice(last, g.start) + `__zovoKeep${k}__`;
    kept.push({ body: src.slice(g.start, g.end), indent: indentAt(src, g.start) });
    last = g.end;
  });
  work += src.slice(last);
  let out = beautify.css(work, opts);
  // 2. trailing comments back on their line (same comments, same order)
  const before = cssScan(work, lang).comments;
  const after = cssScan(out, lang).comments;
  if (before.length === after.length) {
    for (let k = after.length - 1; k >= 0; k--) {
      if (!before[k].trailing || after[k].trailing) continue;
      const ls = lineStartOf(out, after[k].start);
      const prevEnd = ls - 1;
      if (prevEnd <= 0) continue;
      const prevStart = lineStartOf(out, prevEnd);
      const prevLine = out.slice(prevStart, prevEnd);
      if (!prevLine.trim() || /\/\/|\/\*/.test(prevLine)) continue;
      out = out.slice(0, prevStart) + prevLine.replace(/\s+$/, '') + ' ' + out.slice(after[k].start);
    }
  }
  // 3. the groups come back, re-indented by how much their first line moved
  kept.forEach((g, k) => {
    const at = out.indexOf(`__zovoKeep${k}__`);
    if (at < 0) return;
    const newIndent = indentAt(out, at);
    const lines = g.body.split('\n').map((l, idx) => {
      if (idx === 0 || !l.trim()) return idx === 0 ? l : '';
      const lead = /^[ \t]*/.exec(l)[0];
      if (lead.startsWith(g.indent)) return newIndent + l.slice(g.indent.length);
      return newIndent + l.replace(/^[ \t]*/, '');
    });
    out = out.slice(0, at) + lines.join('\n') + out.slice(at + `__zovoKeep${k}__`.length);
  });
  return out;
}

/** Formats a whole file. lang: html | css | scss | less. Returns the new text. */
function formatText(text, o) {
  if (!LANGS.has(o.lang)) throw new Error(`No formatter for ${o.lang}.`);
  const opts = optionsFor(text, o);
  // js-beautify works on \n; the end of line is put back afterwards
  const src = text.replace(/\r\n?/g, '\n');
  let out = o.lang === 'html' ? beautify.html(src, { ...opts, eol: '\n' }) : cssFormat(src, o.lang, { ...opts, eol: '\n' });
  if (o.lang === 'html' && /<(pre|textarea)\b/i.test(out)) out = out.replace(/[ \t]+$/gm, (m, off, s) => (insideRaw(s, off) ? m : ''));
  else out = out.replace(/[ \t]+$/gm, '');
  if (opts.end_with_newline) out = out.replace(/\n*$/, '\n');
  else out = out.replace(/\n+$/, '');
  if (opts.eol !== '\n') out = out.replace(/\n/g, opts.eol);
  return out;
}

// trailing spaces inside <pre> and <textarea> are content: keep them
function insideRaw(s, off) {
  const before = s.slice(0, off);
  const open = Math.max(before.lastIndexOf('<pre'), before.lastIndexOf('<textarea'));
  if (open < 0) return false;
  const close = Math.max(before.lastIndexOf('</pre>'), before.lastIndexOf('</textarea>'));
  return close < open;
}

/** Formats a selection: the result is indented at the level of the selection's first line. */
function formatRange(text, o, baseIndent) {
  const opts = optionsFor(text, o);
  const unit = opts.indent_with_tabs ? '\t' : ' '.repeat(opts.indent_size);
  const src = text.replace(/\r\n?/g, '\n');
  const level = unit && baseIndent ? Math.floor((baseIndent.replace(/\t/g, unit).length) / unit.length) : 0;
  const run = { ...opts, eol: '\n', end_with_newline: false, indent_level: level };
  let out = o.lang === 'html' ? beautify.html(src, run) : beautify.css(src, run);
  // js-beautify does not indent the first line with indent_level: the caller keeps the original first-line indent
  out = out.replace(/^[ \t]+/, '');
  if (opts.eol !== '\n') out = out.replace(/\n/g, opts.eol);
  return out;
}

/** Indentation of a file on disk (for folder formatting, where no editor has detected it): { insertSpaces, tabSize }. */
function detectIndent(text, fallback = { insertSpaces: true, tabSize: 2 }) {
  let tabs = 0;
  const counts = new Map();
  let prev = 0;
  for (const line of text.split('\n')) {
    const m = /^([ \t]*)\S/.exec(line);
    if (!m) continue;
    if (m[1].startsWith('\t')) { tabs++; continue; }
    const d = Math.abs(m[1].length - prev);
    if (d >= 2 && d <= 8) counts.set(d, (counts.get(d) || 0) + 1);
    prev = m[1].length;
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (tabs > (best ? best[1] : 0)) return { insertSpaces: false, tabSize: fallback.tabSize };
  return best ? { insertSpaces: true, tabSize: best[0] } : fallback;
}

module.exports = { formatText, formatRange, optionsFor, detectInnerIndent, detectIndent, LANGS };
