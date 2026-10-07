// Desktop shell wiring: tabs, Read / Edit / Split views, shortcuts, backend
// events.
import { createRenderer } from '../render.js';
import * as backend from './backend.js';
import * as T from './tabs.js';
import { createEditor } from './editor.js';
import { confirmSave, setModalHooks } from './modal.js';
import { runWindowClose } from './closing.js';
import { decide } from './reload.js';
import { basename, resolveRelative, isMarkdownPath } from './paths.js';
import { renderTree } from './sidebar.js';
import { renderRecent } from './recent.js';

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
const tabBannerActions = $('tab-banner-actions');
const sidebarEl = $('sidebar');
const recentEl = $('recent');

// Split re-renders the preview PREVIEW_DELAY ms after typing stops (spec:
// 150 ms). Extension beyond the spec: when a tab's last render took longer
// than PREVIEW_DELAY / 2 (only big documents: a render blocks the window), the
// delay becomes 2x that render time, so typing is never interrupted by a
// render before the user has paused that long.
const PREVIEW_DELAY = 150;
const wide = window.matchMedia('(min-width: 900px)'); // narrower: Split shows as Edit
const roomy = window.matchMedia('(min-width: 700px)'); // narrower: no sidebar

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

// The open folder (one at a time) and the sidebar showing it.
let folder = null; // { path, root, truncated } from list_tree
let folderSeq = 0; // bumped when another folder is opened
let expanded = new Set(); // normalizePath() keys of expanded folders (root always is)
let treeVersion = 0; // bumped when `folder` or `expanded` change
let lastSidebarKey = null;
// The user's Ctrl+B choice. Narrow windows hide the sidebar without
// changing it, so it comes back when the window widens.
let sidebarWanted = true;

let recent = { files: [], folders: [] }; // as last returned by the backend
let lastRecentKey = null;

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
roomy.addEventListener('change', () => render());

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

// A backend error as text (Rust errors arrive as plain strings).
const errorText = (err) => (typeof err === 'string' ? err : err?.message || String(err));
// The backend's exact words (folio-core files.rs / tree.rs) for a path that
// does not exist (read_file / list_tree).
const isNotFound = (err) => ['file not found', 'folder not found'].includes(errorText(err));
// list_tree was given a file.
const isNotAFolder = (err) => errorText(err) === 'not a folder';

// While a modal is open, incoming opens wait and run when it closes. Opens
// run one at a time so order is kept and duplicates focus.
let modalOpen = false;
const pending = []; // jobs: { path, run() }
let chain = Promise.resolve();

export function setModalOpen(open) {
  modalOpen = open;
  if (!open && pending.length) enqueue(pending.splice(0));
}

function enqueue(jobs) {
  if (!jobs.length) return chain;
  if (modalOpen) {
    pending.push(...jobs);
    return chain;
  }
  chain = chain.then(async () => {
    for (const job of jobs) {
      // One bad open must not stop the rest, or leave the chain rejected
      // (which would silently skip every later open).
      try {
        await job.run();
      } catch (err) {
        console.error(`opening ${job.path} failed:`, err);
        showOpenError(job.path);
      }
    }
  });
  return chain;
}

// `folders`: the paths may be folders too (dropped, launched, second
// instance); those open in the sidebar.
export function openPaths(paths, { folders = false } = {}) {
  return enqueue((paths || []).map((path) => ({
    path,
    run: () => (folders ? openFileOrFolder(path) : openPath(path)),
  })));
}

function showOpenError(path) {
  showBanner(`Couldn't open ${basename(path)}. Is it a text/Markdown file?`);
}

// `fromRecent`: a recent-list entry; failing to read it means it is gone.
async function openPath(path, { fromRecent = false } = {}) {
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
    if (fromRecent && isNotFound(err)) forgetRecent(path);
    else showOpenError(path);
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
  addRecent(path, 'file');
}

// A dropped or launched path: list_tree answers "not a folder" for a file,
// which then opens as a file (reporting its own read errors). Any other
// listing error is a folder that could not be opened. An already open file
// skips the probe.
async function openFileOrFolder(path) {
  if (T.findByPath(state, path)) return openPath(path);
  let listed;
  try {
    listed = await backend.listTree(path);
  } catch (err) {
    if (isNotAFolder(err)) return openPath(path);
    console.warn(`listTree(${path}) failed:`, err);
    showBanner(`Couldn't open ${basename(path)}.`);
    return;
  }
  return openFolder(path, { listed });
}

