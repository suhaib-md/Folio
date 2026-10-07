// Desktop shell wiring: tabs, Read / Edit / Split views, shortcuts, backend
// events.
import { createRenderer } from '../render.js';
import * as backend from './backend.js';
import * as T from './tabs.js';
import { createEditor } from './editor.js';
import { basename, resolveRelative, isMarkdownPath } from './paths.js';

const renderMarkdown = createRenderer(window);
const $ = (id) => document.getElementById(id);
const tabbar = $('tabbar');
const toolbar = $('toolbar');
const filename = $('filename');
const banner = $('app-banner');
const bannerText = $('app-banner-text');
const content = $('content');
const start = $('start');
const doc = $('doc');
const panes = $('panes');
const editorEl = $('editor');
const modeSwitch = $('mode-switch');

const PREVIEW_DELAY = 150; // ms after typing stops before Split re-renders
const wide = window.matchMedia('(min-width: 900px)'); // narrower: Split shows as Edit

let state = T.createState();
let shown = { id: null, text: null }; // what #doc currently displays
let view = 'read'; // what is on screen: 'read' | 'edit' | 'split'
let editorFor = { id: null, text: null }; // tab (and text) the editor holds
let previewTimer = null;
let lastTitle = null;
let lastTabsKey = null;
const beforeSplit = new Map(); // tab id -> mode to return to when leaving Split

const editor = createEditor(editorEl, { onChange: onEditorChange });

// ---- state ---------------------------------------------------------------

const activeTab = () => state.tabs.find((t) => t.id === state.activeId) || null;

// Every state change goes through here, as `update(state) -> next state`.
// The editor reports big documents' text in batches, so its pending text is
// flushed into the model first; `update` always sees the current text.
// (Anything reading tab text outside commit must call editor.flush() too.)
function commit(update) {
  editor.flush();
  state = update(state);
  render();
}

// Typing: the editor already shows the text, so only the model (tab dot,
// window title) and, in Split, the debounced preview follow.
function onEditorChange(text) {
  const id = editorFor.id;
  if (!id) return;
  editorFor = { id, text };
  state = T.setText(state, id, text);
  render();
}

// ---- modes ---------------------------------------------------------------

// The view a tab gets on screen: Split falls back to Edit in narrow windows
// (the tab's mode stays 'split' and comes back when the window widens).
function viewOf(tab) {
  if (!tab) return 'read';
  return tab.mode === 'split' && !wide.matches ? 'edit' : tab.mode;
}
const showsDoc = (v) => v !== 'edit';
const showsEditor = (v) => v !== 'read';

function setMode(mode) {
  const tab = activeTab();
  if (!tab || tab.mode === mode) return;
  if (mode === 'split') beforeSplit.set(tab.id, tab.mode);
  const editorHadFocus = editorEl.contains(document.activeElement);
  commit((s) => T.setMode(s, tab.id, mode));
  if (showsEditor(view)) editor.focus();
  else if (editorHadFocus) content.focus({ preventScroll: true });
}

// Ctrl+E: Read -> Edit, Edit -> Read, Split -> Read.
function toggleEdit() {
  const tab = activeTab();
  if (tab) setMode(tab.mode === 'read' ? 'edit' : 'read');
}

// Ctrl+\: into Split, and back out to the mode the tab had before (Edit if
// it was opened in Split some other way).
function toggleSplit() {
  const tab = activeTab();
  if (!tab) return;
  setMode(tab.mode === 'split' ? beforeSplit.get(tab.id) || 'edit' : 'split');
}

// After switching tabs the old focus target may be gone (the tab bar is
// rebuilt); put the caret back in the editor when there is one.
function focusEditorIfShown() {
  if (showsEditor(view)) editor.focus();
}

modeSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('.mode-btn');
  if (btn) setMode(btn.dataset.mode);
});

wide.addEventListener('change', () => render());

// ---- app banner ----------------------------------------------------------

function showBanner(message) {
  bannerText.textContent = message;
  banner.hidden = false;
}

function hideBanner() {
  banner.hidden = true;
  bannerText.textContent = '';
}

$('app-banner-close').addEventListener('click', hideBanner);

// ---- opening -------------------------------------------------------------

// While a modal is open (Task 6), incoming paths wait and are opened when it
// closes. Opens run one at a time so order is kept and duplicates focus.
let modalOpen = false;
const pending = [];
let chain = Promise.resolve();

export function setModalOpen(open) {
  modalOpen = open;
  if (!open && pending.length) openPaths(pending.splice(0));
}

export function openPaths(paths) {
  if (!paths || !paths.length) return chain;
  if (modalOpen) {
    pending.push(...paths);
    return chain;
  }
  chain = chain.then(async () => {
    for (const p of paths) {
      // One bad file must not stop the rest, or leave the chain rejected
      // (which would silently skip every later open).
      try {
        await openPath(p);
      } catch (err) {
        console.error(`opening ${p} failed:`, err);
        showOpenError(p);
      }
    }
  });
  return chain;
}

