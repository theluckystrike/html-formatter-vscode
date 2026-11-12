'use strict';
// .editorconfig reader, written for this extension from the EditorConfig spec: finds the files from the folder of the
// document up to the one with root = true, matches the section globs (*, **, ?, [abc], [!abc], {a,b}, {1..9}) and returns
// the properties that apply. Reads local files only.

const fs = require('fs');
const path = require('path');

function parseIni(text) {
  const out = { root: false, sections: [] };
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[(.*)\]$/.exec(line);
    if (sec) { cur = { glob: sec[1], props: {} }; out.sections.push(cur); continue; }
    const kv = /^([^=:]+?)\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const val = kv[2].replace(/\s+[#;].*$/, '').trim();
    if (!cur) { if (key === 'root') out.root = val.toLowerCase() === 'true'; continue; }
    cur.props[key] = val.toLowerCase() === 'unset' ? undefined : val;
  }
  return out;
}

function globToRegExp(glob) {
  let g = glob;
  // a glob with no slash matches the file name in any folder
  if (!g.includes('/')) g = `**/${g}`;
  else if (g.startsWith('/')) g = g.slice(1);
  let re = '';
  let i = 0;
  let braces = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '\\') { re += '\\' + (g[i + 1] || ''); i += 2; continue; }
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 3; } else { re += '.*'; i += 2; }
      } else { re += '[^/]*'; i++; }
      continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if (c === '[') {
      const j = g.indexOf(']', i + 1);
      if (j < 0) { re += '\\['; i++; continue; }
      let set = g.slice(i + 1, j);
      if (set.startsWith('!')) set = '^' + set.slice(1);
      re += `[${set.replace(/\\/g, '\\\\')}]`;
      i = j + 1;
      continue;
    }
    if (c === '{') {
      const j = g.indexOf('}', i + 1);
      const inner = j > 0 ? g.slice(i + 1, j) : '';
      const range = /^(-?\d+)\.\.(-?\d+)$/.exec(inner);
      if (range) {
        const a = Number(range[1]); const b = Number(range[2]);
        const nums = []; for (let k = Math.min(a, b); k <= Math.max(a, b) && nums.length < 1000; k++) nums.push(String(k));
        re += `(?:${nums.join('|')})`;
        i = j + 1;
        continue;
      }
      if (j > 0 && inner.includes(',')) { re += '(?:'; braces++; i++; continue; }
      re += '\\{'; i++;
      continue;
    }
    if (c === ',' && braces > 0) { re += '|'; i++; continue; }
    if (c === '}' && braces > 0) { re += ')'; braces--; i++; continue; }
    re += c.replace(/[.+^$()|{}]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${re}$`);
}

/**
 * Properties for a file: { indent_style, indent_size, tab_width, end_of_line, insert_final_newline, max_line_length, ... }
 * readFile(path) -> string | null (injectable for tests).
 */
function propertiesFor(file, readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }) {
  const chain = [];
  let dir = path.dirname(path.resolve(file));
  for (let k = 0; k < 64; k++) {
    const text = readFile(path.join(dir, '.editorconfig'));
    if (text != null) {
      const ini = parseIni(text);
      chain.unshift({ dir, ini });
      if (ini.root) break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const props = {};
  for (const { dir: d, ini } of chain) {
    const rel = path.relative(d, file).split(path.sep).join('/');
    for (const s of ini.sections) {
      let re;
      try { re = globToRegExp(s.glob); } catch { continue; }
      if (re.test(rel)) Object.assign(props, s.props);
    }
  }
  if (props.indent_style === 'tab' && props.indent_size === undefined) props.indent_size = 'tab';
  if (props.indent_size === 'tab' && props.tab_width) props.indent_size = props.tab_width;
  return props;
}

module.exports = { parseIni, globToRegExp, propertiesFor };
