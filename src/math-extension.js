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
const BLOCK_AHEAD = /\n {0,3}\$\$[ \t]*\n?[\s\S]*?\n?[ \t]*\$\$[ \t]*(?=\n|$)/;
// $$ … $$ inside a line: display, no blank line inside.
const INLINE_DISPLAY = /^\$\$(?!\s*\$)((?:(?!\n[ \t]*\n)[^\\]|\\[\s\S])+?)\$\$/;
const INLINE = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/;

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
        const m = BLOCK_AHEAD.exec(src);
        return m ? m.index + 1 : undefined;
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
        const i = src.indexOf('$');
        return i < 0 ? undefined : i;
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
