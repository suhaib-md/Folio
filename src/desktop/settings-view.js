// The Settings dialog (Ctrl+,): Appearance, Editing, Shortcuts and About &
// updates. Every control writes the settings store at once; the dialog
// re-renders from the store, so a change made elsewhere (a zoom shortcut)
// shows here too.
//
// openSettings({ settings, page, version, onCheckUpdates }) -> { close() }
// settings: the store from settings.js. While open the app is inert and the
// modal hooks fire, like the other dialogs. Esc, Done or a click outside
// closes; focus returns to where it was.
import { modalOpened, modalClosed } from './modal.js';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from './settings.js';

export const PAGES = [
  ['appearance', 'Appearance'],
  ['editing', 'Editing'],
  ['shortcuts', 'Shortcuts'],
  ['about', 'About & updates'],
];

export const SHORTCUTS = [
  ['Go to file or run a command', 'Ctrl+P'],
  ['Run a command', 'Ctrl+Shift+P'],
  ['Open file', 'Ctrl+O'],
  ['Open folder', 'Ctrl+Shift+O'],
  ['New file', 'Ctrl+N'],
  ['Save', 'Ctrl+S'],
  ['Save as', 'Ctrl+Shift+S'],
  ['Close tab', 'Ctrl+W'],
  ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'],
  ['Read ↔ Edit', 'Ctrl+E'],
  ['Split', 'Ctrl+\\'],
  ['Sidebar', 'Ctrl+Shift+B'],
  ['Outline', 'Ctrl+Shift+L'],
  ['Search folder', 'Ctrl+Shift+F'],
  ['Find', 'Ctrl+F'],
  ['Settings', 'Ctrl+,'],
  ['Zoom in / out / reset', 'Ctrl+= / Ctrl+- / Ctrl+0'],
];

const FORMAT_SHORTCUTS = [
  ['Bold', 'Ctrl+B'],
  ['Italic', 'Ctrl+I'],
  ['Link', 'Ctrl+K'],
];

const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

let active = null;

