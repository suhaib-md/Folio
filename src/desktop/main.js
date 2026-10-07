// Desktop shell wiring: tabs, Read / Edit / Split views, shortcuts, backend
// events.
import { createRenderer } from '../render.js';
import * as backend from './backend.js';
import * as T from './tabs.js';
import { createEditor } from './editor.js';
import { confirmSave, setModalHooks } from './modal.js';
import { runWindowClose } from './closing.js';
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
const tabBanner = $('tab-banner');
const tabBannerText = $('tab-banner-text');

// Split re-renders the preview PREVIEW_DELAY ms after typing stops (spec:
// 150 ms). Extension beyond the spec: when a tab's last render took longer
// than PREVIEW_DELAY / 2 (only big documents: a render blocks the window), the
// delay becomes 2x that render time, so typing is never interrupted by a
// render before the user has paused that long.
const PREVIEW_DELAY = 150;
const wide = window.matchMedia('(min-width: 900px)'); // narrower: Split shows as Edit

let state = T.createState();
let shown = { id: null, text: null }; // what #doc currently displays
let view = 'read'; // what is on screen: 'read' | 'edit' | 'split'
let editorFor = { id: null, text: null }; // tab (and text) the editor holds
let previewTimer = null;
let rendering = false;
const renderCost = new Map(); // tab id -> ms the last #doc render took (incl. layout)
let lastTitle = null;
let lastTabsKey = null;
const beforeSplit = new Map(); // tab id -> mode to return to when leaving Split

const editor = createEditor(editorEl, { onChange: onEditorChange });

// ---- state ---------------------------------------------------------------

// The editor reports big documents' text in batches (see editor.js). Code
// outside commit/render reads state through getState()/getActiveTab(), which
// flush that pending text into the model first, so it never sees stale text.
function getState() {
  editor.flush();
  return state;
}
const findActive = (s) => s.tabs.find((t) => t.id === s.activeId) || null;
const getActiveTab = () => findActive(getState());
// Raw read, for render() and helpers it calls (render flushes on entry).
const activeTab = () => findActive(state);

// Every state change goes through here, as `update(state) -> next state`;
// `update` always sees the current text (pending editor text is flushed).
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
  // A flush from inside render (its entry, or the editor parking a tab) only
  // updates the model; that render is already drawing it.
  if (!rendering) render();
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
  const tab = getActiveTab();
  if (!tab || tab.mode === mode) return;
  if (mode === 'split') beforeSplit.set(tab.id, tab.mode);
  const editorHadFocus = editorEl.contains(document.activeElement);
  commit((s) => T.setMode(s, tab.id, mode));
  if (showsEditor(view)) editor.focus();
  else if (editorHadFocus) content.focus({ preventScroll: true });
}

// Ctrl+E: Read -> Edit, Edit -> Read, Split -> Read.
function toggleEdit() {
  const tab = getActiveTab();
  if (tab) setMode(tab.mode === 'read' ? 'edit' : 'read');
}

