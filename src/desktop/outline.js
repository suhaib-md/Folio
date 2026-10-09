// Pure heading extraction for the Outline panel. No DOM.
import { Lexer, Parser } from 'marked';
import GithubSlugger from 'github-slugger';
import { unescape } from 'marked-gfm-heading-id';

// Heading.id is the RAW slug, exactly what marked-gfm-heading-id puts in the
// heading's id and what `#slug` links carry. In the final DOM the sanitiser
// (SANITIZE_NAMED_PROPS) prefixes it: the element's id is `user-content-<id>`
// (see scrollToAnchor in main.js). Consumers look up `user-content-${id}`.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function countNewlines(s, end = s.length) {
  let n = 0;
  let i = s.indexOf('\n');
  while (i !== -1 && i < end) {
    n++;
    i = s.indexOf('\n', i + 1);
  }
  return n;
}

export function extractHeadings(text) {
  const out = [];
  const slugger = new GithubSlugger();
  // Block-level pass only: lex() would also tokenise every paragraph's inline
  // content (~3x slower on big files). Heading text is lexed on demand below.
  const lexer = new Lexer();
  const tokens = lexer.blockTokens(text.replace(/\r\n|\r/g, '\n'), []);

  const add = (tok, line) => {
    const html = Parser.parseInline(lexer.inlineTokens(tok.text));
    // Same plain-text rules as marked-gfm-heading-id.
    const raw = unescape(html).trim().replace(/<[!/a-z].*?>/gi, '');
    out.push({
      level: tok.depth,
      text: html
        .replace(/<[!/a-z].*?>/gi, '')
        .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])
        .trim(),
      id: slugger.slug(raw.toLowerCase()),
      line,
    });
  };

  // `base` is the 1-based line of the container's first line; children of
  // blockquotes/list items have their prefixes stripped, so locate them
  // inside the parent's raw text by their first line.
  const walk = (toks, parentRaw, base, nested) => {
    let line = base;
    let cursor = 0;
    for (const tok of toks) {
      let tokLine = line;
      if (nested) {
        const first = (tok.raw || '').split('\n')[0];
        if (first) {
          const at = parentRaw.indexOf(first, cursor);
          if (at !== -1) {
            tokLine = base + countNewlines(parentRaw, at);
            cursor = at + first.length;
          }
        }
      }
      if (tok.type === 'heading') add(tok, tokLine);
      else if (tok.type === 'blockquote') walk(tok.tokens || [], tok.raw, tokLine, true);
      else if (tok.type === 'list') {
        let itemCursor = 0;
        for (const item of tok.items) {
          const first = item.raw.split('\n')[0];
          const at = tok.raw.indexOf(first, itemCursor);
          const itemLine = at === -1 ? tokLine : tokLine + countNewlines(tok.raw, at);
          if (at !== -1) itemCursor = at + first.length;
          walk(item.tokens || [], item.raw, itemLine, true);
        }
      }
      if (!nested) line += countNewlines(tok.raw || '');
    }
  };
  walk(tokens, text, 1, false);
  return out;
}

export function buildOutline(headings) {
  const roots = [];
  const stack = [];
  headings.forEach((h, index) => {
    const node = { index, level: h.level, text: h.text, id: h.id, line: h.line, children: [] };
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  });
  return roots;
}

export function currentIndex(tops, scrollTop) {
  let lo = 0;
  let hi = tops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] <= scrollTop + 4) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

export function headingIndexForLine(headings, line) {
  let idx = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].line <= line) idx = i;
    else break;
  }
  return idx;
}
