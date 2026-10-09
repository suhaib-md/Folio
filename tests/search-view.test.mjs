import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderSearch, matchOrdinal } from '../src/desktop/search.js';

function setup() {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  return { c: window.document.getElementById('c'), window };
}
const m = (line, text, start, end, col = start) => ({ line, col, text, start, end });
const results = [
  { path: '/d/a.md', matches: [m(1, 'hello foo', 6, 9), m(4, 'foo again', 0, 3)] },
  { path: '/d/sub/b.md', matches: [m(2, 'a foo', 2, 5)] },
];
const st = (o = {}) => ({
  folder: '/d', query: 'foo', matchCase: false, results, truncated: false, running: false, ...o,
});
const handlers = (o = {}) => ({ onQuery() {}, onToggleCase() {}, onRefresh() {}, onPick() {}, ...o });

test('no folder shows Open a folder to search it.', () => {
  const { c } = setup();
  renderSearch(c, st({ folder: null, results: null }), handlers());
  assert.equal(c.textContent, 'Open a folder to search it.');
});

test('groups by file with counts and bold match', () => {
  const { c } = setup();
  renderSearch(c, st(), handlers());
  const files = [...c.querySelectorAll('.search-file')];
  assert.equal(files.length, 2);
  assert.match(files[0].textContent, /a\.md/);
  assert.equal(files[0].querySelector('.search-count').textContent, '2');
  assert.equal(files[1].querySelector('.search-dir').textContent, 'sub');
  const rows = [...c.querySelectorAll('.search-match')];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('mark').textContent, 'foo');
  assert.equal(rows[0].textContent, '1: hello foo');
  assert.equal(c.querySelector('.search-status').textContent, '3 results in 2 files');
});

test('match text is never parsed as HTML', () => {
  const { c } = setup();
  const r = [{ path: '/d/a.md', matches: [m(1, '<img src=x onerror=alert(1)> foo', 29, 32)] }];
  renderSearch(c, st({ results: r }), handlers());
  assert.equal(c.querySelector('.search-match img'), null);
  assert.equal(c.querySelector('mark').textContent, 'foo');
});

test('ellipses for cut windows', () => {
  const { c } = setup();
  const r = [{ path: '/d/a.md', matches: [m(1, 'x'.repeat(197) + 'foo', 197, 200, 500)] }];
  renderSearch(c, st({ results: r }), handlers());
  const t = c.querySelector('.search-match').textContent;
  assert.ok(t.includes('…'));
  assert.ok(t.endsWith('foo…'));
});

test('truncated shows Showing the first 1000 matches', () => {
  const { c } = setup();
  const many = [{ path: '/d/a.md', matches: Array.from({ length: 1000 }, (_, i) => m(i + 1, 'foo', 0, 3)) }];
  renderSearch(c, st({ results: many, truncated: true }), handlers());
  assert.equal(c.querySelector('.search-notice').textContent, 'Showing the first 1000 matches');
});

test('status: searching, no results', () => {
  const { c } = setup();
  renderSearch(c, st({ running: true, results: null }), handlers());
  assert.equal(c.querySelector('.search-status').textContent, 'Searching…');
  renderSearch(c, st({ results: [] }), handlers());
  assert.equal(c.querySelector('.search-status').textContent, 'No results');
});

test('click calls onPick with path, line, match', () => {
  const { c } = setup();
  const picks = [];
  renderSearch(c, st(), handlers({ onPick: (...a) => picks.push(a) }));
  c.querySelectorAll('.search-match')[1].click();
  assert.equal(picks.length, 1);
  assert.equal(picks[0][0], '/d/a.md');
  assert.equal(picks[0][1], 4);
  assert.equal(picks[0][2], results[0].matches[1]);
});

test('query input, Enter, toggle and refresh', () => {
  const { c, window } = setup();
  const log = [];
  renderSearch(c, st({ matchCase: true }), handlers({
    onQuery: (q, now) => log.push(['q', q, !!now]),
    onToggleCase: () => log.push('case'),
    onRefresh: () => log.push('refresh'),
  }));
  const input = c.querySelector('input');
  assert.equal(input.getAttribute('aria-label'), 'Search folder');
  assert.equal(input.value, 'foo');
  const aa = c.querySelector('.search-case');
  assert.equal(aa.getAttribute('aria-pressed'), 'true');
  assert.equal(aa.title, 'Match case');
  input.value = 'bar';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  aa.click();
  c.querySelector('.search-refresh').click();
  assert.deepEqual(log, [['q', 'bar', false], ['q', 'bar', true], 'case', 'refresh']);
  assert.equal(c.querySelector('.search-refresh').title, 'Search again');
});

test('re-render keeps the input element (focus survives)', () => {
  const { c } = setup();
  renderSearch(c, st(), handlers());
  const input = c.querySelector('input');
  input.focus();
  renderSearch(c, st({ running: true }), handlers());
  assert.equal(c.querySelector('input'), input);
  assert.equal(input.ownerDocument.activeElement, input);
});

test('arrow keys move between rows, one tab stop, Enter opens', () => {
  const { c, window } = setup();
  const picks = [];
  renderSearch(c, st(), handlers({ onPick: (...a) => picks.push(a) }));
  const rows = [...c.querySelectorAll('.search-row')];
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.tabIndex), [0, -1, -1, -1, -1]);
  rows[0].focus();
  rows[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(rows[1].ownerDocument.activeElement, rows[1]);
  rows[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  assert.equal(rows[0].ownerDocument.activeElement, rows[0]);
  rows[1].click();
  assert.equal(picks.length, 1);
});

test('file rows collapse', () => {
  const { c } = setup();
  const toggled = [];
  renderSearch(c, st({ collapsed: new Set(['/d/a.md']) }), handlers({ onToggleFile: (p) => toggled.push(p) }));
  assert.equal(c.querySelectorAll('.search-match').length, 1);
  c.querySelector('.search-file').click();
  assert.deepEqual(toggled, ['/d/a.md']);
});

test('matchOrdinal counts earlier lines only', () => {
  const src = 'foo foo\nbar\nFoo\nxx foo\n';
  assert.equal(matchOrdinal(src, 1, 'foo', false), 0);
  assert.equal(matchOrdinal(src, 3, 'foo', false), 2);
  assert.equal(matchOrdinal(src, 4, 'foo', false), 3);
  assert.equal(matchOrdinal(src, 4, 'foo', true), 2);
  assert.equal(matchOrdinal(src, 2, '', false), 0);
  assert.equal(matchOrdinal('a\r\nfoo\r\nfoo', 3, 'foo', false), 1);
});