export function openSettings({ settings, page = 'appearance', version = '', onCheckUpdates = null }) {
  if (active) {
    active.show(page);
    return active;
  }
  const d = document;
  const previous = d.activeElement;
  const app = d.querySelector('.app');
  const el = (tag, className, text) => {
    const e = d.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };
  const button = (className, text, onClick) => {
    const b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  const backdrop = el('div', 'modal-backdrop settings-backdrop');
  const dialog = el('div', 'settings');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'settings-title');

  const nav = el('div', 'settings-nav');
  const title = el('h2', 'settings-title', 'Settings');
  title.id = 'settings-title';
  const tablist = el('div', 'settings-tabs');
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-orientation', 'vertical');
  tablist.setAttribute('aria-label', 'Settings sections');
  nav.append(title, tablist);
  const navItems = PAGES.map(([id, label]) => {
    const b = button('settings-nav-item', label, () => show(id));
    b.setAttribute('role', 'tab');
    b.dataset.page = id;
    b.id = `settings-tab-${id}`;
    b.setAttribute('aria-controls', 'settings-page');
    tablist.append(b);
    return b;
  });
  tablist.addEventListener('keydown', (e) => {
    const i = navItems.indexOf(d.activeElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % navItems.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + navItems.length) % navItems.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = navItems.length - 1;
    if (next < 0) return;
    e.preventDefault();
    show(navItems[next].dataset.page);
    navItems[next].focus();
  });

  const main = el('div', 'settings-main');
  const pageEl = el('div', 'settings-page');
  pageEl.id = 'settings-page';
  pageEl.setAttribute('role', 'tabpanel');
  const foot = el('div', 'settings-foot');
  const done = button('btn btn-primary', 'Done', () => close());
  foot.append(done);
  main.append(pageEl, foot);
  dialog.append(nav, main);
  backdrop.append(dialog);

  let current = PAGES.some(([id]) => id === page) ? page : 'appearance';

  function row(label, desc, control) {
    const r = el('div', 'settings-row');
    const text = el('div', 'settings-label');
    const name = el('div', '', label);
    text.append(name);
    if (desc) text.append(el('div', 'settings-desc', desc));
    r.append(text);
    if (control) r.append(control);
    return r;
  }

  function switchFor(label, on, onToggle) {
    const s = button('switch', null, onToggle);
    s.setAttribute('role', 'switch');
    s.setAttribute('aria-checked', String(on));
    s.setAttribute('aria-label', label);
    return s;
  }

  function appearance(s) {
    const seg = el('div', 'seg settings-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', 'Theme');
    for (const [id, label] of THEMES) {
      const b = button('', label, () => settings.update({ theme: id }));
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(s.theme === id));
      b.setAttribute('aria-pressed', String(s.theme === id));
      seg.append(b);
    }

    const cards = el('div', 'font-cards');
    cards.setAttribute('role', 'radiogroup');
    cards.setAttribute('aria-label', 'Reading font');
    for (const [id, label] of [['serif', 'Serif'], ['sans', 'Sans']]) {
      const c = button('font-card', null, () => settings.update({ docFont: id }));
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', String(s.docFont === id));
      c.append(el('span', id === 'serif' ? 'aa-serif' : 'aa-sans', 'Aa'), el('span', 'font-name', label));
      cards.append(c);
    }

    const size = el('div', 'size-control');
    const slider = el('input', 'size-slider');
    slider.type = 'range';
    slider.min = String(ZOOM_MIN);
    slider.max = String(ZOOM_MAX);
    slider.step = String(ZOOM_STEP);
    slider.value = String(s.zoom);
    slider.setAttribute('aria-label', 'Text size');
    slider.setAttribute('aria-valuetext', `${s.zoom}%`);
    const fill = () => `${((Number(slider.value) - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%`;
    slider.style.setProperty('--fill', fill());
    const value = el('span', 'size-value', `${s.zoom}%`);
    slider.addEventListener('input', () => {
      slider.style.setProperty('--fill', fill());
      value.textContent = `${slider.value}%`;
      settings.update({ zoom: Number(slider.value) });
    });
    size.append(slider, value);

    return [
      row('Theme', 'System follows Windows.', seg),
      row('Reading font', 'Used in Read mode and the Split preview.', cards),
      row('Text size', 'Ctrl+= and Ctrl+- also work. Ctrl+0 resets.', size),
      row('Autosave', 'Save edits a moment after you stop typing.',
        switchFor('Autosave', s.autosave, () => settings.update({ autosave: !settings.get().autosave }))),
    ];
  }

  function shortcutTable(list) {
    const t = el('table', 'shortcut-table');
    const body = el('tbody');
    for (const [action, keys] of list) {
      const tr = el('tr');
      tr.append(el('td', '', action), el('td', '', keys));
      body.append(tr);
    }
    t.append(body);
    return t;
  }

  function editing() {
    return [
      row('Formatting', 'In Edit and Split, the buttons in the document header also add headings, inline code and task lists.', null),
      shortcutTable(FORMAT_SHORTCUTS),
      row('Paste images', 'Pasting a screenshot saves it next to the file and links it.', null),
    ];
  }

  function about() {
    const check = onCheckUpdates
      ? button('btn', 'Check for updates…', () => {
        close();
        onCheckUpdates();
      })
      : null;
    const v = el('div', 'about-version', version ? `Version ${version}` : '');
    const r = row('Folio', 'Read and edit Markdown, offline.', check);
    r.querySelector('.settings-label').append(v);
    return [r];
  }

  function render() {
    const s = settings.get();
    const focusedIndex = [...pageEl.querySelectorAll('button, input')].indexOf(d.activeElement);
    navItems.forEach((b) => {
      const on = b.dataset.page === current;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    pageEl.setAttribute('aria-labelledby', `settings-tab-${current}`);
    pageEl.textContent = '';
    const content = current === 'appearance' ? appearance(s)
      : current === 'editing' ? editing()
        : current === 'shortcuts' ? [shortcutTable(SHORTCUTS)]
          : about();
    pageEl.append(...content);
    // A re-render (a setting changed) keeps focus on the same control.
    if (focusedIndex >= 0) pageEl.querySelectorAll('button, input')[focusedIndex]?.focus();
  }

  function show(id) {
    if (!PAGES.some(([p]) => p === id)) return;
    current = id;
    render();
  }

  function focusables() {
    return [...dialog.querySelectorAll('button, input')].filter((e) => !e.disabled && e.tabIndex >= 0);
  }

  function onKey(e) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const list = focusables();
      if (!list.length) return;
      const i = list.indexOf(d.activeElement);
      const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
      e.preventDefault();
      list[next].focus();
    }
    e.stopPropagation(); // app shortcuts stay off while the dialog is open
  }

  function onMouseDown(e) {
    if (!dialog.contains(e.target)) {
      e.preventDefault();
      close();
    }
  }

  const off = settings.onChange(() => render());
  let closed = false;
  let opened = false;
  function close() {
    if (closed) return;
    closed = true;
    active = null;
    off();
    backdrop.remove();
    if (app) app.inert = false;
    if (previous && previous.isConnected && typeof previous.focus === 'function') {
      previous.focus({ preventScroll: true });
    }
    if (opened) modalClosed();
  }

  backdrop.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', onMouseDown);

  render();
  active = { close, show };
  try {
    modalOpened();
    opened = true;
    if (app) app.inert = true;
    d.body.append(backdrop);
    navItems.find((b) => b.dataset.page === current).focus({ focusVisible: false });
  } catch (err) {
    close();
    throw err;
  }
  return active;
}

export const settingsOpen = () => active != null;