function showOpenError(path) {
  showBanner(`Couldn't open ${basename(path)}. Is it a text/Markdown file?`);
}

async function openPath(path) {
  const existing = T.findByPath(state, path);
  if (existing) {
    commit((s) => T.activate(s, existing.id));
    return;
  }
  let file;
  try {
    file = await backend.readFile(path);
  } catch (err) {
    console.warn(`readFile(${path}) failed:`, err);
    showOpenError(path);
    return;
  }
  editor.flush(); // so `before` holds the latest typed text
  const before = state;
  try {
    commit((s) => T.openFile(s, { path, ...file }));
  } catch (err) {
    // Don't keep a tab we couldn't show.
    state = before;
    render();
    throw err;
  }
  backend.recentAdd(path, 'file').catch((err) => console.warn('recentAdd failed:', err));
}

async function pickAndOpen() {
  try {
    await openPaths(await backend.pickFiles());
  } catch (err) {
    console.warn('pickFiles failed:', err);
  }
}

function closeTab(id) {
  // Task 6 adds the "Save changes?" prompt for dirty tabs.
  commit((s) => T.closeTab(s, id));
  editor.destroyState(id);
  beforeSplit.delete(id);
}

// ---- rendering -----------------------------------------------------------

// Only the active tab is on screen. The editor DOM is persistent: tabs swap
// editor states, and typing never re-creates it or the rendered document.
function render() {
  const tab = activeTab();
  const next = viewOf(tab);
  const hasTabs = state.tabs.length > 0;

  // Leaving the rendered document (other tab, or a view without it): keep
  // its scroll position, which a hidden element would lose.
  if (shown.id && showsDoc(view) && (!tab || tab.id !== shown.id || !showsDoc(next))) {
    const scrollTop = content.scrollTop;
    state = { ...state, tabs: state.tabs.map((t) => (t.id === shown.id ? { ...t, scrollTop } : t)) };
  }

  tabbar.hidden = !hasTabs;
  toolbar.hidden = !tab;
  start.hidden = hasTabs;
  doc.hidden = !tab;

  renderTabs();

  if (tab) {
    filename.textContent = tab.title;
    filename.title = tab.path || tab.title;
    for (const btn of modeSwitch.children) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === tab.mode));
    }
  }

  // Editor: detach before hiding so it can remember its scroll position.
  if (tab && showsEditor(next)) {
    editorEl.hidden = false;
    if (editorFor.id !== tab.id || editorFor.text !== tab.text) {
      editor.show(tab.id, tab.text);
      editorFor = { id: tab.id, text: tab.text };
    }
  } else {
    if (editorFor.id) editor.hide();
    editorFor = { id: null, text: null };
    editorEl.hidden = true;
  }

  // Rendered document (Read, or the Split preview).
  const docWasVisible = showsDoc(view) && !content.hidden;
  panes.dataset.view = next;
  view = next;
  if (!tab) {
    cancelPreview();
    content.hidden = false;
    if (shown.id) doc.replaceChildren();
    shown = { id: null, text: null };
    content.scrollTop = 0;
  } else if (!showsDoc(next)) {
    cancelPreview();
    content.hidden = true;
  } else {
    content.hidden = false;
    const switched = shown.id !== tab.id;
    if (switched || !docWasVisible) {
      cancelPreview();
      if (switched || shown.text !== tab.text) renderShown(tab);
      content.scrollTop = tab.scrollTop;
    } else if (shown.text !== tab.text) {
      // Same tab, new text while visible: typing in Split is debounced; any
      // other change (e.g. a reload in Read) renders now.
      if (next === 'split' && tab.text === editorFor.text) schedulePreview();
      else renderShown(tab);
    }
  }

  const title = T.windowTitle(state);
  if (title !== lastTitle) {
    lastTitle = title;
    backend.setTitle(title).catch((err) => console.warn('setTitle failed:', err));
  }
}

function renderShown(tab) {
  renderDoc(tab);
  shown = { id: tab.id, text: tab.text };
}

function cancelPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;
}

function schedulePreview() {
  cancelPreview();
  previewTimer = setTimeout(() => {
    previewTimer = null;
    const tab = activeTab();
    if (tab && view === 'split' && shown.text !== tab.text) renderShown(tab);
  }, PREVIEW_DELAY);
}

