// marked extension for $…$ and $$…$$ maths. It only emits placeholders that
// carry the TeX source; rendering happens later (KaTeX, desktop only), so this
// file imports nothing and stays out of the web viewer unless asked for.
//
// Rules: the opening $ is not followed by whitespace, the closing $ is not
// preceded by whitespace and not followed by a digit (so "$5 and $10" is
// prose), \$ is a literal dollar (marked's escape rule), and code spans and
// blocks are consumed by marked before this runs.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

// $$ on its own lines (or alone on one line), closed by $$ ending a line.
const BLOCK = / {0,3}\$\$[ \t]*\n?([\s\S]*?)\n?[ \t]*\$\$[ \t]*(?=\n|$)/y;
// A line that could open a block: "$$" alone, or "$$ … $$" closed on the same
// line. (The closing line of a multi-line block is the tokenizer's business.)
const CANDIDATE = /\n {0,3}\$\$([^\n]*)/g;
// $$ … $$ inside a line: display, no blank line inside.
const INLINE_DISPLAY = /^\$\$(?!\s*\$)((?:(?!\n[ \t]*\n)[^\\]|\\[\s\S])+?)\$\$/;
const INLINE = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/;

// marked calls `start` once per paragraph / text run with a shrinking suffix of
// the same text. Scanning the whole remainder each time made lexing quadratic,
// so the next candidate is remembered as a distance from the END of the string
// (stable as the suffix shrinks) and only searched for again once passed.
// Entries are validated by the string's tail, so unrelated strings (nested
// blocks reuse the same lexer) never share a result.
const TAIL = 64;
const memo = new WeakMap(); // lexer -> { [key]: { len, tail, fromEnd } }
function next(lexer, key, src, scan) {
  const len = src.length;
  let m = memo.get(lexer);
  if (!m) memo.set(lexer, (m = {}));
  const e = m[key];
  if (e && len > TAIL && len <= e.len && src.endsWith(e.tail)) {
    if (e.fromEnd === 0) return undefined; // none anywhere in the longer suffix
    if (len - e.fromEnd >= 0) return len - e.fromEnd;
  }
  const pos = scan(src);
  m[key] = { len, tail: src.slice(-TAIL), fromEnd: pos < 0 ? 0 : len - pos };
  return pos < 0 ? undefined : pos;
}

function scanBlock(src) {
  CANDIDATE.lastIndex = 0;
  for (let m = CANDIDATE.exec(src); m; m = CANDIDATE.exec(src)) {
    const rest = m[1];
    if (!rest.trim() || /\$\$[ \t]*$/.test(rest)) return m.index + 1;
  }
  return -1;
}

const placeholder = (display, tex, block) => {
  const tag = block ? 'div' : 'span';
  const cls = display ? 'math-display' : 'math-inline';
  const e = esc(tex);
  return `<${tag} class="${cls}" data-tex="${e}">${e}</${tag}>`;
};

export const mathExtension = {
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start(src) {
        return next(this.lexer, 'block', src, scanBlock);
      },
      tokenizer(src) {
        BLOCK.lastIndex = 0;
        const m = BLOCK.exec(src);
        if (!m || !m[1].trim()) return undefined;
        return { type: 'mathBlock', raw: m[0] + (src[m[0].length] === '\n' ? '\n' : ''), text: m[1].trim() };
      },
      renderer: (t) => placeholder(true, t.text, true),
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src) {
        return next(this.lexer, 'inline', src, (t) => t.indexOf('$'));
      },
      tokenizer(src) {
        let m = INLINE_DISPLAY.exec(src);
        if (m && m[1].trim()) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
        m = INLINE.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
        return undefined;
      },
      renderer: (t) => placeholder(t.display, t.text, false),
    },
  ],
};
