import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createRenderer } from '../src/render.js';
import { extractHeadings } from '../src/desktop/outline.js';
import { budget, bestOf } from './perf-budget.mjs';

const win = new JSDOM('').window;
const plain = createRenderer(win);
const math = createRenderer(win, { math: true });
const dom = (html) => new JSDOM(html).window.document;

test('inline and display maths placeholders', () => {
  const d = dom(math('Text $a^2+b^2$ more.\n\n$$\\sum_i x_i$$\n'));
  const i = d.querySelector('span.math-inline');
  assert.equal(i.getAttribute('data-tex'), 'a^2+b^2');
  assert.equal(i.textContent, 'a^2+b^2');
  const b = d.querySelector('div.math-display');
  assert.equal(b.getAttribute('data-tex'), '\\sum_i x_i');
  assert.equal(d.querySelectorAll('p div').length, 0);
});

test('$$ spans lines', () => {
  const d = dom(math('before\n\n$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n\nafter'));
  const b = d.querySelector('div.math-display');
  assert.match(b.getAttribute('data-tex'), /^\\begin\{aligned\}\na &= b \\\\\nc &= d\n\\end\{aligned\}$/);
  assert.equal(d.querySelectorAll('p').length, 2);
});

test('inline $$ within a line is display too', () => {
  const d = dom(math('see $$x^2$$ here'));
  assert.equal(d.querySelector('p .math-display').getAttribute('data-tex'), 'x^2');
});

test('currency is not maths', () => {
  const src = 'It costs $5 and $10 today.';
  assert.equal(math(src), plain(src));
  assert.equal(dom(math(src)).querySelectorAll('[data-tex]').length, 0);
});

test('escaped dollar', () => {
  const src = 'a \\$x\\$ b';
  assert.equal(math(src), plain(src));
  assert.match(math(src), /a \$x\$ b/);
});

test('dollar in code span and fence untouched', () => {
  const src = 'a `$x$` b\n\n```\n$$\ny\n$$\n$z$\n```\n';
  assert.equal(math(src), plain(src));
});

test('space after opening $ is not maths', () => {
  assert.equal(dom(math('a $ x$ b')).querySelectorAll('[data-tex]').length, 0);
  assert.equal(dom(math('a $x $ b')).querySelectorAll('[data-tex]').length, 0);
});

test('closing $ followed by digit is not maths', () => {
  assert.equal(dom(math('a $x$5 b')).querySelectorAll('[data-tex]').length, 0);
});

test('tex is attribute-escaped', () => {
  const html = math('$a<b "q" & c$');
  const el = dom(html).querySelector('.math-inline');
  assert.equal(el.getAttribute('data-tex'), 'a<b "q" & c');
  assert.equal(el.textContent, 'a<b "q" & c');
  assert.equal(dom(html).querySelectorAll('b').length, 0);
});

test('hostile tex cannot inject markup', () => {
  const d = dom(math('$$<img src=x onerror=alert(1)>$$\n\n$<script>alert(1)</script>$'));
  assert.equal(d.querySelectorAll('img, script').length, 0);
});

test('default renderer unchanged (byte-identical to the 0.2 snapshot)', () => {
  const sample = readFileSync('tests/sample.md', 'utf8');
  // Snapshot of createRenderer(win)(sample.md) from commit 45a2e56.
  const snapshot = readFileSync('tests/fixtures/sample.0.2.html', 'utf8');
  assert.equal(plain(sample), snapshot);
  assert.equal(createRenderer(win, { math: false })(sample), snapshot);
  const dollars = 'Price $5 and $10, `$x$`, $$\nz\n$$, \\$ and $a$.\n';
  const out = plain(dollars);
  assert.doesNotMatch(out, /data-tex|math-/);
  assert.equal(createRenderer(win, {})(dollars), out);
});

test('sample.md renders the same with math on unless it uses maths', () => {
  const sample = readFileSync('tests/sample.md', 'utf8');
  // sample.md has `$` only in prose/code that is not maths.
  assert.equal(math(sample), plain(sample));
});

test('heading containing maths keeps outline ids in step', () => {
  const src = '# Intro $x$\n\n## Energy $E=mc^2$ and $a_b$\n\n## Energy $E=mc^2$ and $a_b$\n\n# Cost $5 and $10\n';
  const d = dom(math(src));
  const ids = [...d.querySelectorAll('h1,h2')].map((e) => e.id.replace(/^user-content-/, ''));
  assert.deepEqual(extractHeadings(src, { math: true }).map((h) => h.id), ids);
});

// ---- performance: linear in the input, whatever the content ------------------

const gen = {
  'no dollars': (n) => 'Some prose with *emphasis* and `code`.\n\nAnother paragraph here.\n\n'.repeat(n),
  'currency prose': (n) => 'It costs $5 and $10 today, or $20.\n\nMore text, $3 each.\n\n'.repeat(n),
  'one unclosed $$ line': (n) => '# T\n\n$$\n\n' + 'Some prose with *emphasis*.\n\nAnother paragraph.\n\n'.repeat(n),
  'huge $$ paragraph': (n) => '$$a '.repeat(n * 3),
  'many display blocks': (n) => '$$\nx\n$$\n\ntext\n\n'.repeat(n),
};
const N = 2500;
for (const [name, make] of Object.entries(gen)) {
  const small = make(N);
  const big = make(4 * N);
  for (const [what, run] of [
    ['render', (t) => math(t)],
    ['outline', (t) => extractHeadings(t, { math: true })],
  ]) {
    test(`math ${what} is linear: ${name}`, () => {
      const a = bestOf(3, () => run(small));
      const b = bestOf(3, () => run(big));
      assert.ok(b < Math.max(8 * a, 30), `4x input took ${(b / a).toFixed(1)}x (${a.toFixed(0)} -> ${b.toFixed(0)} ms)`);
    });
  }
}

test('math render budget on ~1 MB inputs', () => {
  for (const make of [gen['no dollars'], gen['currency prose'], gen['one unclosed $$ line']]) {
    const src = make(Math.ceil(1_000_000 / make(1).length));
    const ms = bestOf(1, () => { math(src); extractHeadings(src, { math: true }); });
    assert.ok(ms < budget(8000), `took ${ms.toFixed(0)} ms`);
  }
});
