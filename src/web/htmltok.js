'use strict';
// A small, tolerant HTML tokenizer for the lint report and the minifier: start and end tags with attributes and line
// numbers, text, comments, doctype, and the raw contents of script, style, textarea and title. It does not build a
// tree; the callers only need the token stream. Written for this extension.

const RAW = new Set(['script', 'style', 'textarea', 'title']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo; // 0-based
  };
}

function parseAttrs(src, base, lineOf) {
  const attrs = [];
  const re = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    attrs.push({ name: m[1].toLowerCase(), value: m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : null, line: lineOf(base + m.index), raw: m[0] });
  }
  return attrs;
}

/** @returns Array<{ type, name?, attrs?, text, start, end, line, selfClosing? }> */
function tokenize(text) {
  const out = [];
  const lineOf = lineIndex(text);
  let i = 0;
  const n = text.length;
  const pushText = (a, b) => { if (b > a) out.push({ type: 'text', text: text.slice(a, b), start: a, end: b, line: lineOf(a) }); };
  let textStart = 0;
  while (i < n) {
    if (text[i] !== '<') { i++; continue; }
    if (text.startsWith('<!--', i)) {
      pushText(textStart, i);
      const j = text.indexOf('-->', i + 4);
      const end = j < 0 ? n : j + 3;
      out.push({ type: 'comment', text: text.slice(i, end), start: i, end, line: lineOf(i) });
      i = textStart = end;
      continue;
    }
    if (text[i + 1] === '!' || text[i + 1] === '?') {
      pushText(textStart, i);
      const j = text.indexOf('>', i);
      const end = j < 0 ? n : j + 1;
      out.push({ type: 'doctype', text: text.slice(i, end), start: i, end, line: lineOf(i) });
      i = textStart = end;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(text.slice(i, i + 64));
    if (!m) { i++; continue; }
    // find the end of the tag, skipping quoted attribute values
    let j = i + m[0].length;
    let q = null;
    while (j < n) {
      const c = text[j];
      if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
      j++;
    }
    const end = Math.min(n, j + 1);
    pushText(textStart, i);
    const name = m[2].toLowerCase();
    if (m[1]) {
      out.push({ type: 'endtag', name, text: text.slice(i, end), start: i, end, line: lineOf(i) });
      i = textStart = end;
      continue;
    }
    const inner = text.slice(i + m[0].length, j);
    const tok = { type: 'tag', name, attrs: parseAttrs(inner, i + m[0].length, lineOf), text: text.slice(i, end), start: i, end, line: lineOf(i), selfClosing: /\/\s*$/.test(inner) || VOID.has(name) };
    out.push(tok);
    i = textStart = end;
    if (RAW.has(name) && !tok.selfClosing) {
      const close = new RegExp(`</${name}\\s*>`, 'i');
      const rest = text.slice(i);
      const cm = close.exec(rest);
      const rawEnd = cm ? i + cm.index : n;
      if (rawEnd > i) out.push({ type: 'raw', name, text: text.slice(i, rawEnd), start: i, end: rawEnd, line: lineOf(i) });
      i = textStart = rawEnd;
    }
  }
  pushText(textStart, n);
  return out;
}

const attr = (tok, name) => { const a = (tok.attrs || []).find((x) => x.name === name); return a ? (a.value === null ? '' : a.value) : undefined; };

module.exports = { tokenize, attr, VOID, RAW };
