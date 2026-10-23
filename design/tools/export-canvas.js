// Export Claude Design canvas artboards (.dc.html) to static HTML + PNG.
// Usage (from repo root, after `bun install`):
//   node design/tools/export-canvas.js            # uses Puppeteer's bundled Chrome
//   CHROME_PATH=/path/to/chrome node design/tools/export-canvas.js
// Reads design/canvas/*.dc.html + canvas.json, writes design/exports/{html,png}.
// The renderer is a minimal stand-in for the Claude Design runtime: it evaluates
// renderVals(), expands {{holes}}, <sc-for> and <sc-if>, and strips event bindings.
const path = require('path');
const fs = require('fs');

const repo = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const puppeteer = require(path.join(repo, 'node_modules', 'puppeteer'));
const canvasDir = path.join(repo, 'design', 'canvas');
const htmlDir = path.join(repo, 'design', 'exports', 'html');
const pngDir = path.join(repo, 'design', 'exports', 'png');
const canvas = JSON.parse(fs.readFileSync(path.join(canvasDir, 'canvas.json'), 'utf8'));

const FONT_CSS = `<style>
@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;src:url('../../assets/fonts/inter-latin-wght.woff2') format('woff2');}
@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:100 800;src:url('../../assets/fonts/jetbrains-mono-latin-wght.woff2') format('woff2');}
</style>`;

// Extra states rendered from the interactive artboards.
const VARIANTS = {
  'PopupMain.dc.html': [{ suffix: 'preset-stale-assets', state: { preset: 'stale', on: { http: true, cacheStorage: true, sw: true } } }],
  'PopupCookies.dc.html': [{ suffix: 'domain-wide', state: { mode: 'wide' } }]
};

// Runs in the page: renders the <x-dc> template with the component's renderVals().
function renderInPage(stateOverride) {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = this.state || {}; }
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p); }
    forceUpdate() {}
  }
  const scriptEl = document.querySelector('script[data-dc-script]');
  const Component = new Function('DCLogic', scriptEl.textContent + '\n;return Component;')(DCLogic);
  const inst = new Component({});
  if (stateOverride) Object.assign(inst.state, stateOverride);
  const vals = inst.renderVals() || {};

  const lookup = (expr, scope) => {
    const e = expr.trim();
    if (e === 'true') return true;
    if (e === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e);
    return e.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
  };
  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const interp = (str, scope) => str.replace(HOLE, (_, p) => {
    const v = lookup(p, scope);
    return v == null ? '' : String(v);
  });

  function processNode(node, scope) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.nodeValue.includes('{{')) node.nodeValue = interp(node.nodeValue, scope);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'sc-for') {
      const list = lookup(node.getAttribute('list').replace(/[{}]/g, ''), scope) || [];
      const as = node.getAttribute('as') || 'item';
      const frag = document.createDocumentFragment();
      list.forEach((item, i) => {
        node.childNodes.forEach(child => {
          const c = child.cloneNode(true);
          frag.appendChild(c);
          processNode(c, Object.assign({}, scope, { [as]: item, $index: i }));
        });
      });
      node.replaceWith(frag);
      return;
    }
    if (tag === 'sc-if') {
      const v = lookup(node.getAttribute('value').replace(/[{}]/g, ''), scope);
      if (v) {
        const kids = Array.from(node.childNodes);
        kids.forEach(k => processNode(k, scope));
        node.replaceWith(...Array.from(node.childNodes));
      } else {
        node.remove();
      }
      return;
    }
    for (const attr of Array.from(node.attributes)) {
      if (attr.name.startsWith('on') || attr.name.startsWith('hint-')) {
        node.removeAttribute(attr.name);
      } else if (attr.value.includes('{{')) {
        node.setAttribute(attr.name, interp(attr.value, scope));
      }
    }
    Array.from(node.childNodes).forEach(c => processNode(c, scope));
  }

  const root = document.querySelector('x-dc');
  const helmet = root.querySelector('helmet');
  if (helmet) {
    Array.from(helmet.children).forEach(el => document.head.appendChild(el));
    helmet.remove();
  }
  Array.from(root.childNodes).forEach(c => processNode(c, vals));
  root.replaceWith(...Array.from(root.childNodes));
  document.querySelectorAll('x-select').forEach(xs => {
    const sel = document.createElement('select');
    Array.from(xs.attributes).forEach(a => sel.setAttribute(a.name, a.value));
    Array.from(xs.childNodes).forEach(c => sel.appendChild(c));
    xs.replaceWith(sel);
  });
  scriptEl.remove();
}

function preprocess(src, title) {
  // The HTML parser drops unknown elements inside <select>, so template
  // loops there are parsed under a placeholder tag and restored after render.
  return src
    .replace(/<select(\s)/g, '<x-select$1')
    .replace(/<\/select>/g, '</x-select>')
    .replace(/<script src="\.\/support\.js"><\/script>\n?/, '')
    .replace(/<link rel="preconnect"[^>]*>\n?/g, '')
    .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/g, '')
    .replace(/\/_blob\/e43c2f8444afb16fbf26f97c287f9606/g, '../../assets/icon48.png')
    .replace(/href="([A-Za-z]+)\.dc\.html"/g, 'href="$1.html"')
    .replace('</head>', `<meta name="generator" content="Claude Design canvas export">\n${FONT_CSS}\n</head>`)
    .replace(/<title>[^<]*<\/title>/, m => m.replace('</title>', ` — ${title}</title>`));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files']
  });
  const report = [];
  for (const file of canvas.order) {
    const board = canvas.boards[file];
    const base = file.replace(/\.dc\.html$/, '');
    const src = fs.readFileSync(path.join(canvasDir, file), 'utf8');
    const jobs = [{ name: base, state: null }].concat((VARIANTS[file] || []).map(v => ({ name: `${base}--${v.suffix}`, state: v.state })));
    for (const job of jobs) {
      const tmp = path.join(htmlDir, `_tmp_${job.name}.html`);
      fs.writeFileSync(tmp, preprocess(src, board.title || base));
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.setViewport({ width: board.w, height: board.h, deviceScaleFactor: 2 });
      await page.goto('file://' + tmp, { waitUntil: 'load' });
      await page.evaluate(renderInPage, job.state);
      await page.evaluate(() => document.fonts.ready);
      await new Promise(r => setTimeout(r, 150));
      const html = '<!doctype html>\n' + await page.evaluate(() => document.documentElement.outerHTML);
      fs.writeFileSync(path.join(htmlDir, `${job.name}.html`), html + '\n');
      const leftover = (html.match(/\{\{|<sc-|<x-dc|data-dc-script/g) || []).length;
      const fullPage = board.expand === 'fill';
      await page.screenshot({ path: path.join(pngDir, `${job.name}.png`), fullPage, clip: fullPage ? undefined : { x: 0, y: 0, width: board.w, height: board.h } });
      const fonts = await page.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family));
      const clipped = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
        .filter(el => getComputedStyle(el).overflow === 'hidden' && el.scrollHeight > el.clientHeight + 1)
        .map(el => `${el.tagName}:${el.scrollHeight}>${el.clientHeight}`));
      report.push({ name: job.name, w: board.w, h: board.h, leftover, errors, fonts, clipped });
      await page.close();
      fs.unlinkSync(tmp);
    }
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})();
