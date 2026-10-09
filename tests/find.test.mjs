import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { findInText, createFindBar } from '../src/desktop/find.js';

test('case-insensitive by default', () => {
  assert.deepEqual(findInText('Foo foo FOO', 'foo', false), [
    { start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 },
  ]);
});
test('match case', () => {
  assert.deepEqual(findInText('Foo foo FOO', 'foo', true), [{ start: 4, end: 7 }]);
});
test('overlapping not double-counted', () => {
  assert.equal(findInText('aaa', 'aa', false).length, 1);
});
test('empty query -> []', () => {
  assert.deepEqual(findInText('abc', '', false), []);
});
test('limit caps results', () => {
  assert.equal(findInText('a'.repeat(20000), 'a', false, 10000).length, 10000);
});

function setup(html) {
  const dom = new JSDOM(`<!doctype html><div id="find"></div><article id="doc">${html}</article>`);
  const d = dom.window.document;
  const bar = createFindBar(d.getElementById('find'), () => d.getElementById('doc'));
  return { dom, d, bar, input: d.querySelector('.find-input'), count: d.querySelector('.find-count') };
}

test('counts matches across inline elements and not across blocks', () => {
  const { bar, count } = setup('<p>foo<strong>bar</strong> x</p><p>foo</p><p>bar</p>');
  bar.open('foobar');
  assert.equal(count.textContent, '1 of 1');
  bar.open('foo');
  assert.equal(count.textContent, '1 of 2');
  bar.open('foofoo');
  assert.equal(count.textContent, 'No results');
  bar.open('x foo');
  assert.equal(count.textContent, 'No results');
});

test('next/previous wrap and nth', () => {
  const { bar, d, count } = setup('<p>a a a</p>');
  bar.open('a', 1);
  assert.equal(count.textContent, '2 of 3');
  const [prev, next] = d.querySelectorAll('.find-btn');
  next.click(); next.click();
  assert.equal(count.textContent, '1 of 3');
  prev.click();
  assert.equal(count.textContent, '3 of 3');
});

test('hidden text is skipped; close hides', () => {
  const { bar, d, count } = setup('<p>x</p><p style="display:none">x</p>');
  bar.open('x');
  assert.equal(count.textContent, '1 of 1');
  bar.close();
  assert.equal(bar.isOpen(), false);
  assert.equal(d.getElementById('find').hidden, true);
});

test('refresh re-runs against new content', () => {
  const { bar, d, count } = setup('<p>x</p>');
  bar.open('x');
  d.getElementById('doc').innerHTML = '<p>x x</p>';
  bar.refresh();
  assert.equal(count.textContent, '1 of 2');
});

test('soft line breaks match as spaces; pre keeps newlines', () => {
  const { bar, count } = setup('<p>find bar\nabove</p><pre>a\nb</pre>');
  bar.open('bar above');
  assert.equal(count.textContent, '1 of 1');
  bar.open('a b');
  assert.equal(count.textContent, 'No results');
});

test('findInText on ~5 MB is fast', () => {
  const text = 'Lorem ipsum dolor sit amet, the quick brown fox. '.repeat(108000);
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    findInText(text, 'the', false);
    best = Math.min(best, performance.now() - t);
  }
  assert.ok(best < 200, `took ${best} ms`);
});

test('nth out of range falls back to the first match', () => {
  const { bar, count } = setup('<p>a a a</p>');
  bar.open('a', 99);
  assert.equal(count.textContent, '1 of 3');
  bar.open('a', -1);
  assert.equal(count.textContent, '1 of 3');
});

test('keys on the bar: Enter, Shift+Enter, Esc', () => {
  const { dom, bar, input, count } = setup('<p>a a a</p>');
  const key = (init) => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  bar.open('a');
  key({ key: 'Enter' });
  assert.equal(count.textContent, '2 of 3');
  key({ key: 'Enter', shiftKey: true });
  key({ key: 'Enter', shiftKey: true });
  assert.equal(count.textContent, '3 of 3');
  key({ key: 'Escape' });
  assert.equal(bar.isOpen(), false);
});

test('Aa toggle matches case', () => {
  const { d, bar, count } = setup('<p>Foo foo</p>');
  bar.open('foo');
  assert.equal(count.textContent, '1 of 2');
  const aa = d.querySelector('.find-case');
  aa.click();
  assert.equal(aa.getAttribute('aria-pressed'), 'true');
  assert.equal(count.textContent, '1 of 1');
});

test('shows 10000+ when capped', () => {
  const { bar, count } = setup('<p>' + 'a'.repeat(10005) + '</p>');
  bar.open('a');
  assert.equal(count.textContent, '1 of 10000+');
});

test('position is kept after refresh()', () => {
  const { bar, d, count } = setup('<p>x x x</p>');
  bar.open('x', 1);
  d.getElementById('doc').innerHTML = '<p>x x x x</p>';
  bar.refresh();
  assert.equal(count.textContent, '2 of 4');
});
