import { Marked } from 'marked';
import { gfmHeadingId, resetHeadings } from 'marked-gfm-heading-id';
import createDOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Fenced/indented code -> <pre><code class="hljs language-x">. Highlighting
// happens here, at render time, rather than in a walkTokens extension:
// marked's walkTokens concatenates arrays per token, which made big documents
// O(n^2) (a 1 MB file took ~48 s instead of well under a second).
function code({ text, lang }) {
  const name = (lang || '').match(/\S*/)[0];
  // Unlabelled or unknown languages stay plain: auto-detection is slow on big
  // blocks and miscolours logs, diagrams and data.
  const body = name && hljs.getLanguage(name)
    ? hljs.highlight(text, { language: name }).value
    : escapeHtml(text);
  const cls = name ? `hljs language-${escapeHtml(name)}` : 'hljs';
  return `<pre><code class="${cls}">${body.replace(/\n$/, '')}\n</code></pre>`;
}

// Markdown text -> sanitised HTML. Takes a window so it runs in the browser,
// under jsdom in tests, and later inside the Tauri app.
export function createRenderer(win) {
  const marked = new Marked({ renderer: { code } }, gfmHeadingId());

  const purify = createDOMPurify(win);
  purify.addHook('afterSanitizeAttributes', (node) => {
    // Every link except in-page anchors and mailto opens in a new tab, so a
    // click never navigates the viewer away from the open document.
    const href = node.tagName === 'A' ? node.getAttribute('href') : null;
    if (href && !href.startsWith('#') && !/^mailto:/i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  return function renderMarkdown(text) {
    resetHeadings();
    const html = marked.parse(text.replace(/^﻿/, ''));
    // Named props are prefixed with "user-content-" so a heading like
    // "# Images" can't clobber document.images; main.js resolves #anchors.
    // <style>, style="" and <form> could hide the app UI or fake a form.
    return purify.sanitize(html, {
      SANITIZE_NAMED_PROPS: true,
      FORBID_TAGS: ['style', 'form'],
      FORBID_ATTR: ['style'],
    });
  };
}
