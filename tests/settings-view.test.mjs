import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div class="app"><button id="b">x</button></div></body>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;
const { openSettings } = await import('../src/desktop/settings-view.js');
const { createSettings } = await import('../src/desktop/settings.js');
const { setModalHooks } = await import('../src/desktop/modal.js');

let depth = 0;
setModalHooks({ onOpen: () => { depth++; }, onClose: () => { depth--; } });

const store = () => createSettings({ settingsGet: async () => null, settingsSet: async () => {} }, {
  setTimer: () => 0,
  clearTimer: () => {},
});
const key = (k) => document.querySelector('.settings').dispatchEvent(
  new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
);

test('Appearance writes theme, reading font, size and autosave; Esc closes', () => {
  const s = store();
  document.getElementById('b').focus();
  openSettings({ settings: s });
  assert.equal(depth, 1);
  assert.equal(document.querySelector('.app').inert, true);
  const radios = [...document.querySelectorAll('.settings-seg [role=radio]')];
  assert.deepEqual(radios.map((r) => r.textContent), ['System', 'Light', 'Dark']);
  radios[2].click();
  assert.equal(s.get().theme, 'dark');
  assert.equal(document.querySelectorAll('.settings-seg [role=radio]')[2].getAttribute('aria-checked'), 'true');
  document.querySelectorAll('.font-card')[1].click();
  assert.equal(s.get().docFont, 'sans');
  const slider = document.querySelector('.size-slider');
  slider.value = '130';
  slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(s.get().zoom, 130);
  document.querySelector('.switch').click();
  assert.equal(s.get().autosave, true);
  key('Escape');
  assert.equal(depth, 0);
  assert.equal(document.querySelector('.settings'), null);
  assert.equal(document.querySelector('.app').inert, false);
  assert.equal(document.activeElement, document.getElementById('b'));
});

test('opens on a page; About offers Check for updates', () => {
  let checked = 0;
  openSettings({ settings: store(), page: 'about', version: '1.2.3', onCheckUpdates: () => { checked++; } });
  assert.equal(document.querySelector('[aria-selected=true]').textContent, 'About & updates');
  assert.match(document.querySelector('.about-version').textContent, /1\.2\.3/);
  [...document.querySelectorAll('.settings-page button')].find((b) => b.textContent === 'Check for updates…').click();
  assert.equal(checked, 1);
  assert.equal(document.querySelector('.settings'), null);
  assert.equal(depth, 0);
});

test('Shortcuts lists the palette and settings keys', () => {
  openSettings({ settings: store(), page: 'shortcuts' });
  const text = document.querySelector('.shortcut-table').textContent;
  assert.match(text, /Ctrl\+Shift\+P/);
  assert.match(text, /Ctrl\+,/);
  key('Escape');
});