// Rebuilt only when something it shows changed (not on every keystroke).
function renderTabs() {
  const key = JSON.stringify([state.activeId, state.tabs.map((t) => [t.id, t.title, t.path, T.isDirty(t)])]);
  if (key === lastTabsKey) return;
  lastTabsKey = key;
  const frag = document.createDocumentFragment();
  let activeEl = null;
  for (const tab of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab';
    el.setAttribute('role', 'tab');
    el.dataset.id = tab.id;
    el.title = tab.path || tab.title;
    const active = tab.id === state.activeId;
    el.setAttribute('aria-selected', String(active));
    el.tabIndex = active ? 0 : -1;

    const name = document.createElement('span');
    name.className = 'tab-title';
    name.textContent = tab.title;
    el.append(name);

    if (T.isDirty(tab)) {
      const dot = document.createElement('span');
      dot.className = 'tab-dirty';
      dot.setAttribute('aria-label', 'unsaved changes');
      dot.textContent = '●';
      el.append(dot);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.tabIndex = -1;
    close.setAttribute('aria-label', `Close ${tab.title}`);
    close.title = 'Close (Ctrl+W)';
    close.textContent = '×';
    el.append(close);

    frag.append(el);
    if (active) activeEl = el;
  }
  tabbar.replaceChildren(frag);
  activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Render into a detached template first so relative <img> sources are
// rewritten before the browser tries to load them.
function renderDoc(tab) {
  const tpl = document.createElement('template');
  tpl.innerHTML = renderMarkdown(tab.text);
  if (tab.path) {
    for (const img of tpl.content.querySelectorAll('img[src]')) {
      const p = resolveRelative(tab.path, img.getAttribute('src'));
      if (p) img.setAttribute('src', backend.assetUrl(p));
    }
  }
  doc.replaceChildren(tpl.content);
}

// ---- tab bar events ------------------------------------------------------

tabbar.addEventListener('click', (e) => {
  const el = e.target.closest('.tab');
  if (!el) return;
  if (e.target.closest('.tab-close')) closeTab(el.dataset.id);
  else commit((s) => T.activate(s, el.dataset.id));
  focusEditorIfShown();
});
// Middle-click closes; mousedown default would start auto-scroll.
tabbar.addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault();
});
tabbar.addEventListener('auxclick', (e) => {
  if (e.button !== 1) return;
  const el = e.target.closest('.tab');
  if (!el) return;
  e.preventDefault();
  closeTab(el.dataset.id);
});

// ---- links in the document -----------------------------------------------

function scrollToAnchor(href) {
  let hash = href.slice(1);
  try {
    hash = decodeURIComponent(hash);
  } catch {
    // keep as written
  }
  // The sanitiser prefixes ids with "user-content-".
  const target = document.getElementById(`user-content-${hash}`) || document.getElementById(hash);
  if (target && doc.contains(target)) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

doc.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  // Never let the webview navigate away from the app.
  e.preventDefault();
  const href = link.getAttribute('href');
  if (href.startsWith('#')) {
    scrollToAnchor(href);
  } else if (/^(https?|mailto):/i.test(href)) {
    backend.openExternal(href).catch((err) => console.warn('openExternal failed:', err));
  } else {
    const p = resolveRelative(activeTab()?.path, href);
    if (p && isMarkdownPath(p)) openPaths([p]);
  }
});
doc.addEventListener('auxclick', (e) => {
  if (e.target.closest('a[href]')) e.preventDefault();
});

// ---- start screen, shortcuts, drag and drop ------------------------------

$('start-open-file').addEventListener('click', pickAndOpen);

// Capture phase, so the shortcuts also work (and win) inside the editor.
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  const plain = !e.shiftKey;
  let action;
  if (key === 'o' && plain) {
    action = pickAndOpen;
  } else if (key === 'w' && plain) {
    action = () => {
      if (state.activeId) closeTab(state.activeId);
      focusEditorIfShown();
    };
  } else if (key === 'tab') {
    action = () => {
      commit((s) => T.cycle(s, e.shiftKey ? -1 : 1));
      focusEditorIfShown();
    };
  } else if (key === 'e' && plain) {
    action = toggleEdit;
  } else if ((key === '\\' || e.code === 'Backslash') && plain) {
    action = toggleSplit;
  } else if (key === 'f' && plain && showsEditor(view) && !editorEl.contains(document.activeElement)) {
    // CodeMirror handles Ctrl+F itself when it has focus.
    action = () => {
      editor.focus();
      editor.openSearch();
    };
  }
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  action();
}, true);

// Tauri delivers dropped files as real paths (backend.onDragDrop); the
// browser's own drop must never navigate the page away.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---- startup -------------------------------------------------------------

async function startup() {
  render();
  // Subscribe before asking for launch paths so a second launch that
  // arrives in between is not lost.
  await backend.onOpenPaths((paths) => openPaths(paths));
  await backend.onDragDrop((paths) => openPaths(paths));
  await openPaths(await backend.launchPaths());
}

startup().catch((err) => console.error('Folio failed to start:', err));
