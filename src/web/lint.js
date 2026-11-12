'use strict';
// HTML lint for the report: accessibility and structure checks that need no browser. Each finding has a rule id, a
// line (1-based) and a plain message. Written for this extension.

const { tokenize, attr } = require('./htmltok');

const RULES = {
  'img-alt': 'Image without alt text',
  'input-label': 'Form field without a label',
  'duplicate-id': 'Duplicate id',
  'heading-order': 'Heading level skipped',
  'html-lang': 'No lang on <html>',
  'document-title': 'No <title>',
  'link-name': 'Link without text',
  'button-name': 'Button without text',
  'iframe-title': 'iframe without title',
  'target-blank': 'target="_blank" without rel="noopener"',
  'deprecated-element': 'Obsolete element',
  'multiple-h1': 'More than one <h1>',
};
const OBSOLETE = new Set(['center', 'font', 'marquee', 'blink', 'big', 'strike', 'tt', 'frame', 'frameset', 'acronym', 'applet', 'basefont', 'dir']);
const LABELLED = (t) => attr(t, 'aria-label') || attr(t, 'aria-labelledby') || attr(t, 'title');

function lint(text) {
  const toks = tokenize(text);
  const out = [];
  const add = (rule, line, message) => out.push({ rule, line: line + 1, message });
  const ids = new Map();
  const labelFor = new Set();
  const fields = [];
  let labelDepth = 0;
  let lastHeading = 0;
  let h1 = 0;
  let sawHtml = null;
  let sawTitle = false;
  let isDocument = false;
  // links and buttons: collect their inner text and image alts until the end tag
  const open = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.type === 'doctype' && /^<!doctype/i.test(t.text)) isDocument = true;
    if (t.type === 'raw' && t.name === 'title' && t.text.trim()) sawTitle = true;
    if (t.type === 'text' && /\S/.test(t.text)) for (const o of open) o.text += t.text;
    if (t.type === 'endtag') {
      if (t.name === 'label') labelDepth = Math.max(0, labelDepth - 1);
      const idx = open.map((o) => o.name).lastIndexOf(t.name);
      if (idx >= 0) {
        const o = open.splice(idx, 1)[0];
        if (!o.text.trim() && !o.named) add(o.name === 'a' ? 'link-name' : 'button-name', o.line, o.name === 'a' ? `<a href="${o.href || ''}"> has no text, image alt or aria-label, so a screen reader announces only "link".` : '<button> has no text or aria-label.');
      }
      continue;
    }
    if (t.type !== 'tag') continue;
    const id = attr(t, 'id');
    if (id) { if (!ids.has(id)) ids.set(id, []); ids.get(id).push(t.line); }
    switch (t.name) {
      case 'html':
        sawHtml = t; isDocument = true;
        break;
      case 'img': {
        const alt = attr(t, 'alt');
        if (alt === undefined && attr(t, 'role') !== 'presentation' && attr(t, 'aria-hidden') !== 'true') add('img-alt', t.line, `<img src="${attr(t, 'src') || ''}"> has no alt attribute. Use alt="" for a decorative image.`);
        for (const o of open) if (alt) o.text += alt;
        break;
      }
      case 'label':
        labelDepth++;
        if (attr(t, 'for')) labelFor.add(attr(t, 'for'));
        break;
      case 'input': case 'select': case 'textarea': {
        const type = (attr(t, 'type') || '').toLowerCase();
        if (t.name === 'input' && ['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) {
          if (type === 'image' && attr(t, 'alt') === undefined) add('img-alt', t.line, '<input type="image"> has no alt attribute.');
          break;
        }
        fields.push({ t, inLabel: labelDepth > 0 });
        break;
      }
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = Number(t.name[1]);
        if (lastHeading && level > lastHeading + 1) add('heading-order', t.line, `<${t.name}> follows <h${lastHeading}>: level ${lastHeading + 1} is skipped.`);
        lastHeading = level;
        if (level === 1 && ++h1 === 2) add('multiple-h1', t.line, 'A second <h1> on the page. One <h1> per page is clearer for screen readers and search engines.');
        break;
      }
      case 'a':
        if (attr(t, 'href') !== undefined && !t.selfClosing) open.push({ name: 'a', line: t.line, text: '', named: !!LABELLED(t), href: attr(t, 'href') });
        if (attr(t, 'target') === '_blank' && !/noopener|noreferrer/i.test(attr(t, 'rel') || '')) add('target-blank', t.line, `<a target="_blank"> to ${attr(t, 'href') || 'a page'} has no rel="noopener". Modern browsers imply it, older ones let the new page control this one.`);
        break;
      case 'button':
        open.push({ name: 'button', line: t.line, text: '', named: !!LABELLED(t) });
        break;
      case 'iframe':
        if (!attr(t, 'title') && !LABELLED(t)) add('iframe-title', t.line, `<iframe src="${attr(t, 'src') || ''}"> has no title.`);
        break;
      default:
        if (OBSOLETE.has(t.name)) add('deprecated-element', t.line, `<${t.name}> is obsolete in HTML. Use CSS instead.`);
    }
  }
  for (const f of fields) {
    const fid = attr(f.t, 'id');
    if (f.inLabel || (fid && labelFor.has(fid)) || LABELLED(f.t)) continue;
    add('input-label', f.t.line, `<${f.t.name}${attr(f.t, 'name') ? ` name="${attr(f.t, 'name')}"` : ''}> has no <label>, aria-label or title.${attr(f.t, 'placeholder') !== undefined ? ' A placeholder is not a label.' : ''}`);
  }
  for (const [id, lines] of ids) if (lines.length > 1) for (const l of lines.slice(1)) add('duplicate-id', l, `id="${id}" is used ${lines.length} times (first on line ${lines[0] + 1}).`);
  if (isDocument && sawHtml && attr(sawHtml, 'lang') === undefined) add('html-lang', sawHtml.line, '<html> has no lang attribute, so screen readers may read the page in the wrong language.');
  if (isDocument && sawHtml && !sawTitle) add('document-title', sawHtml.line, 'The page has no <title>.');
  out.sort((a, b) => a.line - b.line);
  return out;
}

function markdown(results, { title = 'HTML lint report', when = new Date(), root = '' } = {}) {
  const L = [`# ${title}`, ''];
  const total = results.reduce((n, r) => n + r.findings.length, 0);
  L.push(`${results.length} HTML file(s)${root ? ` in ${root}` : ''}, ${total} finding(s). ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC.`, '');
  if (!total) { L.push('No findings.', ''); return L.join('\n'); }
  const counts = {};
  for (const r of results) for (const f of r.findings) counts[f.rule] = (counts[f.rule] || 0) + 1;
  L.push('| Check | Count |', '| --- | --- |');
  for (const [rule, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) L.push(`| ${RULES[rule] || rule} | ${n} |`);
  L.push('');
  for (const r of results) {
    if (!r.findings.length) continue;
    L.push(`## ${r.file}`, '');
    for (const f of r.findings) L.push(`- line ${f.line}: ${f.message.replace(/</g, '&lt;')} (${f.rule})`);
    L.push('');
  }
  return L.join('\n');
}

module.exports = { lint, markdown, RULES };
