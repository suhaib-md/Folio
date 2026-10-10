// Pure heading extraction for the Outline panel. No DOM.
import { Lexer, Marked, Parser } from 'marked';
import GithubSlugger from 'github-slugger';
import { unescape } from 'marked-gfm-heading-id';
import { mathExtension } from '../math-extension.js';

// Heading.id is the RAW slug, exactly what marked-gfm-heading-id puts in the
// heading's id and what `#slug` links carry. In the final DOM the sanitiser
// (SANITIZE_NAMED_PROPS) prefixes it: the element's id is `user-content-<id>`
// (see scrollToAnchor in main.js). Consumers look up `user-content-${id}`.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '\u00a9', reg: '\u00ae',
  trade: '\u2122', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', laquo: '\u00ab', raquo: '\u00bb', middot: '\u00b7', times: '\u00d7',
  deg: '\u00b0', euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', sect: '\u00a7',
  para: '\u00b6', larr: '\u2190', rarr: '\u2192', uarr: '\u2191', darr: '\u2193', bull: '\u2022',
};

function decodeEntity(m, body) {
  if (body[0] === '#') {
    const n = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    try {
      return String.fromCodePoint(n);
    } catch {
      return m;
    }
  }
  return NAMED[body.toLowerCase()] ?? m;
}

function countNewlines(s, end = s.length) {
  let n = 0;
  let i = s.indexOf('\n');
  while (i !== -1 && i < end) {
    n++;
    i = s.indexOf('\n', i + 1);
  }
  return n;
}

// `math`: lex heading text with the maths extension too, so the slug matches
// the renderer's when a heading contains $x$.
const mathOptions = new Marked(mathExtension).defaults;

export function extractHeadings(text, { math = false } = {}) {
  const out = [];
  const slugger = new GithubSlugger();
  // Block-level pass only: lex() would also tokenise every paragraph's inline
  // content (~3x slower on big files). Heading text is lexed on demand below.
  const lexer = new Lexer(math ? mathOptions : undefined);
  const tokens = lexer.blockTokens(text.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n'), []);

  const add = (tok, line) => {
    const html = Parser.parseInline(lexer.inlineTokens(tok.text), math ? mathOptions : undefined);
    // Same plain-text rules as marked-gfm-heading-id.
    const raw = unescape(html).trim().replace(/<[!/a-z].*?>/gi, '');
    out.push({
      level: tok.depth,
      text: html
        .replace(/<[!/a-z].*?>/gi, '')
        .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
        .trim(),
      id: slugger.slug(raw.toLowerCase()),
      line,
    });
  };

  // `base` is the 1-based line of the container's first line. Every token's
  // raw keeps its newlines (container prefixes are stripped but lines are
  // not), so summing newlines of raw gives each child's line.
  const walk = (toks, base) => {
    let line = base;
    for (const tok of toks) {
      if (tok.type === 'heading') add(tok, line);
      else if (tok.type === 'blockquote') walk(tok.tokens || [], line);
      else if (tok.type === 'list') {
        let itemLine = line;
        for (const item of tok.items) {
          walk(item.tokens || [], itemLine);
          itemLine += countNewlines(item.raw);
        }
      }
      line += countNewlines(tok.raw || '');
    }
  };
  walk(tokens, 1);
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

// The heading a `#fragment` of a link points at: percent-decoded, a leading
// `user-content-` dropped, matched against the raw heading ids. null when
// there is none.
export function headingForFragment(text, frag, opts) {
  let id = String(frag ?? '');
  try {
    id = decodeURIComponent(id);
  } catch {
    // keep as written
  }
  id = id.replace(/^user-content-/, '');
  if (!id) return null;
  return extractHeadings(text, opts).find((h) => h.id === id) || null;
}
