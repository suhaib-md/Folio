import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div class="app"><button id="b">x</button></div></body>');
globalThis.document = dom.window.document;
const { openQuickOpen } = await import('../src/desktop/quickopen.js');
const { setModalHooks } = await import('../src/desktop/modal.js');

let depth = 0;
let opens = 0;
setModalHooks({ onOpen: () => { depth++; opens++; }, onClose: () => { depth--; } });

const evil = '<img src=x onerror=alert(1)>.md';
const files = [
  { path: '/r/a.md', rel: 'a.md', name: 'a.md' },
  { path: `/r/${evil}`, rel: evil, name: evil },
];
const key = (target, k) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

test('Esc closes, flag balanced, app not inert, focus restored', () => {
  const btn = document.getElementById('b');
  btn.focus();
  const base = opens;
  openQuickOpen({ files, recentPaths: [], onPick() { assert.fail('no pick'); } });
  assert.equal(depth, 1);
  assert.equal(document.querySelector('.app').inert, true);
  const input = document.querySelector('[role=combobox]');
  assert.equal(document.querySelector('[role=dialog]').getAttribute('aria-label'), 'Quick open');
  assert.equal(input.getAttribute('aria-controls'), document.querySelector('[role=listbox]').id);
  key(input, 'Escape');
  assert.equal(depth, 0);
  assert.equal(opens, base + 1);
  assert.equal(document.querySelector('[role=dialog]'), null);
  assert.equal(document.querySelector('.app').inert, false);
  assert.equal(document.activeElement, btn);
});

test('click outside closes', () => {
  openQuickOpen({ files, recentPaths: [], onPick() {} });
  const backdrop = document.querySelector('.modal-backdrop');
  backdrop.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.equal(depth, 0);
  assert.equal(document.querySelector('[role=dialog]'), null);
});

test('Enter and click pick, once, after closing', () => {
  const picked = [];
  openQuickOpen({ files, recentPaths: [], onPick: (p) => { picked.push([p, depth]); } });
  key(document.querySelector('[role=combobox]'), 'ArrowDown'); // '<img' sorts first
  key(document.querySelector('[role=combobox]'), 'Enter');
  assert.deepEqual(picked, [['/r/a.md', 0]]); // flag already released when onPick runs
  assert.equal(depth, 0);
  openQuickOpen({ files, recentPaths: [], onPick: (p) => picked.push([p, depth]) });
  document.querySelectorAll('[role=option]')[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(picked.length, 2);
  assert.equal(depth, 0);
});

test('a second open while open is ignored (flag stays 1)', () => {
  const a = openQuickOpen({ files, recentPaths: [], onPick() {} });
  const b = openQuickOpen({ files, recentPaths: [], onPick() {} });
  assert.equal(a, b);
  assert.equal(depth, 1);
  a.close();
  a.close();
  assert.equal(depth, 0);
});

test('file names render as text, never markup', () => {
  openQuickOpen({ files, recentPaths: [], onPick() {} });
  const input = document.querySelector('[role=combobox]');
  input.value = 'img';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const row = document.querySelector('[role=option]');
  assert.ok(row.textContent.includes(evil));
  assert.equal(document.querySelector('.quickopen img'), null);
  assert.equal(document.querySelectorAll('.quickopen *').length > 0, true);
  assert.ok([...document.querySelectorAll('.quickopen *')].every((el) => !el.hasAttribute('onerror')));
  key(input, 'Escape');
  assert.equal(depth, 0);
});

test('empty list says No files', () => {
  openQuickOpen({ files: [], recentPaths: [], onPick() {} });
  assert.equal(document.querySelector('.quickopen-empty').textContent, 'No files');
  assert.equal(document.querySelector('.quickopen-empty').hidden, false);
  key(document.querySelector('[role=combobox]'), 'Escape');
});

test('a throwing render leaves nothing inert or flagged', () => {
  assert.throws(() => openQuickOpen({ files: null, recentPaths: [], onPick() {} }));
  assert.equal(depth, 0);
  assert.equal(document.querySelector('.app').inert, false);
  assert.equal(document.querySelector('[role=dialog]'), null);
  // and the next open still works
  openQuickOpen({ files, recentPaths: [], onPick() {} }).close();
  assert.equal(depth, 0);
});

test('typing > switches to commands; Backspace on empty goes back', () => {
  const ran = [];
  const commands = [
    { label: 'Toggle sidebar', group: 'View', key: 'Ctrl+Shift+B', run: () => ran.push('sidebar') },
    { label: 'Export HTML…', group: 'File', run: () => ran.push('export') },
  ];
  openQuickOpen({ files, recentPaths: [], onPick() { assert.fail('no file pick'); }, commands });
  const input = document.querySelector('[role=combobox]');
  assert.equal(document.querySelector('.quickopen-prefix').hidden, true);
  input.value = '>';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(input.value, '');
  assert.equal(document.querySelector('.quickopen-prefix').hidden, false);
  assert.equal(document.querySelector('.quickopen-group').textContent, 'Commands');
  assert.equal(document.querySelectorAll('[role=option]').length, 2);
  assert.equal(document.querySelector('.quickopen-key').textContent, 'Ctrl+Shift+B');
  key(input, 'Backspace');
  assert.equal(document.querySelector('.quickopen-group').textContent, 'Files');
  key(input, 'Escape');
  assert.deepEqual(ran, []);
});

test('startInCommands filters and runs a command after closing', () => {
  const ran = [];
  const commands = [
    { label: 'Toggle sidebar', group: 'View', run: () => ran.push(['sidebar', depth]) },
    { label: 'Export HTML…', group: 'File', run: () => ran.push(['export', depth]) },
  ];
  openQuickOpen({ files, recentPaths: [], onPick() {}, commands, startInCommands: true });
  const input = document.querySelector('[role=combobox]');
  input.value = 'expo';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(document.querySelectorAll('[role=option]').length, 1);
  key(input, 'Enter');
  assert.deepEqual(ran, [['export', 0]]);
});

test('Ctrl+Enter picks a file for a new tab', () => {
  const picked = [];
  openQuickOpen({ files, recentPaths: ['/r/a.md'], onPick: (p, o) => picked.push([p, o.newTab]) });
  document.querySelector('[role=combobox]').dispatchEvent(
    new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }),
  );
  assert.deepEqual(picked, [['/r/a.md', true]]);
});
