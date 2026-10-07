// Desktop shell wiring: tabs, read-only rendering, shortcuts, backend events.
import { createRenderer } from '../render.js';
import * as backend from './backend.js';
import * as T from './tabs.js';
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

let state = T.createState();
let shown = { id: null, text: null }; // what #doc currently displays
let lastTitle = null;

// ---- state ---------------------------------------------------------------

const activeTab = () => state.tabs.find((t) => t.id === state.activeId) || null;

// Every state change goes through here. When the active tab changes, the
// outgoing tab keeps the content area's scroll position.
function commit(next) {
  const prev = state.activeId;
  if (prev && next.activeId !== prev && next.tabs.some((t) => t.id === prev)) {
    const scrollTop = content.scrollTop;
    next = { ...next, tabs: next.tabs.map((t) => (t.id === prev ? { ...t, scrollTop } : t)) };
  }
  state = next;
  render();
}

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
    commit(T.activate(state, existing.id));
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
  const before = state;
  try {
    commit(T.openFile(state, { path, ...file }));
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
  commit(T.closeTab(state, id));
}

// ---- rendering -----------------------------------------------------------

function render() {
  const tab = activeTab();
  const hasTabs = state.tabs.length > 0;
  tabbar.hidden = !hasTabs;
  toolbar.hidden = !tab;
  start.hidden = hasTabs;
  doc.hidden = !tab;

  renderTabs();

  if (tab) {
    filename.textContent = tab.title;
    filename.title = tab.path || tab.title;
  }

  if (!tab) {
    if (shown.id) doc.replaceChildren();
    shown = { id: null, text: null };
    content.scrollTop = 0;
  } else if (shown.id !== tab.id || shown.text !== tab.text) {
    const switched = shown.id !== tab.id;
    renderDoc(tab);
    shown = { id: tab.id, text: tab.text };
    if (switched) content.scrollTop = tab.scrollTop;
  }

  const title = T.windowTitle(state);
  if (title !== lastTitle) {
    lastTitle = title;
    backend.setTitle(title).catch((err) => console.warn('setTitle failed:', err));
  }
}

function renderTabs() {
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
  else commit(T.activate(state, el.dataset.id));
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

window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  if (key === 'o' && !e.shiftKey) {
    e.preventDefault();
    pickAndOpen();
  } else if (key === 'w' && !e.shiftKey) {
    e.preventDefault();
    if (state.activeId) closeTab(state.activeId);
  } else if (key === 'tab') {
    e.preventDefault();
    commit(T.cycle(state, e.shiftKey ? -1 : 1));
  }
});

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