async function pickAndOpen() {
  try {
    await openPaths(await backend.pickFiles());
  } catch (err) {
    console.warn('pickFiles failed:', err);
  }
}

async function pickFolderAndOpen() {
  let path;
  try {
    path = await backend.pickFolder();
  } catch (err) {
    console.warn('pickFolder failed:', err);
    return;
  }
  if (path) await enqueue([{ path, run: () => openFolder(path) }]);
}

// ---- folder sidebar ------------------------------------------------------

// Show `path` in the sidebar, replacing any open folder. `listed`: its
// list_tree result, when the caller already has it.
async function openFolder(path, { listed = null, fromRecent = false } = {}) {
  let result = listed;
  if (!result) {
    try {
      result = await backend.listTree(path);
    } catch (err) {
      console.warn(`listTree(${path}) failed:`, err);
      if (fromRecent && isNotFound(err)) forgetRecent(path);
      else showBanner(`Couldn't open ${basename(path)}.`);
      return;
    }
  }
  // Re-opening the same folder keeps what was expanded.
  const same = folder && T.normalizePath(folder.path) === T.normalizePath(path);
  if (!same) expanded = new Set();
  folder = { path, root: result.root, truncated: !!result.truncated };
  folderSeq += 1;
  treeVersion += 1;
  sidebarWanted = true;
  render();
  addRecent(path, 'folder');
}

function toggleFolder(path) {
  const key = T.normalizePath(path);
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  treeVersion += 1;
  render();
}

// Ctrl+B. Hiding it with focus inside moves focus to the document.
function toggleSidebar() {
  sidebarWanted = !sidebarWanted;
  const hadFocus = sidebarEl.contains(document.activeElement);
  render();
  if (hadFocus && sidebarEl.hidden) {
    if (showsEditor(view)) editor.focus();
    else content.focus({ preventScroll: true });
  }
}

// folder-changed: re-list, keeping `expanded`. Events during a re-list are
// coalesced into one more re-list after it.
let relisting = false;
let relistAgain = false;

async function onFolderChanged(payload) {
  const changed = payload?.folder;
  if (!folder || !changed || T.normalizePath(changed) !== T.normalizePath(folder.path)) return;
  if (relisting) {
    relistAgain = true;
    return;
  }
  relisting = true;
  try {
    do {
      relistAgain = false;
      const { path } = folder;
      const seq = folderSeq;
      let result;
      try {
        result = await backend.listTree(path);
      } catch (err) {
        // Gone or unreadable right now: keep showing the last listing (a
        // re-list queued meanwhile is still tried).
        console.warn(`re-listing ${path} failed:`, err);
        continue;
      }
      // Another folder was opened meanwhile: drop this result, but still
      // honour a re-list queued for it.
      if (seq !== folderSeq) continue;
      folder = { path, root: result.root, truncated: !!result.truncated };
      treeVersion += 1;
      render();
    } while (relistAgain);
  } finally {
    relisting = false;
  }
}

// ---- recent --------------------------------------------------------------

// Every recent call returns both full lists. Only the latest-issued call's
// answer is shown, so an older answer arriving late can't undo a newer one.
let recentReq = 0;
function trackRecent(call, what) {
  const n = ++recentReq;
  call.then((next) => {
    if (n !== recentReq || !next) return;
    recent = next;
    render();
  }, (err) => console.warn(`${what} failed:`, err));
}

function addRecent(path, kind) {
  trackRecent(backend.recentAdd(path, kind), 'recentAdd');
}

// A recent entry that could not be opened: drop it and say so.
function forgetRecent(path) {
  showBanner(`${basename(path)} no longer exists.`);
  trackRecent(backend.recentRemove(path), 'recentRemove');
}

function openRecent(path, kind) {
  enqueue([{
    path,
    run: () => (kind === 'folder' ? openFolder(path, { fromRecent: true }) : openPath(path, { fromRecent: true })),
  }]);
}

setModalHooks({ onOpen: () => setModalOpen(true), onClose: () => setModalOpen(false) });

