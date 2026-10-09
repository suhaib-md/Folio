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
//
// Why this is sound: marked's lexer works in "runs" (one blockTokens or
// inlineTokens call). Inside a run it only ever consumes from the FRONT
// (`src = src.substring(n)`), and calls `start` with `src.slice(1)`, so every
// string a run passes to `start` is a suffix of the string the run began with.
// Two suffixes of one string with lengths a >= b agree on their last b
// characters, so a candidate found in the longer one that still lies inside
// the shorter one is the first candidate there too (candidates depend only on
// the text from the candidate onwards, and nothing earlier can exist, since the
// longer scan found none before it). The memo therefore lives in a per-run
// frame: the lexer's blockTokens / inlineTokens are wrapped to push a frame,
// and a frame is never shared with another run (nested runs get their own).
// Strings are never compared by content. The one run already in progress when
// the wrapper is installed gets an implicit frame at the bottom of the stack;
// every later run is wrapped, so no unwrapped run can see it.
//
// Installation: marked tries extension tokenizers at the very first iteration
// of every run, before anything that could start a nested run (blockquote,
// list item, em/strong/link content). Both extension tokenizers call
// stacksFor() first, so the wrappers always go in while the OUTERMOST run is
// the active one, and the implicit frame is that run's. (Installing it from
// `start` alone was unsound: the first `start` call can come from inside a
// nested run, whose frame would then be shared with the outer run.) A length that
// grows (cannot happen within a run) resets the frame as a safeguard.
const lexers = new WeakMap(); // lexer -> { block: Frame[], inline: Frame[] }
const newFrame = () => ({ len: Infinity, fromEnd: -1, known: false });

function stacksFor(lexer) {
  let st = lexers.get(lexer);
  if (st) return st;
  st = { block: [], inline: [] };
  lexers.set(lexer, st);
  for (const [kind, method] of [['block', 'blockTokens'], ['inline', 'inlineTokens']]) {
    const orig = lexer[method];
    lexer[method] = function (...args) {
      const stack = st[kind];
      stack.push(newFrame());
      try {
        return orig.apply(this, args);
      } finally {
        stack.pop();
      }
    };
  }
  return st;
}

// minPos: the lowest index a candidate may have in a suffix (block candidates
// need the preceding "\n" inside the string).
function next(lexer, kind, src, scan, minPos) {
  const stack = stacksFor(lexer)[kind];
  if (!stack.length) stack.push(newFrame()); // implicit frame, see above
  const f = stack[stack.length - 1];
  const len = src.length;
  if (f.known && len <= f.len) {
    if (f.fromEnd === 0) return undefined; // no candidate anywhere in the longer suffix
    if (len - f.fromEnd >= minPos) return len - f.fromEnd;
  }
  const pos = scan(src);
  f.known = true;
  f.len = len;
  f.fromEnd = pos < 0 ? 0 : len - pos;
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

export function createMathExtension() {
  return {
    extensions: [
      {
        name: 'mathBlock',
        level: 'block',
        start(src) {
          return next(this.lexer, 'block', src, scanBlock, 1);
        },
        tokenizer(src) {
          stacksFor(this.lexer); // see "Installation" above
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
          return next(this.lexer, 'inline', src, (t) => t.indexOf('$'), 0);
        },
        tokenizer(src) {
          stacksFor(this.lexer); // see "Installation" above
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
}

export const mathExtension = createMathExtension();
