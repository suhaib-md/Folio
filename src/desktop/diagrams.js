// Lazy post-render enhancement of the document: KaTeX for the maths
// placeholders and Mermaid for ```mermaid blocks. Both libraries are dynamic
// imports (separate chunks) that load only when the document needs them.
import createDOMPurify from 'dompurify';

const purify = createDOMPurify(window);
// Mermaid (even in strict mode) emits <a xlink:href> for `click A "url"`. A
// diagram is a picture: its links are dropped so a click can't navigate.
purify.addHook('uponSanitizeAttribute', (node, data) => {
  if (node.nodeName.toLowerCase() === 'a' && /^(xlink:)?href$/i.test(data.attrName)) data.keepAttr = false;
});

let katexPromise = null;
let mermaidPromise = null;
let mermaidTheme = null;
let cssLinked = false;
let generation = 0;

const CACHE_MAX = 200;
const svgCache = new Map(); // theme + '\n' + source -> { svg: sanitised SVG string, id }
let diagramSeq = 0;

function linkKatexCss() {
  if (cssLinked) return;
  cssLinked = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './katex/katex.min.css';
  document.head.append(link);
}

function loadKatex() {
  katexPromise ||= import('katex').then((m) => m.default || m);
  katexPromise.catch(() => { katexPromise = null; });
  return katexPromise;
}

async function loadMermaid(theme) {
  mermaidPromise ||= import('mermaid').then((m) => m.default || m);
  const mermaid = await mermaidPromise.catch((err) => {
    mermaidPromise = null;
    throw err;
  });
  if (mermaidTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: theme === 'dark' ? 'dark' : 'default',
      // A diagram's own %%{init}%% directive can't change these.
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering',
        'maxEdges', 'htmlLabels', 'themeCSS', 'fontFamily'],
    });
    mermaidTheme = theme;
  }
  return mermaid;
}

function cacheSet(key, svg) {
  svgCache.delete(key);
  svgCache.set(key, svg);
  if (svgCache.size > CACHE_MAX) svgCache.delete(svgCache.keys().next().value);
}

// Sanitised SVG markup -> element, parsed in an inert template.
function sanitizeSvg(svg) {
  return purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['foreignObject', 'script'],
  });
}

function svgNode(svgString) {
  const tpl = document.createElement('template');
  tpl.innerHTML = svgString;
  return tpl.content.firstElementChild;
}

function showError(pre, message) {
  const next = pre.nextElementSibling;
  if (next && next.classList.contains('diagram-error')) next.remove();
  const div = document.createElement('div');
  div.className = 'diagram-error';
  div.textContent = `Diagram error: ${message}`;
  pre.after(div);
}

const mathCache = new Map(); // display + errorColor + tex -> detached rendered element
const MATH_CACHE_MAX = 500;

async function renderMath(nodes, myGen) {
  linkKatexCss();
  let katex;
  try {
    katex = await loadKatex();
  } catch (err) {
    console.warn('loading KaTeX failed:', err);
    return; // the TeX source stays visible
  }
  if (myGen !== generation) return;
  // Inline style beats CSS, so the error colour comes from the theme here.
  const errorColor = getComputedStyle(document.documentElement).getPropertyValue('--danger-fg').trim() || '#cc0000';
  for (const el of nodes) {
    const tex = el.getAttribute('data-tex') ?? el.textContent;
    const displayMode = el.classList.contains('math-display');
    const key = `${displayMode ? 'D' : 'I'}${errorColor}\n${tex}`;
    try {
      let done = mathCache.get(key);
      if (done) {
        mathCache.delete(key);
      } else {
        done = document.createElement('span');
        katex.render(tex, done, { displayMode, throwOnError: false, trust: false, strict: 'ignore', errorColor });
        if (mathCache.size >= MATH_CACHE_MAX) mathCache.delete(mathCache.keys().next().value);
      }
      mathCache.set(key, done);
      el.replaceChildren(...done.cloneNode(true).childNodes);
    } catch (err) {
      console.warn('KaTeX failed:', err);
    }
  }
}

const sources = new WeakMap(); // rendered .diagram wrapper -> its Mermaid source

// Every inserted copy gets its own id prefix (the SVG's ids and its scoped
// <style> all carry it), so a diagram that appears twice can't collide.
function wrap({ svg, id }, source) {
  const fresh = `folio-mermaid-${++diagramSeq}`;
  const div = document.createElement('div');
  div.className = 'diagram';
  const node = svgNode(id === fresh ? svg : svg.split(id).join(fresh));
  if (node) div.append(node);
  sources.set(div, source);
  return div;
}

function codeBlock(source) {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.className = 'hljs language-mermaid';
  code.textContent = `${source}\n`;
  pre.append(code);
  return pre;
}

async function renderDiagrams(items, theme, myGen) {
  // Cached results go in synchronously (no flicker, no Mermaid load).
  const todo = [];
  for (const item of items) {
    const key = `${theme}\n${item.source}`;
    const hit = svgCache.get(key);
    if (hit) {
      cacheSet(key, hit);
      item.target.replaceWith(wrap(hit, item.source));
    } else {
      todo.push(item);
    }
  }
  if (!todo.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid(theme);
  } catch (err) {
    if (myGen === generation) for (const t of todo) fail(t, err?.message || 'Mermaid failed to load');
    return;
  }
  for (const item of todo) {
    if (myGen !== generation) return;
    const id = `folio-mermaid-${++diagramSeq}`;
    try {
      const { svg } = await mermaid.render(id, item.source);
      if (myGen !== generation) return;
      const clean = sanitizeSvg(svg);
      if (!clean || !svgNode(clean)) throw new Error('empty diagram');
      const entry = { svg: clean, id };
      cacheSet(`${theme}\n${item.source}`, entry);
      item.target.replaceWith(wrap(entry, item.source));
    } catch (err) {
      // Mermaid leaves a temporary error element behind in <body>.
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
      if (myGen !== generation) return;
      fail(item, String(err?.message || err).split('\n')[0]);
    }
  }
}

// Keep (or restore) the code block and say why it isn't a diagram.
function fail(item, message) {
  let pre = item.target;
  if (!pre.matches('pre')) {
    pre = codeBlock(item.source);
    item.target.replaceWith(pre);
  }
  showError(pre, message);
}

// Enhance the rendered document in place. A later call (or reset) abandons
// any run still in flight, so a stale run never writes into a replaced DOM.
export async function renderEnhancements(docEl, { theme }) {
  const myGen = ++generation;
  const maths = [...docEl.querySelectorAll('.math-inline, .math-display')];
  // Fresh code blocks, plus diagrams already drawn (a theme change redraws them).
  const items = [];
  for (const el of docEl.querySelectorAll('pre > code.language-mermaid, .diagram')) {
    if (el.matches('.diagram')) {
      const source = sources.get(el);
      if (source !== undefined) items.push({ target: el, source });
    } else {
      items.push({ target: el.parentElement, source: el.textContent.replace(/\n$/, '') });
    }
  }
  const jobs = [];
  if (maths.length) jobs.push(renderMath(maths, myGen));
  if (items.length) jobs.push(renderDiagrams(items, theme, myGen));
  await Promise.all(jobs);
}
