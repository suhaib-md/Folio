// Export HTML: turns the rendered document into one self-contained, script-free
// page. buildExportHtml is pure (strings in, string out); the helpers around it
// do the I/O (local images, KaTeX fonts) through functions they are given.
import createDOMPurify from 'dompurify';

let purify = null;
function getPurify() {
  if (purify) return purify;
  purify = createDOMPurify(window);
  // Mermaid diagrams carry a scoped <style> inside their <svg>; any other
  // <style> in the document is not ours to keep.
  purify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && !node.closest?.('svg')) node.remove();
  });
  return purify;
}

const MIME = { jpg: 'jpeg', svg: 'svg+xml', ico: 'x-icon' };

// image/<type> for a path, from its extension.
export function mimeFor(path) {
  const ext = (/\.([a-z0-9]+)$/i.exec(String(path)) || [])[1]?.toLowerCase() || 'png';
  return `image/${MIME[ext] || ext}`;
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// KaTeX's stylesheet lists woff2, woff and ttf for every font. Keep only the
// woff2 sources that have a data URL in `fonts` (keyed by the url as written,
// e.g. "fonts/KaTeX_Main-Regular.woff2").
export function rewriteKatexCss(css, fonts) {
  return css.replace(/src:\s*([^;}]+)/g, (whole, list) => {
    const kept = [];
    for (const m of list.matchAll(/url\(\s*["']?([^)"']*)["']?\s*\)\s*(format\(\s*["']?woff2["']?\s*\))/g)) {
      const data = fonts.get(m[1]);
      if (data) kept.push(`url(${data}) ${m[2]}`);
    }
    return kept.length ? `src:${kept.join(',')}` : whole;
  });
}

// Every url(fonts/...x.woff2) a KaTeX stylesheet refers to.
export function katexFontUrls(css) {
  return [...new Set([...css.matchAll(/url\(\s*["']?([^)"']*\.woff2)["']?\s*\)/g)].map((m) => m[1]))];
}

// Document-only tweaks appended after the app stylesheet: the app's own rules
// lock the page to the window (overflow hidden, 100% height).
const EXPORT_CSS = 'html,body{height:auto}body{overflow:auto}.markdown.export{font-size:1rem}';

export function buildExportHtml({ title, bodyHtml, css, theme, images }) {
  const p = getPurify();
  const frag = p.sanitize(String(bodyHtml), {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'base', 'meta', 'link', 'iframe', 'object', 'embed', 'foreignObject', 'form'],
    FORBID_ATTR: ['srcdoc', 'formaction'],
    RETURN_DOM_FRAGMENT: true,
  });
  for (const img of frag.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    const data = img.hasAttribute('src') && images?.get(src);
    if (data) img.setAttribute('src', data);
    img.removeAttribute('data-local-path');
    img.removeAttribute('data-orig-src');
  }
  const box = window.document.createElement('div');
  box.append(frag);
  const body = box.innerHTML;
  const safeCss = String(css).replace(/<\/(style)/gi, '<\\/$1');
  const t = theme === 'dark' ? 'dark' : 'light';
  return `<!doctype html>
<html lang="en" data-theme="${t}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${safeCss}
${EXPORT_CSS}</style>
</head>
<body>
<main class="markdown export">${body}</main>
</body>
</html>
`;
}

// Local images of the (cloned) document as data URLs. Each <img> carrying
// data-local-path / data-orig-src (set when the document is rendered) is put
// back to its original src and, when `readBase64(path)` succeeds, listed in the
// returned map under that src. A failing or oversized image stays a link.
export async function collectImages(root, readBase64) {
  const images = new Map();
  const byPath = new Map();
  for (const img of root.querySelectorAll('img[data-local-path]')) {
    const path = img.getAttribute('data-local-path');
    const orig = img.getAttribute('data-orig-src');
    if (orig === null) continue;
    img.setAttribute('src', orig);
    if (!byPath.has(path)) {
      byPath.set(path, readBase64(path).then((b64) => `data:${mimeFor(path)};base64,${b64}`, () => null));
    }
    const data = await byPath.get(path);
    if (data) images.set(orig, data);
  }
  return images;
}

// CSS for the export: the app stylesheet plus, when the document has maths,
// KaTeX's with its woff2 fonts embedded. `fetchText(url)` / `fetchBase64(url)`
// are injected (the app passes fetch-based ones).
export async function collectCss(root, { fetchText, fetchBase64 }) {
  let css = await fetchText('./app.css');
  if (root.querySelector('.katex')) {
    try {
      const katex = await fetchText('./katex/katex.min.css');
      const fonts = new Map();
      await Promise.all(katexFontUrls(katex).map(async (u) => {
        try { fonts.set(u, `data:font/woff2;base64,${await fetchBase64(`./katex/${u}`)}`); } catch { /* font stays a missing file */ }
      }));
      css += `\n${rewriteKatexCss(katex, fonts)}`;
    } catch (err) {
      console.warn('KaTeX styles unavailable for export:', err);
    }
  }
  return css;
}
