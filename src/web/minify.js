'use strict';
// Minifier for HTML and CSS, written for this extension. Safe by design: it removes comments and whitespace that
// cannot change the page, and nothing else. It keeps <pre>, <textarea>, <script> and inline elements as they are,
// keeps /*! license */ comments and IE conditional comments, and never renames or reorders anything.

const zlib = require('zlib');
const { tokenize } = require('./htmltok');

// ---------- CSS ----------

/** Splits CSS into strings, comments and code so whitespace is only touched in code. */
function cssPieces(css) {
  const out = [];
  let i = 0;
  let code = '';
  const flush = () => { if (code) { out.push({ k: 'code', s: code }); code = ''; } };
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1;
      flush(); out.push({ k: 'str', s: css.slice(i, j + 1) }); i = j + 1; continue;
    }
    if (c === '/' && css[i + 1] === '*') {
      const j = css.indexOf('*/', i + 2);
      const end = j < 0 ? css.length : j + 2;
      flush(); out.push({ k: 'comment', s: css.slice(i, end) }); i = end; continue;
    }
    if ((c === 'u' || c === 'U') && /^url\(/i.test(css.slice(i, i + 4))) {
      const m = /^url\(\s*([^"')\s][^)]*?)\s*\)/i.exec(css.slice(i));
      if (m) { flush(); out.push({ k: 'str', s: `url(${m[1]})` }); i += m[0].length; continue; }
    }
    code += c;
    i++;
  }
  flush();
  return out;
}

function minifyCss(css) {
  // comments go (except /*! ... */); neighbouring code pieces are joined, then only code is touched
  const pieces = [];
  for (const p of cssPieces(css)) {
    if (p.k === 'comment' && !p.s.startsWith('/*!')) continue;
    const last = pieces[pieces.length - 1];
    if (p.k === 'code' && last && last.k === 'code') last.s += ' ' + p.s;
    else pieces.push({ ...p });
  }
  let out = '';
  pieces.forEach((p, k) => {
    if (p.k !== 'code') { out += p.s; return; }
    let s = p.s.replace(/\s+/g, ' ');
    // a kept /*! */ comment separates code: no space is needed next to it
    if (pieces[k - 1] && pieces[k - 1].k === 'comment') s = s.replace(/^ /, '');
    if (pieces[k + 1] && pieces[k + 1].k === 'comment') s = s.replace(/ $/, '');
    s = s.replace(/\s*([{};,])\s*/g, '$1'); // never around + - * / ( ) : (calc() and selectors need them)
    // "prop: value" loses the space after its colon; a selector such as "a :hover" keeps its space
    s = s.replace(/([{;]|^)([-\w]+)\s*:\s+/g, '$1$2:');
    s = s.replace(/;+}/g, '}').replace(/;;+/g, ';');
    out += s;
  });
  return out.trim();
}

// ---------- HTML ----------

const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'button', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'img', 'input', 'kbd', 'label', 'mark', 'meter', 'output', 'picture', 'progress', 'q', 's', 'samp', 'select', 'small', 'span', 'strong', 'sub', 'sup', 'svg', 'textarea', 'time', 'u', 'var', 'video', 'audio', 'canvas', 'iframe', 'object', 'math', 'wbr', 'del', 'ins', 'font', 'big', 'tt', 'slot', 'template']);

function minifyHtml(html) {
  const toks = tokenize(html);
  let out = '';
  let pre = 0;
  const isInlineTok = (t) => t && (t.type === 'tag' || t.type === 'endtag') && INLINE.has(t.name);
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'comment') {
      if (/^<!--\[if|^<!--<!\[endif|^<!--!/.test(t.text) || pre) out += t.text;
      continue;
    }
    if (t.type === 'raw') {
      if (t.name === 'style') out += minifyCss(t.text);
      else out += t.text; // script, textarea and title stay as they are
      continue;
    }
    if (t.type === 'tag' || t.type === 'endtag') {
      if (t.name === 'pre') pre += t.type === 'tag' ? 1 : -1;
      out += t.type === 'endtag' ? `</${t.name}>` : compactTag(t);
      if (pre < 0) pre = 0;
      continue;
    }
    if (t.type === 'doctype') { out += t.text; continue; }
    // text
    if (pre) { out += t.text; continue; }
    if (!/\S/.test(t.text)) {
      // whitespace between tags: needed only next to inline content
      const prev = toks[k - 1];
      const next = toks[k + 1];
      const prevInline = isInlineTok(prev) || (prev && prev.type === 'text');
      const nextInline = isInlineTok(next) || (next && next.type === 'text');
      if (prevInline && nextInline) out += ' ';
      continue;
    }
    out += t.text.replace(/\s+/g, ' ');
  }
  return out.trim();
}

function compactTag(t) {
  // keep attribute names, values and quotes; only the whitespace between them changes
  const m = /^<([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*?)(\/?)>$/.exec(t.text);
  if (!m) return t.text;
  const attrs = (t.attrs || []).map((a) => a.raw.replace(/\s*=\s*/, '=')).join(' ');
  return `<${m[1]}${attrs ? ' ' + attrs : ''}${m[3] ? '/' : ''}>`;
}

function sizes(before, after) {
  const gz = (s) => zlib.gzipSync(Buffer.from(s, 'utf8'), { level: 9 }).length;
  const b = Buffer.byteLength(before, 'utf8');
  const a = Buffer.byteLength(after, 'utf8');
  return { before: b, after: a, saved: b - a, pct: b ? Math.round(((b - a) / b) * 1000) / 10 : 0, gzBefore: gz(before), gzAfter: gz(after) };
}

module.exports = { minifyCss, minifyHtml, sizes };
