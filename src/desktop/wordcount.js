// Word count and reading time for the toolbar. Pure, no DOM.
import { Lexer } from 'marked';

const WORD = /[\p{L}\p{N}\p{M}]+(?:['\u2019-][\p{L}\p{N}\p{M}]+)*/gu;
const ENTITY = /&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;
const FRONT_MATTER = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
// Inline syntax whose content is not prose: link/image targets (with an
// optional title), reference labels, tags, autolinks and bare urls. Markers
// (* _ ~ ` [ ] !) are not word characters, so they need no handling. A regex
// pass is ~5x faster than lexing every paragraph's inline tokens.
const TARGET = /\]\((?:[^()\s]|\([^()]*\))*(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)|\]\[[^\]]*\]|<\/?[a-z][^>\n]*>|<[a-z][a-z0-9+.-]*:[^>\s]*>|\b(?:https?:\/\/|www\.)[^\s<>)\]]+/gi;
const WORDS_PER_MINUTE = 230;

function countInline(s) {
  if (/[\](<:]/.test(s)) s = s.replace(TARGET, ' ');
  return countIn(s);
}

function countIn(s) {
  if (s.includes('&')) s = s.replace(ENTITY, ' ');
  WORD.lastIndex = 0;
  let n = 0;
  while (WORD.exec(s) !== null) n++;
  return n;
}

export function countWords(text) {
  const src = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(FRONT_MATTER, '');
  // Block-level pass only (like the outline): code, html and front matter
  // drop out; the text-bearing blocks get the cheap inline clean-up.
  const lexer = new Lexer();
  let total = 0;

  const run = (s) => {
    if (s) total += countInline(s);
  };

  const walk = (toks) => {
    for (const tok of toks) {
      switch (tok.type) {
        case 'paragraph':
        case 'heading':
        case 'text':
          if (tok.tokens && tok.tokens.length) walk(tok.tokens);
          else run(tok.text);
          break;
        case 'blockquote':
          walk(tok.tokens || []);
          break;
        case 'list':
          for (const item of tok.items) walk(item.tokens || []);
          break;
        case 'table':
          for (const c of tok.header) run(c.text);
          for (const row of tok.rows) for (const c of row) run(c.text);
          break;
        default: // code, html, hr, space, def
      }
    }
  };
  walk(lexer.blockTokens(src, []));
  return total;
}

function group(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatCount(words) {
  if (!(words > 0)) return '';
  const mins = Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
  return `${group(words)} ${words === 1 ? 'word' : 'words'} · ${mins} min read`;
}