// Ctrl+\: into Split, and back out to the mode the tab had before (Edit if
// it was opened in Split some other way).
function toggleSplit() {
  const tab = getActiveTab();
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
$('tab-banner-close').addEventListener('click', () => {
  const id = state.activeId;
  if (id) commit((s) => T.setBanner(s, id, null));
});

// ---- opening -------------------------------------------------------------

// While a modal is open, incoming paths wait and are opened when it
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

setModalHooks({ onOpen: () => setModalOpen(true), onClose: () => setModalOpen(false) });

// ---- saving --------------------------------------------------------------

const SAVE_ERROR = 'save-error';
const saving = new Map(); // tab id -> in-flight save promise

const findTab = (id) => getState().tabs.find((t) => t.id === id) || null;
const errorReason = (err) =>
  (typeof err === 'string' ? err : err?.message || String(err));

// Save the tab (Save As if it is untitled or `as` is set). Resolves true once
// the text is on disk, false if the user cancelled the dialog or the write
// failed (the tab then shows `Couldn't save <name>: <reason>`).
// A plain save during an in-flight save of the same tab joins it; a Save As
// waits for it and then runs.
function save(id, { as = false } = {}) {
  const inFlight = saving.get(id);
  if (inFlight && !as) return inFlight;
  const run = (inFlight ? inFlight.catch(() => {}) : Promise.resolve())
    .then(() => saveNow(id, as))
    .finally(() => {
      if (saving.get(id) === run) saving.delete(id);
    });
  saving.set(id, run);
  return run;
}

async function saveNow(id, as) {
  let tab = findTab(id);
  if (!tab) return false;
  let path = tab.path;
  const saveAs = as || !path;
  if (saveAs) {
    // Existing files: start the dialog at the file itself (its folder);
    // untitled tabs: "<title>.md".
    try {
      path = await backend.pickSavePath(tab.path || `${tab.title}.md`);
    } catch (err) {
      console.warn('pickSavePath failed:', err);
      return false;
    }
    if (!path) return false;
    tab = findTab(id); // the tab may have changed (or gone) meanwhile
    if (!tab) return false;
  }
  // The text written is a snapshot: typing during the write keeps the tab
  // dirty, because savedText is set to exactly what reached the disk.
  const { text, eol, bom } = tab;
  try {
    await backend.writeFile(path, text, eol, bom);
  } catch (err) {
    console.warn(`writeFile(${path}) failed:`, err);
    const banner = { kind: SAVE_ERROR, text: `Couldn't save ${basename(path)}: ${errorReason(err)}` };
    commit((s) => T.setBanner(s, id, banner));
    return false;
  }
  commit((s) => {
    let next = T.markSaved(s, id, saveAs ? { path, text } : { text });
    const saved = next.tabs.find((t) => t.id === id);
    if (saved?.banner?.kind === SAVE_ERROR) next = T.setBanner(next, id, null);
    return next;
  });
  if (saveAs) {
    // Another clean tab showing the file we just wrote over is now stale.
    const n = T.normalizePath(path);
    const stale = getState().tabs.find((t) =>
      t.id !== id && t.path != null && T.normalizePath(t.path) === n && !T.isDirty(t));
    if (stale) closeTabNow(stale.id);
    backend.recentAdd(path, 'file').catch((err) => console.warn('recentAdd failed:', err));
  }
  return true;
}

function newFile() {
  commit((s) => T.newUntitled(s));
  editor.focus();
}

// ---- closing -------------------------------------------------------------

function closeTabNow(id) {
  commit((s) => T.closeTab(s, id));
  editor.destroyState(id);
  beforeSplit.delete(id);
  renderCost.delete(id);
}

const closing = new Map(); // tab id -> in-flight close flow

// Close a tab, asking first if it has unsaved changes. Resolves true if the
// tab is gone, false if it stays (Cancel, cancelled Save As, failed save).
function closeTabFlow(id) {
  if (closing.has(id)) return closing.get(id);
  const run = closeTabFlowNow(id).finally(() => closing.delete(id));
  closing.set(id, run);
  return run;
}

async function closeTabFlowNow(id) {
  for (;;) {
    const tab = findTab(id);
    if (!tab) return true;
    if (!T.isDirty(tab)) break;
    if (state.activeId !== id) commit((s) => T.activate(s, id));
    const choice = await confirmSave(tab.title);
    if (choice === 'cancel') return false;
    if (choice === 'discard') break;
    if (!(await save(id))) return false;
    // Saved; typing during the write leaves it dirty again: ask again.
  }
  closeTabNow(id);
  return true;
}

// Window close: the same prompt for each dirty tab, in order (re-planned
// after each one); any Cancel (or failed save) keeps the window open.
const closeWindowFlow = () => runWindowClose({ getState, closeTabFlow });

let windowClosing = false;

// Resolves true to let the window close. A second close request while one
// is being answered (or while a tab's prompt is up) is ignored.
async function onCloseRequested() {
  editor.flush();
  if (windowClosing || closing.size || modalOpen) return false;
  windowClosing = true;
  try {
    return await closeWindowFlow();
  } catch (err) {
    console.error('close flow failed:', err);
    return false;
  } finally {
    windowClosing = false;
  }
}

function closeTab(id) {
  closeTabFlow(id).then(focusEditorIfShown, (err) => console.error('closing tab failed:', err));
}

// ---- rendering -----------------------------------------------------------

// Only the active tab is on screen. The editor DOM is persistent: tabs swap
// editor states, and typing never re-creates it or the rendered document.
function render() {
  if (rendering) return; // never re-entered (see onEditorChange)
  rendering = true;
  try {
    editor.flush();
    renderNow();
  } finally {
    rendering = false;
  }
}

function renderNow() {
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

  renderTabBanner(tab);

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

// The active tab's own banner (e.g. a save error).
function renderTabBanner(tab) {
  const b = tab?.banner;
  if (!b) {
    if (!tabBanner.hidden) {
      tabBanner.hidden = true;
      tabBannerText.textContent = '';
    }
    return;
  }
  if (tabBannerText.textContent !== b.text) tabBannerText.textContent = b.text;
  tabBanner.hidden = false;
}

function renderShown(tab) {
  const t0 = performance.now();
  renderDoc(tab);
  shown = { id: tab.id, text: tab.text };
  // Cost includes the layout and paint that follow.
  const id = tab.id;
  requestAnimationFrame(() => setTimeout(() => renderCost.set(id, performance.now() - t0), 0));
}

function cancelPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;
}

function previewDelay(tab) {
  return Math.max(PREVIEW_DELAY, 2 * (renderCost.get(tab?.id) || 0));
}

function schedulePreview() {
  cancelPreview();
  previewTimer = setTimeout(() => {
    previewTimer = null;
    const tab = activeTab();
    if (tab && view === 'split' && shown.text !== tab.text) renderShown(tab);
  }, previewDelay(activeTab()));
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
    const p = resolveRelative(getActiveTab()?.path, href);
    if (p && isMarkdownPath(p)) openPaths([p]);
  }
});
doc.addEventListener('auxclick', (e) => {
  if (e.target.closest('a[href]')) e.preventDefault();
});

