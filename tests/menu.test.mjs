import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div class="app"><button id="b">x</button></div></body>');
globalThis.document = dom.window.document;
const { openMenu, closeMenu, isMenuOpen } = await import('../src/desktop/menu.js');

const key = (k) =>
  document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const rows = () => [...document.querySelectorAll('.menu')[0].querySelectorAll('[role^=menuitem]')];

function setup(extra = {}) {
  const btn = document.getElementById('b');
  btn.focus();
  const log = [];
  const items = [
    { label: 'One', onSelect: () => log.push('one') },
    { label: 'Auto', checked: true, onSelect: () => log.push('auto') },
    'separator',
    { label: 'Off', checked: false, onSelect: () => log.push('off') },
    { label: 'Nope', disabled: true, onSelect: () => log.push('nope') },
    { label: 'Theme', submenu: [{ label: 'Dark', onSelect: () => log.push('dark') }, { label: 'Light', onSelect: () => log.push('light') }] },
    ...(extra.items || []),
  ];
  return { btn, log, handle: openMenu(btn, items) };
}

test('arrow keys move (wrapping, skipping disabled), Home/End, Esc closes and restores focus', () => {
  const { btn } = setup();
  assert.equal(document.querySelector('[role=menu]').getAttribute('role'), 'menu');
  assert.equal(document.activeElement.textContent, 'One');
  key('ArrowDown');
  assert.match(document.activeElement.textContent, /Auto/);
  key('ArrowDown');
  assert.match(document.activeElement.textContent, /Off/);
  key('ArrowDown'); // skips disabled Nope
  assert.match(document.activeElement.textContent, /Theme/);
  key('ArrowDown'); // wraps
  assert.equal(document.activeElement.textContent, 'One');
  key('ArrowUp');
  assert.match(document.activeElement.textContent, /Theme/);
  key('Home');
  assert.equal(document.activeElement.textContent, 'One');
  key('End');
  assert.match(document.activeElement.textContent, /Theme/);
  key('Escape');
  assert.equal(document.querySelector('[role=menu]'), null);
  assert.equal(document.activeElement, btn);
  assert.equal(isMenuOpen(), false);
});

test('Enter and Space select, close the menu and focus the anchor', () => {
  const { btn, log } = setup();
  key('Enter');
  assert.deepEqual(log, ['one']);
  assert.equal(document.querySelector('[role=menu]'), null);
  assert.equal(document.activeElement, btn);
  const second = setup();
  key('ArrowDown');
  key(' ');
  assert.deepEqual(second.log, ['auto']);
});

test('checked item has aria-checked; plain items are menuitem', () => {
  setup();
  const r = rows();
  assert.equal(r[0].getAttribute('role'), 'menuitem');
  assert.equal(r[0].hasAttribute('aria-checked'), false);
  assert.equal(r[1].getAttribute('role'), 'menuitemcheckbox');
  assert.equal(r[1].getAttribute('aria-checked'), 'true');
  assert.equal(r[2].getAttribute('aria-checked'), 'false');
  assert.equal(r[3].getAttribute('aria-disabled'), 'true');
  assert.equal(document.querySelector('[role=separator]') !== null, true);
  closeMenu();
});

test('submenu: Right opens, Left and Esc close one level, Enter selects', () => {
  const { log } = setup();
  key('End');
  const theme = document.activeElement;
  assert.equal(theme.getAttribute('aria-haspopup'), 'menu');
  assert.equal(theme.getAttribute('aria-expanded'), 'false');
  key('ArrowRight');
  assert.equal(document.querySelectorAll('[role=menu]').length, 2);
  assert.equal(theme.getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement.textContent, 'Dark');
  key('ArrowLeft');
  assert.equal(document.querySelectorAll('[role=menu]').length, 1);
  assert.equal(document.activeElement, theme);
  key('ArrowRight');
  key('Escape'); // one level only
  assert.equal(document.querySelectorAll('[role=menu]').length, 1);
  assert.equal(isMenuOpen(), true);
  key('ArrowRight');
  key('ArrowDown');
  key('Enter');
  assert.deepEqual(log, ['light']);
  assert.equal(isMenuOpen(), false);
});

test('click selects, disabled click does nothing, click outside closes, anchor toggles', () => {
  const { btn, log } = setup();
  rows()[3].click();
  assert.deepEqual(log, []);
  assert.equal(isMenuOpen(), true);
  rows()[2].click();
  assert.deepEqual(log, ['off']);
  assert.equal(isMenuOpen(), false);

  setup();
  document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.equal(isMenuOpen(), false);

  openMenu(btn, [{ label: 'A' }]);
  assert.equal(openMenu(btn, [{ label: 'A' }]), null); // second open on the same anchor toggles it shut
  assert.equal(isMenuOpen(), false);
});