// ---- saving --------------------------------------------------------------

const SAVE_ERROR = 'save-error';
const saving = new Map(); // tab id -> in-flight save promise

const findTab = (id) => getState().tabs.find((t) => t.id === id) || null;

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
    const banner = { kind: SAVE_ERROR, text: `Couldn't save ${basename(path)}: ${errorText(err)}` };
    commit((s) => T.setBanner(s, id, banner));
    return false;
  }
  commit((s) => {
    let next = T.markSaved(s, id, saveAs ? { path, text } : { text });
    const saved = next.tabs.find((t) => t.id === id);
    // What we just wrote is now the file: save errors and disk banners are moot.
    if (saved?.banner) next = T.setBanner(next, id, null);
    return next;
  });
  if (saveAs) {
    // Another clean tab showing the file we just wrote over is now stale.
    const n = T.normalizePath(path);
    const stale = getState().tabs.find((t) =>
      t.id !== id && t.path != null && T.normalizePath(t.path) === n && !T.isDirty(t));
    if (stale) closeTabNow(stale.id);
    addRecent(path, 'file');
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

// ---- changes on disk -----------------------------------------------------

// The watcher follows the open files' paths; it is told whenever that set
// changes (open, close, Save As). Calls are chained so they arrive in order.
let watchKey = null;
let watchChain = Promise.resolve();
const currentFolder = () => folder?.path ?? null;

function syncWatch() {
  const seen = new Map();
  for (const t of state.tabs) {
    if (t.path != null && !seen.has(T.normalizePath(t.path))) seen.set(T.normalizePath(t.path), t.path);
  }
  const files = [...seen.values()];
  const folder = currentFolder();
  const key = JSON.stringify([[...seen.keys()].sort(), folder]);
  if (key === watchKey) return;
  watchKey = key;
  watchChain = watchChain
    .then(() => backend.watch(files, folder))
    .catch((err) => console.warn('watch failed:', err));
}

const DISK_CHANGED = 'disk-changed'; // "<name> changed on disk." Reload / Keep mine
const DISK_REMOVED = 'disk-removed'; // "<name> was deleted or moved."
const isDiskBanner = (b) => b?.kind === DISK_CHANGED || b?.kind === DISK_REMOVED;

const tabsAt = (path) => {
  const n = T.normalizePath(path);
  return getState().tabs.filter((t) => t.path != null && T.normalizePath(t.path) === n);
};
const changeSeq = new Map(); // normalized path -> number of its latest event
let changeCount = 0;

async function onFileChanged({ path, kind }) {
  if (!path || !tabsAt(path).length) return;
  const n = T.normalizePath(path);
  const seq = ++changeCount;
  changeSeq.set(n, seq);
  // A save of ours in flight (its rename is what we're hearing about): let
  // it finish, so savedText is what it wrote.
  const inFlight = tabsAt(path).map((t) => saving.get(t.id)).filter(Boolean);
  if (inFlight.length) await Promise.all(inFlight.map((p) => p.catch(() => {})));
  let disk = null;
  if (kind !== 'removed') {
    try {
      disk = await backend.readFile(path);
    } catch (err) {
      // Mid-write, or gone again: a later event will follow.
      console.warn(`re-reading ${path} failed:`, err);
      return;
    }
  }
  if (changeSeq.get(n) !== seq) return; // a newer event for this file wins
  changeSeq.delete(n);
  // tabsAt flushes typed text first, so `dirty` below is current.
  const ids = tabsAt(path).map((t) => t.id);
  if (!ids.length) return;
  commit((s) => ids.reduce((acc, id) => applyChange(acc, id, kind, disk), s));
}

// One tab's reaction to a change of its file (a pure state update).
function applyChange(s, id, kind, disk) {
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab) return s;
  switch (decide(tab, kind, disk?.text)) {
    case 'ignore':
      // Disk matches what we know: an earlier disk banner no longer applies.
      return isDiskBanner(tab.banner) ? T.setBanner(s, id, null) : s;
    case 'reload':
      return T.setBanner(T.loadFromDisk(s, id, disk), id, null);
    case 'ask':
      return T.setBanner(s, id, { kind: DISK_CHANGED, text: `${tab.title} changed on disk.`, disk });
    case 'removed':
      return T.setBanner(T.clearSaved(s, id), id, { kind: DISK_REMOVED, text: `${tab.title} was deleted or moved.` });
    default:
      return s;
  }
}