// ---- start screen, shortcuts, drag and drop ------------------------------

$('start-open-file').addEventListener('click', pickAndOpen);
$('start-new-file').addEventListener('click', newFile);

// Capture phase, so the shortcuts also work (and win) inside the editor.
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  // AltGr arrives as Ctrl+Alt on Windows, and some layouts (German, French,
  // ...) need AltGr to type "\": allow Alt only for that character.
  if (e.altKey && key !== '\\') return;
  const plain = !e.shiftKey;
  let action;
  if (key === 'o' && plain) {
    action = pickAndOpen;
  } else if (key === 'n' && plain) {
    action = newFile;
  } else if (key === 's') {
    action = () => {
      if (state.activeId) save(state.activeId, { as: e.shiftKey });
    };
  } else if (key === 'w' && plain) {
    action = () => {
      if (state.activeId) closeTab(state.activeId);
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
  if (modalOpen) return; // the modal is answered first
  // Every app shortcut sees the latest typed text. (Not done for plain typing
  // keys: that would turn a big document into a string on every keystroke.)
  editor.flush();
  action();
}, true);

// Tauri delivers dropped files as real paths (backend.onDragDrop); the
// browser's own drop must never navigate the page away.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---- startup -------------------------------------------------------------

async function startup() {
  render();
  await backend.onCloseRequested(onCloseRequested);
  // Subscribe before asking for launch paths so a second launch that
  // arrives in between is not lost.
  // Backend events flush typed text into the model before they act on it.
  await backend.onOpenPaths((paths) => {
    editor.flush();
    openPaths(paths);
  });
  await backend.onDragDrop((paths) => {
    editor.flush();
    openPaths(paths);
  });
  await openPaths(await backend.launchPaths());
}

startup().catch((err) => console.error('Folio failed to start:', err));
