// Word count and reading time for the toolbar. Pure, no DOM.
import { Lexer } from 'marked';

const WORD = /[\p{L}\p{N}\p{M}]+(?:['’_-][\p{L}\p{N}\p{M}]+)*/gu;
const ENTITY = /&(?:#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi;
const FRONT_MATTER = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/;
const WORDS_PER_MINUTE = 230;

// Inline syntax whose content is not prose: link/image targets (with an
// optional title), reference labels, tags, autolinks and bare urls. Markers
// (* _ ~ ` [ ] !) are not word characters, so they need no handling. A regex
// pass is ~5x faster than lexing every paragraph's inline tokens.
//
// Every alternative is linear: no scanned class can cross the character that
// starts a new attempt (`]` for targets and labels, `<` for tags), so a failed
// attempt never rescans text that a later attempt will scan again.
//
// Tag heuristic: `<` must be followed directly by the (optional `/`) name, and
// attributes must be `name=value`. So `<b>`,
// `<a href="x">` and `<br/>` are tags, but `if a<b and c>d` is prose.
const TARGET = new RegExp([
  // escaped brackets are literal text, so they can't open a link
  String.raw`\\[\[\]]`,
  // ](url "title") ](url 'title') ](url (title)) ](<none>)
  String.raw`\]\((?:[^()\s\]]|\([^()\]]*\))*(?:\s+(?:"[^"\]]*"|'[^'\]]*'|\([^()\]]*\)))?\s*\)`,
  // ][label]
  String.raw`\]\[[^\]]*\]`,
  // <tag attr="v">, </tag>, <br/>
  String.raw`<\/?[a-z][a-z0-9-]*(?:\s+[a-z_:][\w:.-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'|[^\s"'<>=` + '`' + String.raw`]+))*\s*\/?>`,
  // <https://x>, <mailto:a@b>
  String.raw`<[a-z][a-z0-9+.-]*:[^<>\s]*>`,
  // bare urls
  String.raw`\b(?:https?:\/\/|www\.)[^\s<>)\]]+`,
].join('|'), 'gi');
const NEEDS_CLEAN = /[\]\\<]|:\/\/|www\./i;
const CODE_SPAN = /(`+)([^`]+)\1(?!`)/g;

function cleanProse(s) {
  if (!NEEDS_CLEAN.test(s)) return s;
  return s.replace(TARGET, ' ');
}

function countInline(s) {
  if (s.indexOf('`') === -1) return countIn(cleanProse(s));
  // Code span content counts verbatim; only the prose around it is cleaned.
  let n = 0;
  let last = 0;
  CODE_SPAN.lastIndex = 0;
  let m;
  while ((m = CODE_SPAN.exec(s)) !== null) {
    n += countIn(cleanProse(s.slice(last, m.index)));
    n += countIn(m[2]);
    last = m.index + m[0].length;
  }
  return n + countIn(cleanProse(s.slice(last)));
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
