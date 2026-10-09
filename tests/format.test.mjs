import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleWrap, insertLink } from '../src/desktop/format.js';

// Applies a result to doc; returns [text, selectedTexts].
function apply(doc, r) {
  const cs = r.changes.map((c, i) => ({ ...c, i })).sort((a, b) => b.from - a.from || b.i - a.i);
  let t = doc;
  for (const c of cs) t = t.slice(0, c.from) + c.insert + t.slice(c.to);
  return [t, r.ranges.map((x) => t.slice(x.from, x.to))];
}
const at = (doc, s, e = s) => [{ from: doc.indexOf(s), to: doc.indexOf(s) + (e === s ? s.length : 0) }];

test('bold wraps selection', () => {
  const r = toggleWrap('a word b', at('a word b', 'word'), '**');
  assert.deepEqual(apply('a word b', r), ['a **word** b', ['word']]);
});

test('bold toggles off (markers inside)', () => {
  const d = 'a **word** b';
  const r = toggleWrap(d, [{ from: 2, to: 10 }], '**');
  assert.deepEqual(apply(d, r), ['a word b', ['word']]);
});

test('bold toggles off (markers outside)', () => {
  const d = 'a **word** b';
  const r = toggleWrap(d, [{ from: 4, to: 8 }], '**');
  assert.deepEqual(apply(d, r), ['a word b', ['word']]);
});

test('italic wraps, toggles off inside and outside', () => {
  assert.deepEqual(apply('a b', toggleWrap('a b', [{ from: 2, to: 3 }], '*')), ['a *b*', ['b']]);
  assert.deepEqual(apply('a *b*', toggleWrap('a *b*', [{ from: 2, to: 5 }], '*')), ['a b', ['b']]);
  assert.deepEqual(apply('a *b*', toggleWrap('a *b*', [{ from: 3, to: 4 }], '*')), ['a b', ['b']]);
});

test('italic does not unwrap bold', () => {
  const d = '**x**';
  assert.deepEqual(apply(d, toggleWrap(d, [{ from: 2, to: 3 }], '*')), ['***x***', ['x']]);
  // whole "**x**" selected: wrap, not unwrap
  assert.deepEqual(apply(d, toggleWrap(d, [{ from: 0, to: 5 }], '*')), ['***x***', ['**x**']]);
});

test('italic inside bold, and bold inside italic', () => {
  const d = '**a *x* b**';
  assert.deepEqual(apply(d, toggleWrap(d, [{ from: 5, to: 6 }], '*')), ['**a x b**', ['x']]);
  assert.deepEqual(apply(d, toggleWrap(d, [{ from: 4, to: 7 }], '*')), ['**a x b**', ['x']]);
  const t = '***x***';
  assert.deepEqual(apply(t, toggleWrap(t, [{ from: 3, to: 4 }], '*')), ['**x**', ['x']]);
  assert.deepEqual(apply(t, toggleWrap(t, [{ from: 3, to: 4 }], '**')), ['*x*', ['x']]);
});

test('empty selection inserts pair', () => {
  const r = toggleWrap('ab', [{ from: 1, to: 1 }], '**');
  assert.deepEqual(apply('ab', r), ['a****b', ['']]);
  assert.deepEqual(r.ranges, [{ from: 3, to: 3 }]);
  assert.deepEqual(toggleWrap('', [{ from: 0, to: 0 }], '*').ranges, [{ from: 1, to: 1 }]);
});

test('multiple ranges', () => {
  const d = 'aa bb cc';
  const r = toggleWrap(d, [{ from: 0, to: 2 }, { from: 3, to: 5 }, { from: 8, to: 8 }], '**');
  assert.deepEqual(apply(d, r), ['**aa** **bb** cc****', ['aa', 'bb', '']]);
  const d2 = '**aa** **bb**';
  const r2 = toggleWrap(d2, [{ from: 2, to: 4 }, { from: 9, to: 11 }], '**');
  assert.deepEqual(apply(d2, r2), ['aa bb', ['aa', 'bb']]);
});

test('link wraps and selects url', () => {
  const r = insertLink('see docs now', [{ from: 4, to: 8 }]);
  assert.deepEqual(apply('see docs now', r), ['see [docs](url) now', ['url']]);
});

test('empty link', () => {
  const r = insertLink('ab', [{ from: 1, to: 1 }]);
  assert.deepEqual(apply('ab', r), ['a[](url)b', ['']]);
  assert.deepEqual(r.ranges, [{ from: 2, to: 2 }]);
});

test('link with multiple ranges', () => {
  const r = insertLink('aa bb', [{ from: 0, to: 2 }, { from: 3, to: 5 }]);
  assert.deepEqual(apply('aa bb', r), ['[aa](url) [bb](url)', ['url', 'url']]);
});