function answerDiskChange(reload) {
  const tab = getActiveTab();
  const b = tab?.banner;
  if (!tab || b?.kind !== DISK_CHANGED) return;
  commit((s) => {
    // Keep mine: the disk version is now the known saved one, so the tab
    // stays dirty and the next save overwrites it knowingly.
    const next = reload ? T.loadFromDisk(s, tab.id, b.disk) : T.markSaved(s, tab.id, { text: b.disk.text });
    return T.setBanner(next, tab.id, null);
  });
  if (showsEditor(view)) editor.focus();
  else content.focus({ preventScroll: true });
}

$('tab-banner-reload').addEventListener('click', () => answerDiskChange(true));
$('tab-banner-keep').addEventListener('click', () => answerDiskChange(false));

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
  renderSidebar(tab);
  if (!hasTabs) renderRecentList();

  renderTabBanner(tab);

  if (tab) {
    filename.textContent = tab.title;
    filename.title = tab.path || tab.title;
    for (const btn of modeSwitch.children) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === tab.mode));
    }
  }

  // True when the editor already shows this text (it came from typing).
  const typed = !!tab && editorFor.id === tab.id && editorFor.text === tab.text;

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
      if (next === 'split' && typed) schedulePreview();
      else renderShown(tab);
    }
  }

  syncWatch();

  const title = T.windowTitle(state);
  if (title !== lastTitle) {
    lastTitle = title;
    backend.setTitle(title).catch((err) => console.warn('setTitle failed:', err));
  }
}

// Rebuilt only when the tree, what is expanded, or the active file changed.
function renderSidebar(tab) {
  const visible = !!folder && sidebarWanted && roomy.matches;
  sidebarEl.hidden = !visible;
  if (!visible) return;
  const activePath = tab?.path ?? null;
  const key = `${treeVersion}|${activePath == null ? '' : T.normalizePath(activePath)}`;
  if (key === lastSidebarKey) return;
  lastSidebarKey = key;
  renderTree(sidebarEl, folder.root, {
    activePath,
    expanded,
    truncated: folder.truncated,
    onOpen: (path) => openPaths([path]),
    onToggle: toggleFolder,
  });
}

function renderRecentList() {
  const key = JSON.stringify(recent);
  if (key === lastRecentKey) return;
  lastRecentKey = key;
  renderRecent(recentEl, recent, { onOpen: openRecent });
}

// The active tab's own banner: a save error, or a change on disk.
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
  const info = b.kind === DISK_CHANGED;
  tabBanner.classList.toggle('banner-info', info);
  tabBanner.classList.toggle('banner-error', !info);
  tabBannerActions.hidden = !info;
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
$('start-open-folder').addEventListener('click', pickFolderAndOpen);

// Capture phase, so the shortcuts also work (and win) inside the editor.
window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  // AltGr arrives as Ctrl+Alt on Windows, and some layouts (German, French,
  // ...) need AltGr to type "\": allow Alt only for that character.
  if (e.altKey && key !== '\\') return;
  const plain = !e.shiftKey;
  let action;
  if (key === 'o') {
    action = plain ? pickAndOpen : pickFolderAndOpen;
  } else if (key === 'b' && plain) {
    action = toggleSidebar;
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
  trackRecent(backend.recentGet(), 'recentGet');
  await backend.onCloseRequested(onCloseRequested);
  // Subscribe before asking for launch paths so a second launch that
  // arrives in between is not lost.
  // Backend events flush typed text into the model before they act on it.
  await backend.onOpenPaths((paths) => {
    editor.flush();
    openPaths(paths, { folders: true });
  });
  await backend.onFileChanged((change) => {
    onFileChanged(change).catch((err) => console.error('file change failed:', err));
  });
  await backend.onFolderChanged((change) => {
    onFolderChanged(change).catch((err) => console.error('folder change failed:', err));
  });
  await backend.onDragDrop((paths) => {
    editor.flush();
    openPaths(paths, { folders: true });
  });
  await openPaths(await backend.launchPaths(), { folders: true });
}

startup().catch((err) => console.error('Folio failed to start:', err));
