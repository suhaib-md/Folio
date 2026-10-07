import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { gfmHeadingId, resetHeadings } from 'marked-gfm-heading-id';
import createDOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

// Markdown text -> sanitised HTML. Takes a window so it runs in the browser,
// under jsdom in tests, and later inside the Tauri app.
export function createRenderer(win) {
  const marked = new Marked(
    markedHighlight({
      emptyLangClass: 'hljs',
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
    }),
    gfmHeadingId(),
  );

  const purify = createDOMPurify(win);
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') || '')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  return function renderMarkdown(text) {
    resetHeadings();
    const html = marked.parse(text.replace(/^﻿/, ''));
    // Named props are prefixed with "user-content-" so a heading like
    // "# Images" can't clobber document.images; main.js resolves #anchors.
    return purify.sanitize(html, { SANITIZE_NAMED_PROPS: true });
  };
}
