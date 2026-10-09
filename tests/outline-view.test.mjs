import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderOutline } from '../src/desktop/outline-view.js';
import { extractHeadings, buildOutline } from '../src/desktop/outline.js';

const md = '# A\n\n## B\n\n### C\n\n## D\n\n# E\n';
const outline = buildOutline(extractHeadings(md));

function setup() {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  return { c: window.document.getElementById('c') };
}
const opts = (o = {}) => ({ current: -1, collapsed: new Set(), onJump() {}, onToggle() {}, ...o });
const items = (c) => [...c.querySelectorAll('.outline-item')];

test('renders nested items with levels', () => {
  const { c } = setup();
  renderOutline(c, outline, opts());
  assert.deepEqual(items(c).map((e) => e.textContent), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(items(c).map((e) => e.getAttribute('aria-level')), ['1', '2', '3', '2', '1']);
  assert.equal(items(c)[0].tagName, 'BUTTON');
  assert.equal(items(c)[0].getAttribute('aria-expanded'), 'true');
  assert.equal(items(c)[2].hasAttribute('aria-expanded'), false);
  // Indented by heading level.
  assert.equal(items(c)[2].closest('.outline-row').style.getPropertyValue('--depth'), '2');
});

test('empty shows No headings', () => {
  const { c } = setup();
  renderOutline(c, [], opts());
  assert.equal(c.textContent, 'No headings');
  assert.equal(items(c).length, 0);
});

test('click calls onJump with node', () => {
  const { c } = setup();
  const jumped = [];
  renderOutline(c, outline, opts({ onJump: (n) => jumped.push(n) }));
  items(c)[1].click();
  assert.equal(jumped.length, 1);
  assert.equal(jumped[0].text, 'B');
  assert.equal(jumped[0].line, 3);
  assert.equal(jumped[0].id, 'b');
});

test('collapsed parent hides children and toggles', () => {
  const { c } = setup();
  const toggled = [];
  renderOutline(c, outline, opts({ collapsed: new Set([1]), onToggle: (i) => toggled.push(i) }));
  // B (index 1) is collapsed: C is hidden.
  assert.deepEqual(items(c).map((e) => e.textContent), ['A', 'B', 'D', 'E']);
  assert.equal(items(c)[1].getAttribute('aria-expanded'), 'false');
  c.querySelector('.outline-item[data-index="1"]').closest('.outline-row').querySelector('.outline-twisty').click();
  items(c)[0].dispatchEvent(new c.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.deepEqual(toggled, [1, 0]);
});

test('current item has aria-current and survives re-render', () => {
  const { c } = setup();
  renderOutline(c, outline, opts({ current: 3 }));
  const cur = () => c.querySelectorAll('[aria-current]');
  assert.equal(cur().length, 1);
  assert.equal(cur()[0].textContent, 'D');
  assert.equal(cur()[0].getAttribute('aria-current'), 'location');
  renderOutline(c, outline, opts({ current: 3 }));
  assert.equal(cur().length, 1);
  assert.equal(cur()[0].textContent, 'D');
  renderOutline(c, outline, opts({ current: 4 }));
  assert.equal(cur()[0].textContent, 'E');
});
