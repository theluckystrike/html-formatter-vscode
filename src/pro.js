'use strict';
// Zovo Pro for HTML Formatter & CSS Formatter, on top of the shared license module (src/license, copied unchanged from
// factory/sprint/license by apply.sh). Three Pro tools, 3 free tries each on this computer. A try counts only after the
// tool produced its output (files written or a report opened); Escape, Cancel or an error never uses one.
// Nothing about Pro shows on open or activation: the panel appears only after a click on a Pro tool with no tries left.
const { createLicense } = require('./license');

const SKU = 'html-formatter-pro';
const TRIAL_USES = 3;
const TRIAL_KEY = 'zovoHtmlFormat.proTrial';

const FEATURES = {
  folder: {
    title: 'Format a folder with a diff preview',
    detail: 'Formats every HTML, CSS, SCSS and LESS file of a folder in memory, shows the changed files with a side-by-side diff, and writes only the ones you keep checked.',
  },
  minify: {
    title: 'Minify HTML and CSS',
    detail: 'Writes .min.html and .min.css copies with comments and needless whitespace removed, and a report of the bytes and gzip bytes saved per file.',
  },
  lint: {
    title: 'HTML lint report',
    detail: 'Checks every page for images without alt text, form fields without labels, duplicate ids, skipped heading levels, links without text and more, as a Markdown report and in the Problems panel.',
  },
};
const TOOLS = Object.values(FEATURES).map((f) => f.title);

function surfaceOf(arg) {
  if (arg && typeof arg === 'object' && typeof arg.surface === 'string') return arg.surface;
  if (arg && typeof arg === 'object' && (arg.fsPath || arg.scheme)) return 'ctx';
  return undefined;
}

function createPro({ vscode, context, license, prefix = 'zovoHtmlFormat', productName = 'HTML Formatter & CSS Formatter' }) {
  const emitter = new vscode.EventEmitter();
  const lic = license || createLicense({ vscode, context, sku: SKU, name: 'Zovo', product: productName, commandPrefix: prefix, proTools: TOOLS });
  if (lic.onDidChange) lic.onDidChange(() => emitter.fire(lic.isPro(SKU)));

  // Counts never go down in a session: VS Code's shared globalState can hand back an older value for a moment after a
  // write from another window or at start-up, so the highest count seen here wins.
  const seen = {};
  const used = (f) => Math.max(Number((context.globalState.get(TRIAL_KEY) || {})[f]) || 0, seen[f] || 0);
  const left = (f) => (FEATURES[f] ? Math.max(0, TRIAL_USES - used(f)) : 0);
  const licensed = () => lic.isPro(SKU);

  /** Before a Pro tool runs: true when it may run (licensed, or a free try left). Otherwise the one panel. */
  async function allowed(f, arg) {
    if (licensed()) { if (lic.refresh) lic.refresh(); return true; }
    if (left(f) > 0) return true;
    const feat = FEATURES[f] || { title: 'This tool', detail: '' };
    const surface = surfaceOf(arg);
    return !!(await lic.requirePro(feat.title, { detail: feat.detail, triesUsed: used(f), tools: TOOLS, ...(surface ? { surface } : {}) }));
  }

  /** After the tool produced its output: counts one free try (nothing when licensed). */
  async function produced(f) {
    if (licensed() || !FEATURES[f]) return;
    const m = { ...(context.globalState.get(TRIAL_KEY) || {}) };
    for (const k of Object.keys(seen)) m[k] = Math.max(Number(m[k]) || 0, seen[k]);
    m[f] = used(f) + 1;
    seen[f] = m[f];
    await context.globalState.update(TRIAL_KEY, m);
    const l = left(f);
    vscode.window.setStatusBarMessage(`Zovo Pro: free try ${used(f)} of ${TRIAL_USES} of "${FEATURES[f].title}" used${l ? `, ${l} left` : ''} on this computer.`, 8000);
    emitter.fire(false);
  }

  context.subscriptions.push(emitter);
  return {
    SKU, FEATURES, TRIAL_USES,
    get licensed() { return licensed(); },
    ready: lic.ready,
    allowed, produced, left,
    tries: () => Object.fromEntries(Object.keys(FEATURES).map((f) => [f, left(f)])),
    handleUri: (uri) => (lic.handleUri ? lic.handleUri(uri) : undefined),
    onDidChange: emitter.event,
    license: lic,
  };
}

module.exports = { createPro, FEATURES, SKU, TRIAL_USES, TRIAL_KEY, TOOLS, surfaceOf };
