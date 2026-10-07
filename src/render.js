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
        // Unlabelled or unknown languages stay plain: auto-detection is slow
        // on big blocks and miscolours logs, diagrams and data.
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return code;
      },
    }),
    gfmHeadingId(),
  );

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
