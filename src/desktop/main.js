// Desktop shell wiring: tabs, Read / Edit / Split views, shortcuts, backend
// events.
import { createRenderer } from '../render.js';
import * as backend from './backend.js';
import * as T from './tabs.js';
import { createEditor } from './editor.js';
import { confirmSave, confirmAction, setModalHooks } from './modal.js';
import { runWindowClose } from './closing.js';
import { decide } from './reload.js';
import { basename, dirname, resolveRelative, isMarkdownPath } from './paths.js';
import { renderTree } from './sidebar.js';
import { createGate } from './gate.js';
import { validateName, withMdExtension, keepExtension, remapPath, joinPath, isInside } from './fileops.js';
import { renderRecent } from './recent.js';
import { flattenTree } from './fuzzy.js';
import { openQuickOpen } from './quickopen.js';
import { createFindBar } from './find.js';
import { renderOutline } from './outline-view.js';
import { countWords, formatCount } from './wordcount.js';
import { extractHeadings, headingForFragment, buildOutline, currentIndex, headingIndexForLine } from './outline.js';
import { renderSearch, matchOrdinal } from './search.js';
import { blobToImage, savePastedImage } from './paste-image.js';
import { createDraftScheduler, restorePlan, restoreDecision } from './drafts.js';
import { createSettings, zoomStep } from './settings.js';
import { captureSession, startupOrder, mergeSkipped, sessionShape } from './session.js';
import { createAutosave } from './autosave.js';
import { openMenu, closeMenu } from './menu.js';
import { renderEnhancements } from './diagrams.js';
import { effectiveTheme } from './theme.js';
import { buildExportHtml, collectImages, collectCss } from './exporter.js';

const renderMarkdown = createRenderer(window, { math: true });
const $ = (id) => document.getElementById(id);
const tabbar = $('tabbar');
const toolbar = $('toolbar');
const filename = $('filename');
const wordcountEl = $('wordcount');
const banner = $('app-banner');
const bannerText = $('app-banner-text');
const content = $('content');
const start = $('start');
const doc = $('doc');
const find = createFindBar($('find'), () => doc);
const panes = $('panes');
const editorEl = $('editor');
const modeSwitch = $('mode-switch');
const tabBanner = $('tab-banner');
const tabBannerText = $('tab-banner-text');
const tabBannerActions = $('tab-banner-actions');
const tabBannerRecovered = $('tab-banner-recovered');
const sidebarEl = $('sidebar');
const filesTree = $('files-tree');
const filesEmpty = $('files-empty');
const outlinePanel = $('sidebar-panel-outline');
const searchPanel = $('search-panel');
const SIDEBAR_TABS = ['files', 'outline', 'search'];
const sidebarTabEl = (name) => $(`sidebar-tab-${name}`);
const sidebarPanelEl = (name) => $(`sidebar-panel-${name}`);
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
// The user's Ctrl+Shift+B choice; null until they make one, which means
// "shown while a folder is open". Narrow windows hide the sidebar without
// changing it, so it comes back when the window widens.
let sidebarWanted = null;
let sidebarTab = 'files'; // 'files' | 'outline' | 'search'
let sidebarChosen = false; // the user (or a stored choice) set sidebarWanted explicitly

let recent = { files: [], folders: [] }; // as last returned by the backend
let lastRecentKey = null;

const editor = createEditor(editorEl, {
  onChange: onEditorChange,
  onCursor: onEditorCursor,
  onPasteImage: pasteImage,
});

// A screenshot pasted into the editor: save it next to the saved document and
// hand the Markdown link back to the editor (null: nothing to insert, the tab
// banner says why).
async function pasteImage(blob) {
  const tab = getActiveTab();
  if (!tab) return null;
  const id = tab.id;
  const fail = (text) => {
    commit((s) => T.setBanner(s, id, { kind: PASTE_ERROR, text }));
    return null;
  };
  if (!tab.path) return fail('Save the file first to paste images.');
  try {
    const { base64, ext } = await blobToImage(blob);
    return await savePastedImage(tab.path, base64, ext, new Date(), backend.writeImage);
  } catch (err) {
    console.warn('pasting an image failed:', err);
    return fail(`Couldn't save the image: ${errorText(err)}`);
  }
}

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

// ---- crash-recovery drafts -------------------------------------------------

// A dirty tab's text is mirrored to a draft file (2 s after typing stops, at
// most every 10 s while typing). Rather than every code path that saves,
// reloads or closes a tab telling the scheduler, render() reconciles: any
// dirty tab whose text changed is `changed`, any tab that was dirty and is
// now clean or gone is `clean`.
const draftScheduler = createDraftScheduler({
  // getState() flushes the editor, so the write holds the latest typed text.
  getTab: (id) => getState().tabs.find((t) => t.id === id) || null,
  save: (draft) => backend.draftSave(draft),
  remove: (id) => backend.draftDelete(id),
});
const draftTracked = new Map(); // tab id -> { text, savedText, draftId } of tabs with a (possible) draft

function syncDrafts() {
  const present = new Set();
  for (const tab of state.tabs) {
    present.add(tab.id);
    const seen = draftTracked.get(tab.id);
    if (T.isDirty(tab)) {
      if (!seen || seen.text !== tab.text || seen.savedText !== tab.savedText || seen.path !== tab.path) {
        draftTracked.set(tab.id, { text: tab.text, savedText: tab.savedText, path: tab.path, draftId: tab.draftId });
        draftScheduler.changed(tab);
      }
    } else if (seen) {
      draftTracked.delete(tab.id);
      draftScheduler.clean(tab.id, seen.draftId);
    }
  }
  for (const [id, seen] of draftTracked) {
    if (present.has(id)) continue;
    draftTracked.delete(id);
    draftScheduler.clean(id, seen.draftId);
  }
}

// Closing the window waits (briefly) for draft writes and removes, so a write
// in flight can't bring back the draft of a tab that was just discarded.
const settleDrafts = (ms) =>
  Promise.race([draftScheduler.settled(), new Promise((r) => setTimeout(r, ms))]).catch(() => {});

// ---- settings and autosave -------------------------------------------------

const settings = createSettings(backend);

// Autosave: render() reconciles which dirty tabs have a 1 s timer (see
// autosave.js). It saves through the normal save(); a failed save (banner
// already shown) pauses the tab until a manual save succeeds.
const autosave = createAutosave({
  getTab: (id) => getState().tabs.find((t) => t.id === id) || null,
  blocked: () => modalOpen,
  save: async (id) => {
    const ok = await save(id);
    // Only a real failure pauses (its banner is up); a cancelled joined
    // Save As also returns false.
    if (!ok && findTab(id)?.banner?.kind === SAVE_ERROR) commit((s) => T.setAutosavePaused(s, id, true));
  },
});

function syncAutosave() {
  autosave.sync(state.tabs, settings.get().autosave);
}
settings.onChange(syncAutosave);

let appVersion = '';
async function showAbout() {
  try {
    appVersion = appVersion || (await backend.appInfo()).version;
  } catch (err) {
    console.warn('app_info failed:', err);
  }
  showBanner(appVersion ? `Folio ${appVersion}` : 'Folio', 'info');
}

// ---- zoom and theme ----------------------------------------------------------

// Zoom scales the document and editor text through --doc-zoom (chrome stays
// put); the theme is data-theme on <html> (absent = follow the system).
function applyAppearance({ zoom, theme }) {
  const root = document.documentElement;
  root.style.setProperty('--doc-zoom', String(zoom / 100));
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  Promise.resolve(backend.setWindowTheme(theme === 'system' ? null : theme)).catch((err) =>
    console.warn('setting the window theme failed:', err));
}
let appliedLook = '';
function syncAppearance() {
  const { zoom, theme } = settings.get();
  const key = `${zoom}/${theme}`;
  if (key === appliedLook) return;
  appliedLook = key;
  applyAppearance({ zoom, theme });
  // Heading positions move with the text size.
  requestAnimationFrame(() => syncOutlineCurrent(true));
}
settings.onChange(syncAppearance);

// Diagrams follow the theme: redraw them when the effective theme changes
// (the setting, or the system theme while following it).
let drawnTheme = effectiveTheme();
function syncDiagramTheme() {
  const theme = effectiveTheme();
  if (theme === drawnTheme) return;
  drawnTheme = theme;
  if (doc.querySelector('.diagram')) enhanceDoc();
}
settings.onChange(syncDiagramTheme);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncDiagramTheme);

function zoomBy(dir) {
  settings.update({ zoom: zoomStep(settings.get().zoom, dir) });
}

// Ctrl+wheel over the document or editor: deltaY accumulates and steps once
// per 100 units, so a free-spinning wheel or trackpad pinch can't race
// through the range.
let wheelAcc = 0;
function onZoomWheel(e) {
  if (!e.ctrlKey) return;
  e.preventDefault(); // also keeps the WebView's own zoom away
  if (Math.sign(e.deltaY) !== Math.sign(wheelAcc)) wheelAcc = 0;
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) < 100) return;
  const dir = wheelAcc < 0 ? 1 : -1;
  wheelAcc = 0;
  zoomBy(dir);
}
for (const el of [content, editorEl]) el.addEventListener('wheel', onZoomWheel, { passive: false });

// Later tasks append their items here.
function moreMenuItems() {
  const { theme, zoom } = settings.get();
  const hasDoc = !!getActiveTab();
  const themeItem = (label, value) => ({
    label,
    checked: theme === value,
    radio: true,
    onSelect: () => settings.update({ theme: value }),
  });
  return [
    {
      label: 'Theme',
      submenu: [themeItem('System', 'system'), themeItem('Light', 'light'), themeItem('Dark', 'dark')],
    },
    {
      label: 'Autosave',
      checked: settings.get().autosave,
      onSelect: () => settings.update({ autosave: !settings.get().autosave }),
    },
    'separator',
    { label: 'Zoom in', onSelect: () => zoomBy(1) },
    { label: 'Zoom out', onSelect: () => zoomBy(-1) },
    { label: 'Reset zoom', onSelect: () => zoomBy(0) },
    { label: `Zoom: ${zoom}%`, disabled: true },
    'separator',
    { label: 'Export HTML…', disabled: !hasDoc, onSelect: exportHtml },
    { label: 'Print…', disabled: !hasDoc, onSelect: printDoc },
    'separator',
    { label: 'About Folio', onSelect: showAbout },
  ];
}

$('more-btn').addEventListener('click', () => {
  openMenu($('more-btn'), moreMenuItems());
});

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

function showBanner(message, kind = 'error') {
  bannerText.textContent = message;
  banner.classList.toggle('banner-error', kind !== 'info');
  banner.classList.toggle('banner-info', kind === 'info');
  banner.setAttribute('role', kind === 'info' ? 'status' : 'alert');
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
let modalDepth = 0; // open modals; overlapping ones can't clear each other's flag
const pending = []; // jobs: { path, run() }
let chain = Promise.resolve();

export function setModalOpen(open) {
  modalDepth = open ? modalDepth + 1 : Math.max(0, modalDepth - 1);
  modalOpen = modalDepth > 0;
  if (!modalOpen && pending.length) enqueue(pending.splice(0));
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
// `silent`: session restore; a file that can't be read is skipped without a
// banner, and the recent list keeps its order.
let userOpens = 0; // opens that did not come from the session restore
async function openPath(path, { fromRecent = false, silent = false, mode = null } = {}) {
  if (!silent) userOpens += 1;
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
    if (silent) return;
    if (fromRecent && isNotFound(err)) forgetRecent(path);
    else showOpenError(path);
    return;
  }
  editor.flush(); // so `before` holds the latest typed text
  const before = state;
  try {
    commit((s) => {
      const opened = T.openFile(s, { path, ...file });
      return mode && mode !== 'read' ? T.setMode(opened, opened.activeId, mode) : opened;
    });
  } catch (err) {
    // Don't keep a tab we couldn't show.
    state = before;
    render();
    throw err;
  }
  if (!silent) addRecent(path, 'file');
}

// A dropped or launched path: list_tree answers "not a folder" for a file,
// which then opens as a file (reporting its own read errors). Any other
// listing error is a folder that could not be opened, unless the path looks
// like a Markdown file: that opens as a file, so its error says so. An already open file
// skips the probe.
async function openFileOrFolder(path) {
  if (T.findByPath(state, path)) return openPath(path);
  let listed;
  try {
    listed = await backend.listTree(path);
  } catch (err) {
    // A Markdown file that list_tree couldn't probe gets the file error copy.
    if (isNotAFolder(err) || isMarkdownPath(path)) return openPath(path);
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
async function openFolder(path, { listed = null, fromRecent = false, silent = false } = {}) {
  if (!silent) userOpens += 1;
  let result = listed;
  if (!result) {
    try {
      result = await backend.listTree(path);
    } catch (err) {
      console.warn(`listTree(${path}) failed:`, err);
      if (silent) return;
      if (fromRecent && isNotFound(err)) forgetRecent(path);
      else showBanner(`Couldn't open ${basename(path)}.`);
      return;
    }
  }
  // Re-opening the same folder keeps what was expanded.
  const same = folder && T.normalizePath(folder.path) === T.normalizePath(path);
  if (!same) {
    expanded = new Set();
    editing = null;
    ghostDirs.clear();
    resetSearch();
  }
  folder = { path, root: result.root, truncated: !!result.truncated };
  folderSeq += 1;
  treeVersion += 1;
  if (!silent) sidebarWanted = true;
  render();
  if (!silent) addRecent(path, 'folder');
}

function toggleFolder(path) {
  const key = T.normalizePath(path);
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  treeVersion += 1;
  render();
}

const sidebarIsWanted = () => sidebarWanted ?? !!folder;
const sidebarIsShown = () => sidebarIsWanted() && roomy.matches;

// Ctrl+Shift+B. Hiding it with focus inside moves focus to the document.
function toggleSidebar() {
  sidebarWanted = !sidebarIsWanted();
  sidebarChosen = true;
  const hadFocus = sidebarEl.contains(document.activeElement);
  render();
  if (hadFocus && sidebarEl.hidden) {
    if (showsEditor(view)) editor.focus();
    else content.focus({ preventScroll: true });
  }
}

// Show the sidebar (on `tab`, when given). Ctrl+Shift+L passes `focus` to
// land on the Outline's current item. A window too narrow for a sidebar
// keeps it hidden; the choice comes back when it widens.
function showSidebar(tab, { focus = false } = {}) {
  if (tab) sidebarTab = tab;
  sidebarWanted = true;
  sidebarChosen = true;
  render();
  if (focus && !sidebarEl.hidden) focusSidebarTab();
}

function focusSidebarTab() {
  const panel = sidebarPanelEl(sidebarTab);
  const target = sidebarTab === 'outline'
    ? panel.querySelector('.outline-item[aria-current]') || panel.querySelector('.outline-item')
    : null;
  (target || sidebarTabEl(sidebarTab)).focus({ preventScroll: true });
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

// ---- sidebar file operations ---------------------------------------------

// New file / New folder / Rename / Delete / Show in Explorer. Targets are
// always inside the open folder (checked here; folio-core only checks that
// a path is absolute and local).
let editing = null; // the inline name input, see renderTree
let committingEdit = false;
// Folders we created: the lister hides folders without Markdown, so they are
// added to what the sidebar shows until a file lands in them.
const ghostDirs = new Map(); // normalized path -> path
// Old paths of a rename we are doing, for ~2 s: the watcher's "removed" for
// them is not a deletion.
const ownRemovals = new Map(); // normalized path -> expiry (ms)
const OWN_REMOVAL_MS = 2000;

function markOwnRemoval(paths) {
  const until = Date.now() + OWN_REMOVAL_MS;
  for (const p of paths) ownRemovals.set(T.normalizePath(p), until);
}

function isOwnRemoval(path) {
  const now = Date.now();
  for (const [k, until] of ownRemovals) if (until <= now) ownRemovals.delete(k);
  return ownRemovals.has(T.normalizePath(path));
}

const sameDisk = (a, b) => T.normalizePath(a) === T.normalizePath(b);
// Strictly inside the open folder (not the folder itself).
const insideFolder = (path) => !!folder && !sameDisk(folder.path, path) && isInside(folder.path, path);
const inFolderOrRoot = (path) => !!folder && isInside(folder.path, path);

function fileOpError(action, name, err) {
  console.warn(`${action} ${name} failed:`, err);
  showBanner(`Couldn't ${action} ${name}: ${errorText(err)}`);
}

// The tree as shown: the listing plus the folders we created.
function displayRoot() {
  if (!ghostDirs.size) return folder.root;
  const root = structuredClone(folder.root);
  const byKey = new Map();
  const index = (n) => {
    byKey.set(T.normalizePath(n.path), n);
    for (const c of n.children || []) index(c);
  };
  index(root);
  for (const [key, path] of [...ghostDirs].sort((a, b) => a[0].length - b[0].length)) {
    if (byKey.has(key)) {
      ghostDirs.delete(key); // it has Markdown in it now (or came back)
      continue;
    }
    const parent = byKey.get(T.normalizePath(dirname(path)));
    if (!parent || parent.kind !== 'dir') continue;
    const name = basename(path);
    const node = { name, path, kind: 'dir', children: [] };
    const kids = parent.children || (parent.children = []);
    let i = kids.findIndex((c) => c.kind !== 'dir' || c.name.toLowerCase() > name.toLowerCase());
    if (i < 0) i = kids.length;
    kids.splice(i, 0, node);
    byKey.set(key, node);
  }
  return root;
}

const findNode = (path) => {
  const want = T.normalizePath(path);
  const walk = (n) => {
    if (T.normalizePath(n.path) === want) return n;
    for (const c of n.children || []) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return folder ? walk(displayRoot()) : null;
};

function redrawTree() {
  treeVersion += 1;
  render();
}

function focusRow(path) {
  if (!path) return;
  const want = T.normalizePath(path);
  for (const row of filesTree.querySelectorAll('.tree-row[data-path]')) {
    if (T.normalizePath(row.dataset.path) === want) {
      row.focus({ preventScroll: true });
      return;
    }
  }
}

function startNew(kind, parentPath) {
  if (!folder || !inFolderOrRoot(parentPath)) return;
  closeMenu();
  showSidebar('files');
  if (sidebarEl.hidden) return; // too narrow for a sidebar: nowhere to type
  if (!sameDisk(folder.path, parentPath)) expanded.add(T.normalizePath(parentPath));
  editing = { kind, parent: parentPath, initial: '', error: null };
  redrawTree();
}

function startRename(node) {
  if (!node || !insideFolder(node.path)) return;
  closeMenu();
  editing = {
    kind: 'rename', path: node.path, parent: dirname(node.path), initial: node.name,
    isDir: node.kind === 'dir', error: null,
  };
  redrawTree();
}

function cancelEdit() {
  const e = editing;
  if (!e) return;
  editing = null;
  redrawTree();
  focusRow(e.kind === 'rename' ? e.path : e.parent);
}

function setEditError(error) {
  editing = { ...editing, error };
  redrawTree();
}

async function commitEdit(raw, { fromBlur = false } = {}) {
  const e = editing;
  if (!e || committingEdit) return;
  const bad = (msg) => (fromBlur ? cancelEdit() : setEditError(msg));
  const problem = validateName(raw);
  if (problem) return bad(problem);
  // New files get .md; a renamed file keeps its extension if none is typed.
  const name = e.kind === 'file' ? withMdExtension(raw)
    : e.kind === 'rename' && !e.isDir ? keepExtension(raw, e.initial) : raw;
  if (e.kind === 'rename' && name === e.initial) return cancelEdit();
  const dir = e.kind === 'rename' ? dirname(e.path) : e.parent;
  const clash = (findNode(dir)?.children || []).some((c) =>
    c.name.toLowerCase() === name.toLowerCase() && !(e.kind === 'rename' && sameDisk(c.path, e.path)));
  if (clash) return bad(`“${name}” already exists here.`);
  committingEdit = true;
  try {
    if (e.kind === 'rename') await doRename(e, name);
    else await doCreate(e, name);
  } finally {
    committingEdit = false;
  }
}

async function refreshFolder() {
  if (folder) await onFolderChanged({ folder: folder.path });
}

async function doCreate(e, name) {
  const target = joinPath(e.parent, name);
  const isDir = e.kind === 'dir';
  if (!inFolderOrRoot(target)) return cancelEdit();
  try {
    await (isDir ? backend.createDir(target) : backend.createFile(target));
  } catch (err) {
    editing = null;
    redrawTree();
    fileOpError('create', name, err);
    return;
  }
  editing = null;
  if (isDir) ghostDirs.set(T.normalizePath(target), target);
  redrawTree();
  await refreshFolder();
  if (isDir) {
    focusRow(target);
    return;
  }
  await enqueue([{ path: target, run: () => openPath(target, { mode: 'edit' }) }]);
  focusEditorIfShown();
}

async function doRename(e, name) {
  const from = e.path;
  const to = joinPath(dirname(from), name);
  if (!insideFolder(from) || !inFolderOrRoot(to)) return cancelEdit();
  // Saves wait at this gate until the tabs point at the new path (closed
  // before anything else, so no save can slip in and write the old path).
  let open;
  renaming.hold(new Promise((r) => { open = r; }));
  // Saves already past the gate (before it closed) finish first: one in
  // flight would write the old path again after the rename.
  const inFlight = [...saving.values()];
  try {
    await Promise.all(inFlight.map((p) => p.catch(() => {})));
    await renameAndRetarget(e, from, to);
  } finally {
    open();
  }
}

async function renameAndRetarget(e, from, to) {
  const moved = (t) => t.path != null && remapPath(t.path, from, to) !== null;
  // The watcher will report the old paths as removed (also a case-only
  // rename on a case-sensitive disk): not deletions.
  const oldPaths = getState().tabs.filter(moved).map((t) => t.path);
  markOwnRemoval(oldPaths);
  try {
    await backend.renamePath(from, to);
  } catch (err) {
    for (const p of oldPaths) ownRemovals.delete(T.normalizePath(p));
    editing = null;
    redrawTree();
    fileOpError('rename', e.initial, err);
    return;
  }
  editing = null;
  // Tabs keep their text and dirty state; only path and title change.
  commit((s) => s.tabs.reduce((acc, t) => {
    const next = t.path != null ? remapPath(t.path, from, to) : null;
    return next ? T.retarget(acc, t.id, next) : acc;
  }, s));
  // A new path is not "ours to ignore": a quick rename back, or a real
  // deletion, must still show. (Same key as an old path = case-only: keep.)
  const oldKeys = new Set(oldPaths.map((p) => T.normalizePath(p)));
  for (const t of getState().tabs.filter((t) => t.path != null)) {
    const k = T.normalizePath(t.path);
    if (!oldKeys.has(k)) ownRemovals.delete(k);
  }
  // Recent entries, expanded folders and created-folder markers follow.
  for (const [list, kind] of [[recent.files, 'file'], [recent.folders, 'folder']]) {
    for (const p of list) {
      const next = remapPath(p, from, to);
      if (!next) continue;
      trackRecent(backend.recentRemove(p), 'recentRemove');
      trackRecent(backend.recentAdd(next, kind), 'recentAdd');
    }
  }
  const remapKeys = (keys) => [...keys].map((k) => {
    const next = remapPath(k, from, to);
    return next ? T.normalizePath(next) : k;
  });
  expanded = new Set(remapKeys(expanded));
  const ghosts = [...ghostDirs.values()].map((p) => remapPath(p, from, to) ?? p);
  ghostDirs.clear();
  for (const p of ghosts) ghostDirs.set(T.normalizePath(p), p);
  redrawTree();
  await refreshFolder();
  focusRow(to);
}

async function deleteNode(node) {
  if (!node || !insideFolder(node.path)) return;
  closeMenu();
  const isDir = node.kind === 'dir';
  const ok = await confirmAction({
    title: isDir
      ? `Move ${node.name} and everything in it to the Recycle Bin?`
      : `Move ${node.name} to the Recycle Bin?`,
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
  });
  if (!ok) {
    focusRow(node.path);
    return;
  }
  try {
    await backend.trashPath(node.path);
  } catch (err) {
    fileOpError('delete', node.name, err);
    return;
  }
  for (const [k, p] of [...ghostDirs]) if (isInside(node.path, p)) ghostDirs.delete(k);
  // Open tabs of deleted files get the watcher's "was deleted or moved." banner.
  redrawTree();
  await refreshFolder();
}

async function revealNode(node) {
  try {
    await backend.revealPath(node.path);
  } catch (err) {
    fileOpError('show', `${node.name} in Explorer`, err);
  }
}

// Right-click / Shift+F10 / the row's "..." button. `node` is the root for
// empty space; new items go inside a folder, or next to a file.
function openFileMenu(node, x, y, anchor) {
  if (!folder || !node) return;
  const isRoot = sameDisk(node.path, folder.path);
  const parent = node.kind === 'dir' ? node.path : dirname(node.path);
  openMenu(anchor, [
    { label: 'New file', onSelect: () => startNew('file', parent) },
    { label: 'New folder', onSelect: () => startNew('dir', parent) },
    ...(isRoot ? [] : [
      { label: 'Rename', onSelect: () => startRename(node) },
      { label: 'Delete', onSelect: () => deleteNode(node) },
    ]),
    'separator',
    { label: 'Show in Explorer', onSelect: () => revealNode(node) },
  ], { at: { x, y } });
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
const PASTE_ERROR = 'paste-error';
const saving = new Map(); // tab id -> in-flight save promise
// Closed while a rename is in flight: a save must not read tab.path until the
// tab points at the renamed file (see gate.js).
const renaming = createGate();

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
  await renaming.wait();
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
  commit((s) => T.saveSucceeded(s, id, saveAs ? { path, text } : { text }));
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
  outlineCache.delete(id);
  wordCache.delete(id);
  collapsedByTab.delete(id);
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
  // The session is what was open before the prompts start closing tabs.
  syncSession();
  sessionFrozen = true;
  let ok = false;
  try {
    ok = await closeWindowFlow();
    if (ok) {
      autosave.cancelAll();
      await settleDrafts(1500);
      await Promise.race([settings.flush(), new Promise((r) => setTimeout(r, 1500))]);
    }
    return ok;
  } catch (err) {
    console.error('close flow failed:', err);
    return false;
  } finally {
    windowClosing = false;
    if (!ok) {
      sessionFrozen = false;
      syncSession();
    }
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

// Session restore: settings.session follows the path tabs (with modes), the
// active tab and the folder; settings.sidebar follows the sidebar. Not before
// the restore has read the stored session, and not once the window is closing
// (closing tabs one by one must not shrink it).
let sessionLive = false;
let sessionFrozen = false;
let sessionKey = null;
let sidebarKey = null;
// Entries the restore found missing: kept in the stored session until the
// user changes the tab set or the folder.
let skippedSession = null;
let skippedShape = null;

function syncSession() {
  if (!sessionLive) return;
  if (!sessionFrozen) {
    let session = captureSession(state, currentFolder());
    if (skippedSession) {
      // Any change of tab set or folder (a launch file included) drops the skipped entries.
      if (sessionShape(session) === skippedShape) session = mergeSkipped(session, skippedSession);
      else skippedSession = null;
    }
    const key = JSON.stringify(session);
    if (key !== sessionKey) {
      sessionKey = key;
      settings.update({ session });
    }
  }
  const sbKey = `${sidebarChosen ? sidebarWanted : null}|${sidebarTab}`;
  if (sbKey !== sidebarKey) {
    sidebarKey = sbKey;
    settings.update({ sidebar: { visible: sidebarChosen ? !!sidebarWanted : null, tab: sidebarTab } });
  }
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
  // The old path of a rename we are doing: not a deletion.
  if (kind === 'removed' && isOwnRemoval(path)) return;
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

// ---- recovered drafts ----------------------------------------------------

const RECOVERED = 'recovered'; // "Recovered unsaved changes." Keep / Discard
const discarding = new Set(); // tab ids whose Discard is reading the disk

// Keep: the banner goes, the tab stays dirty and its draft stays.
// Discard: back to the file on disk (untitled: the tab closes), draft deleted
// (the tab becoming clean or gone does that, see syncDrafts).
async function answerRecovered(discard) {
  const tab = getActiveTab();
  if (tab?.banner?.kind !== RECOVERED) return;
  const id = tab.id;
  if (!discard) {
    commit((s) => T.setBanner(s, id, null));
  } else if (tab.path == null) {
    closeTabNow(id);
  } else {
    if (discarding.has(id)) return;
    discarding.add(id);
    try {
      let file;
      try {
        file = await backend.readFile(tab.path);
      } catch (err) {
        console.warn(`readFile(${tab.path}) failed:`, err);
        if (!isNotFound(err)) {
          showBanner(`Couldn't reload ${tab.title}: ${errorText(err)}`);
          return;
        }
        // Nothing on disk to go back to.
        if (findTab(id)?.banner?.kind === RECOVERED) closeTabNow(id);
        return;
      }
      if (findTab(id)?.banner?.kind !== RECOVERED) return; // answered meanwhile
      commit((s) => T.setBanner(T.loadFromDisk(s, id, file), id, null));
    } finally {
      discarding.delete(id);
    }
  }
  focusEditorIfShown();
}

$('tab-banner-keep-draft').addEventListener('click', () => answerRecovered(false));
$('tab-banner-discard-draft').addEventListener('click', () => answerRecovered(true));

// Startup: every draft that is still on disk is a tab that was dirty when
// Folio last stopped. Each opens as a dirty tab holding the draft's text.
function restoreDraft(draft, file, diskChanged) {
  const d = restoreDecision(draft, file, {
    diskChanged,
    pathOpen: draft.path != null && !!T.findByPath(state, draft.path),
    titles: state.tabs.map((t) => t.title),
  });
  if (d.action === 'delete') {
    backend.draftDelete(draft.id).catch((err) => console.warn('removing draft failed:', err));
    return;
  }
  commit((s) => T.openRecovered(s, {
    draftId: draft.id, path: d.path, title: d.title, text: draft.text, savedText: d.savedText,
    eol: draft.eol, bom: !!draft.bom, banner: { kind: RECOVERED, text: d.bannerText },
  }));
}

// Reopen the stored session, queued right after the drafts (so before any
// open-paths event or launch path): its tabs with their modes (also applied
// to tabs the drafts restored), then the folder. Files are read in parallel
// and shown with one commit. Missing files and folders are skipped silently
// (and kept in the stored session); nothing here touches the recent list.
// Capturing starts when this is done. Never reports an error.
function restoreSession() {
  return enqueue([{
    path: 'session',
    run: async () => {
      try {
        const session = settings.get().session;
        const opensBefore = userOpens;
        const plan = startupOrder({
          drafts: state.tabs.filter((t) => t.path != null).map((t) => t.path),
          session,
        });
        const modes = new Map(session.tabs.map((t) => [T.normalizePath(t.path), t.mode]));
        const toRead = plan.open.map((o) => o.path).filter((p) => !T.findByPath(state, p));
        const [reads, tree] = await Promise.all([
          Promise.allSettled(toRead.map((p) => backend.readFile(p))),
          plan.folder ? backend.listTree(plan.folder).catch((err) => {
            console.warn(`listTree(${plan.folder}) failed:`, err);
            return null;
          }) : null,
        ]);
        const skipped = { tabs: [], folder: null };
        const files = [];
        reads.forEach((r, i) => {
          if (r.status === 'fulfilled') files.push({ path: toRead[i], ...r.value });
          else {
            console.warn(`readFile(${toRead[i]}) failed:`, r.reason);
            skipped.tabs.push({ path: toRead[i], mode: modes.get(T.normalizePath(toRead[i])) ?? 'read' });
          }
        });
        editor.flush();
        const before = state;
        try {
          commit((s0) => {
            let s = s0;
            for (const f of files) s = T.openFile(s, f);
            for (const t of s.tabs) {
              const mode = t.path != null ? modes.get(T.normalizePath(t.path)) : null;
              if (mode && mode !== t.mode) s = T.setMode(s, t.id, mode);
            }
            const active = plan.activate && userOpens === opensBefore ? T.findByPath(s, plan.activate) : null;
            const target = active ? active.id : s0.activeId;
            return target ? T.activate(s, target) : s;
          });
        } catch (err) {
          state = before;
          console.error('restoring the session failed:', err);
        }
        if (plan.folder) {
          if (tree) await openFolder(plan.folder, { silent: true, listed: tree });
          else skipped.folder = plan.folder;
        }
        if (skipped.tabs.length || skipped.folder) {
          skippedSession = skipped;
          skippedShape = sessionShape(captureSession(state, currentFolder()));
        }
      } catch (err) {
        console.error('restoring the session failed:', err);
      } finally {
        sessionLive = true;
        render();
      }
    },
  }]);
}

// One job on the open queue, queued before anything else can be, so
// open-paths events and launch paths land after the drafts. It starts once
// the other backend listeners are in place.
function restoreDrafts(listenersReady) {
  return enqueue([{
    path: 'recovered drafts',
    run: async () => {
      await listenersReady;
      let drafts;
      try {
        drafts = await backend.draftsList();
      } catch (err) {
        console.warn('draftsList failed:', err);
        return;
      }
      if (!Array.isArray(drafts) || !drafts.length) return;
      const files = new Map(); // path -> read result
      const diskTexts = new Map();
      for (const d of drafts) {
        if (d.path == null || diskTexts.has(d.path)) continue;
        try {
          const file = await backend.readFile(d.path);
          files.set(d.path, file);
          diskTexts.set(d.path, file.text);
        } catch (err) {
          console.warn(`readFile(${d.path}) failed:`, err);
          diskTexts.set(d.path, null);
        }
      }
      for (const { draft, diskChanged } of restorePlan(drafts, diskTexts)) {
        try {
          restoreDraft(draft, draft.path != null ? files.get(draft.path) : null, diskChanged);
        } catch (err) {
          console.error(`restoring draft ${draft.id} failed:`, err);
        }
      }
    },
  }]);
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
    syncDrafts();
    syncAutosave();
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

  syncWordCount(tab);

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

  // Rendered document (Read, or the Split preview). Find belongs to one
  // tab's document: it closes when that is left.
  if (find.isOpen() && (!tab || !showsDoc(next) || shown.id !== tab.id)) find.close();
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
  syncSession();
  syncOutlineCurrent();

  const title = T.windowTitle(state);
  if (title !== lastTitle) {
    lastTitle = title;
    backend.setTitle(title).catch((err) => console.warn('setTitle failed:', err));
  }
}

// Which sidebar tab was laid out last, and the scroll positions of tabs
// that have been left (a hidden panel forgets its scroll).
let laidOutTab = null;
const panelScroll = new Map();
const scrollerOf = (name) => (name === 'files'
  ? filesTree.querySelector('.tree-scroll')
  : name === 'outline' ? outlinePanel : name === 'search' ? searchPanel.querySelector('.search-results') : null);

// Only the selected tab's content is built. The tree is rebuilt only when it,
// what is expanded, or the active file changed.
function renderSidebar(tab) {
  const visible = sidebarIsShown();
  if (laidOutTab) {
    const scroller = scrollerOf(laidOutTab);
    if (scroller && (!visible || laidOutTab !== sidebarTab)) panelScroll.set(laidOutTab, scroller.scrollTop);
  }
  sidebarEl.hidden = !visible;
  if (!visible) {
    laidOutTab = null;
    stopOutline();
    return;
  }
  for (const name of SIDEBAR_TABS) {
    const on = name === sidebarTab;
    const btn = sidebarTabEl(name);
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
    sidebarPanelEl(name).hidden = !on;
  }

  if (editing && (sidebarTab !== 'files' || !folder)) editing = null;
  if (sidebarTab === 'files') {
    filesEmpty.hidden = !!folder;
    filesTree.hidden = !folder;
    if (folder) {
      const activePath = tab?.path ?? null;
      const key = `${treeVersion}|${activePath == null ? '' : T.normalizePath(activePath)}`;
      if (key !== lastSidebarKey) {
        lastSidebarKey = key;
        renderTree(filesTree, displayRoot(), {
          activePath,
          expanded,
          truncated: folder.truncated,
          onOpen: (path) => openPaths([path]),
          onToggle: toggleFolder,
          onContextMenu: openFileMenu,
          onRename: startRename,
          onDelete: deleteNode,
          onNew: startNew,
          editing,
          onCommit: commitEdit,
          onCancel: cancelEdit,
        });
      }
    }
  } else if (sidebarTab === 'search') {
    if (searchRenderedVersion !== searchVersion) drawSearch();
  }
  if (sidebarTab === 'outline') syncOutline(tab);
  else stopOutline();

  if (laidOutTab !== sidebarTab) {
    const scroller = scrollerOf(sidebarTab);
    const top = panelScroll.get(sidebarTab);
    if (scroller && top) scroller.scrollTop = top;
  }
  laidOutTab = sidebarTab;
}

// ---- folder search -------------------------------------------------------

const SEARCH_DEBOUNCE = 250;
// Request ids must keep increasing across webview reloads (the backend
// cancels anything older than the newest it has seen): seed from the clock.
let searchSeq = Date.now();
let search = newSearch();
let searchTimer = null;
let searchVersion = 0; // bumped when what the panel shows changes
let searchRenderedVersion = -1;

function newSearch() {
  return { query: '', matchCase: false, resultsQuery: '', resultsMatchCase: false, results: null, truncated: false, running: false, collapsed: new Set() };
}

// A different folder opened: its search starts empty.
function resetSearch() {
  clearTimeout(searchTimer);
  searchTimer = null;
  cancelBackendSearch();
  search = newSearch();
  searchVersion += 1;
}

// A newer id with an empty query returns at once and stops a running walk.
function cancelBackendSearch() {
  const id = ++searchSeq; // any answer still on its way is stale
  if (folder) backend.searchFolder(folder.path, '', false, id).catch(() => {});
}

function drawSearch() {
  searchRenderedVersion = searchVersion;
  renderSearch(searchPanel, { ...search, folder: folder?.path ?? null }, {
    onQuery: (q, now) => {
      search.query = q;
      scheduleSearch(now);
    },
    onToggleCase: () => {
      search.matchCase = !search.matchCase;
      scheduleSearch(true);
    },
    onRefresh: () => scheduleSearch(true),
    onToggleFile: (path) => {
      if (!search.collapsed.delete(path)) search.collapsed.add(path);
      searchVersion += 1;
      drawSearch();
    },
    onPick: openSearchResult,
  });
}

function scheduleSearch(now) {
  clearTimeout(searchTimer);
  searchTimer = null;
  if (now) runSearch();
  else searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE);
}

async function runSearch() {
  clearTimeout(searchTimer);
  searchTimer = null;
  const { query, matchCase } = search;
  if (!folder || !query) {
    cancelBackendSearch();
    search = { ...search, results: null, truncated: false, running: false };
    searchVersion += 1;
    if (sidebarTab === 'search') drawSearch();
    return;
  }
  const id = ++searchSeq;
  search = { ...search, running: true };
  searchVersion += 1;
  if (sidebarTab === 'search') drawSearch();
  // Only a newer search (or another folder, which bumps searchSeq) makes an
  // answer stale; re-opening the same folder does not.
  const stale = () => id !== searchSeq;
  try {
    const res = await backend.searchFolder(folder.path, query, matchCase, id);
    if (stale()) return;
    search = {
      ...search, results: res.files, resultsQuery: query, resultsMatchCase: matchCase,
      truncated: !!res.truncated, running: false, collapsed: new Set(),
    };
  } catch (err) {
    if (stale() || err === 'cancelled') return;
    console.warn('searchFolder failed:', err);
    search = { ...search, results: null, truncated: false, running: false };
    showBanner(`Couldn't search ${basename(folder.path)}.`);
  }
  searchVersion += 1;
  if (sidebarTab === 'search') drawSearch();
}

// Open `path`, wait for it to be the active, rendered tab, then `then(tab)`.
// Goes through the open queue, so it waits for modals like any other open.
function openThen(path, then) {
  return enqueue([{
    path,
    run: async () => {
      await openPath(path);
      const tab = getActiveTab();
      if (tab?.path && T.normalizePath(tab.path) === T.normalizePath(path)) then(tab);
    },
  }]);
}

// A result row: Edit/Split select the match; Read finds it in the rendered
// document (the Nth occurrence, N = matches before its line + its place on
// the line).
function openSearchResult(path, line, match, indexInLine = 0) {
  // The query that produced the rows, not whatever is in the box now.
  const query = search.resultsQuery;
  const matchCase = search.resultsMatchCase;
  return openThen(path, (tab) => {
    const focus = !modalOpen; // a modal is answered first: no focus theft
    if (showsEditor(view)) {
      editor.selectRange(line, match.col, match.col + (match.end - match.start));
      if (focus) editor.focus();
    } else {
      find.open(query, matchOrdinal(tab.text, line, query, matchCase) + indexInLine, { matchCase, focus });
    }
  });
}

// `file.md#section`: after the open settles, bring the heading into view.
function scrollToFragment(tab, frag) {
  const heading = headingForFragment(tab.text, frag, { math: true });
  if (!heading) return; // unknown anchor: leave the scroll alone
  if (showsDoc(view)) scrollDocToId(heading.id);
  if (showsEditor(view)) {
    editor.revealLine(heading.line);
    if (view === 'edit' && !modalOpen) editor.focus();
  }
}

// ---- word count ----------------------------------------------------------

const wordCache = new Map(); // tab id -> { text, label } for that text
let wordTimer = null;
let wordShownFor = null; // tab id the label currently describes

function setWordLabel(label) {
  wordcountEl.textContent = label;
  wordcountEl.hidden = !label;
}

// A tab switch (or any change that is not typing) shows the count at once,
// from the cache when the text is unchanged; typing waits for the preview
// delay, so no keystroke pays for a recount.
function syncWordCount(tab) {
  if (!tab) {
    clearTimeout(wordTimer);
    wordTimer = null;
    wordShownFor = null;
    setWordLabel('');
    return;
  }
  const cached = wordCache.get(tab.id);
  if (cached && cached.text === tab.text) {
    clearTimeout(wordTimer);
    wordTimer = null;
    wordShownFor = tab.id;
    setWordLabel(cached.label);
  } else if (wordShownFor === tab.id && cached) {
    clearTimeout(wordTimer);
    wordTimer = setTimeout(() => {
      wordTimer = null;
      editor.flush(); // a batched edit may still be pending (big documents)
      clearTimeout(wordTimer); // ... and its render re-armed this timer
      wordTimer = null;
      const now = activeTab();
      if (now && now.id === tab.id) syncWordCountNow(now);
    }, previewDelay(tab));
  } else {
    clearTimeout(wordTimer);
    wordTimer = null;
    syncWordCountNow(tab);
  }
}

function syncWordCountNow(tab) {
  const label = formatCount(countWords(tab.text));
  wordCache.set(tab.id, { text: tab.text, label });
  wordShownFor = tab.id;
  setWordLabel(label);
}

// ---- outline -------------------------------------------------------------

const EMPTY_ENTRY = { id: null, text: null, headings: [], outline: [] };
const outlineCache = new Map(); // tab id -> { id, text, headings, outline } for that text
const collapsedByTab = new Map(); // tab id -> Set of collapsed node indexes
let outlineEntry = EMPTY_ENTRY; // what the panel shows
let outlineLive = false; // the panel is on screen and following the document
let outlineTimer = null;
let outlineCurrent = -1; // heading index of the current section
let outlineScrollQueued = false;
let lastCurrentKey = null;

function collapsedFor(id) {
  let set = collapsedByTab.get(id);
  if (!set) collapsedByTab.set(id, (set = new Set()));
  return set;
}

function computeOutline(tab) {
  const prev = outlineCache.get(tab.id);
  const headings = extractHeadings(tab.text, { math: true });
  // Indexes no longer correspond once the heading count changes.
  if (prev && prev.headings.length !== headings.length) collapsedByTab.delete(tab.id);
  const entry = { id: tab.id, text: tab.text, headings, outline: buildOutline(headings) };
  outlineCache.set(tab.id, entry);
  return entry;
}

function cancelOutlineTimer() {
  clearTimeout(outlineTimer);
  outlineTimer = null;
}

function stopOutline() {
  cancelOutlineTimer();
  outlineLive = false;
}

// Switching tabs (or showing the panel) updates the outline at once; typing
// waits for the same pause as the Split preview.
function syncOutline(tab) {
  const cached = tab ? outlineCache.get(tab.id) : null;
  if (!tab) {
    cancelOutlineTimer();
    setOutlineEntry(EMPTY_ENTRY);
  } else if (cached && cached.text === tab.text) {
    cancelOutlineTimer();
    setOutlineEntry(cached);
  } else if (outlineLive && outlineEntry.id === tab.id) {
    cancelOutlineTimer();
    outlineTimer = setTimeout(() => {
      outlineTimer = null;
      editor.flush(); // a batched edit may still be pending (big documents)
      cancelOutlineTimer(); // ... and its render re-armed this timer
      const now = activeTab();
      if (outlineLive && now && now.id === tab.id) {
        setOutlineEntry(computeOutline(now));
        syncOutlineCurrent(true);
      }
    }, previewDelay(tab));
  } else {
    cancelOutlineTimer();
    setOutlineEntry(computeOutline(tab));
  }
  outlineLive = true;
}

function setOutlineEntry(entry) {
  if (entry === outlineEntry && outlineLive) return;
  outlineEntry = entry;
  lastCurrentKey = null;
  outlineCurrent = -1;
  syncOutlineCurrent(true, { draw: false });
  drawOutline(true);
}

function drawOutline(reveal) {
  renderOutline(outlinePanel, outlineEntry.outline, {
    current: outlineCurrent,
    collapsed: outlineEntry.id ? collapsedFor(outlineEntry.id) : new Set(),
    onJump: jumpToHeading,
    onToggle: (index) => {
      const set = collapsedFor(outlineEntry.id);
      if (set.has(index)) set.delete(index);
      else set.add(index);
      drawOutline(false);
    },
  });
  if (reveal) outlinePanel.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
}

// The heading index the document is at: the cursor's section in Edit, the
// last heading at or above the top of the visible document otherwise.
// Headings are matched to the rendered ones by id, so raw-HTML headings (which
// have no outline entry) and a Split preview that lags behind are harmless.
function computeCurrent() {
  const { headings } = outlineEntry;
  if (!headings.length) return -1;
  if (view === 'edit') return headingIndexForLine(headings, editor.cursorLine());
  const tab = activeTab();
  if (!tab || shown.id !== tab.id || content.hidden) return -1;
  const base = content.getBoundingClientRect().top - content.scrollTop;
  const tops = [];
  const indexes = [];
  headings.forEach((h, i) => {
    const el = document.getElementById(`user-content-${h.id}`);
    if (!el || !doc.contains(el)) return;
    // The heading's scroll-margin is where scrolling to it puts it.
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    tops.push(el.getBoundingClientRect().top - base - margin);
    indexes.push(i);
  });
  const at = currentIndex(tops, content.scrollTop);
  if (at >= 0) return indexes[at];
  // At the very top, before the first heading's margin: the first heading.
  return content.scrollTop < 1 && indexes.length ? indexes[0] : -1;
}

// `force`: a scroll or cursor move. Otherwise (a render) the rendered
// document is only measured when it or the outline changed, so typing in
// Split never forces a layout.
function syncOutlineCurrent(force = false, { draw = true } = {}) {
  if (!outlineLive || sidebarEl.hidden || sidebarTab !== 'outline') return;
  if (!force && view !== 'edit') {
    const key = [state.activeId, view, shown.text, outlineEntry];
    if (lastCurrentKey && key.every((v, i) => v === lastCurrentKey[i])) return;
    lastCurrentKey = key;
  }
  const idx = computeCurrent();
  if (idx === outlineCurrent) return;
  outlineCurrent = idx;
  if (draw) drawOutline(true);
}

function queueOutlineCurrent() {
  if (outlineScrollQueued) return;
  outlineScrollQueued = true;
  requestAnimationFrame(() => {
    outlineScrollQueued = false;
    syncOutlineCurrent(true);
  });
}

content.addEventListener('scroll', queueOutlineCurrent, { passive: true });
window.addEventListener('resize', queueOutlineCurrent);

function onEditorCursor() {
  if (view === 'edit') syncOutlineCurrent(true);
}

function jumpToHeading(node) {
  if (showsDoc(view)) scrollDocToId(node.id);
  if (showsEditor(view)) {
    editor.revealLine(node.line);
    if (view === 'edit') editor.focus();
  }
}

for (const name of SIDEBAR_TABS) {
  sidebarTabEl(name).addEventListener('click', () => showSidebar(name));
}
// Arrow keys move between the tabs (and select them).
$('sidebar').querySelector('.sidebar-tabs').addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  const home = e.key === 'Home' ? 0 : e.key === 'End' ? SIDEBAR_TABS.length - 1 : null;
  if (!step && home === null) return;
  const i = SIDEBAR_TABS.indexOf(sidebarTab);
  const next = SIDEBAR_TABS[home ?? (i + step + SIDEBAR_TABS.length) % SIDEBAR_TABS.length];
  e.preventDefault();
  showSidebar(next);
  sidebarTabEl(next).focus();
});
$('sidebar-open-folder').addEventListener('click', pickFolderAndOpen);

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
  const disk = b.kind === DISK_CHANGED;
  const recovered = b.kind === RECOVERED;
  tabBanner.classList.toggle('banner-info', disk || recovered);
  tabBanner.classList.toggle('banner-error', !disk && !recovered);
  tabBannerActions.hidden = !disk;
  tabBannerRecovered.hidden = !recovered;
  tabBanner.hidden = false;
}

function renderShown(tab) {
  const t0 = performance.now();
  renderDoc(tab);
  shown = { id: tab.id, text: tab.text };
  find.refresh();
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

// The rendered document of a tab as a fragment. Relative <img> sources are
// rewritten before the browser tries to load them; the original src and the
// resolved path are remembered in `localImages` (not as attributes: a document
// could forge those) so Export HTML can embed the file.
const localImages = new WeakMap(); // <img> -> { orig, path }, never in the DOM
function docFragment(tab) {
  const tpl = document.createElement('template');
  tpl.innerHTML = renderMarkdown(tab.text);
  if (tab.path) {
    for (const img of tpl.content.querySelectorAll('img[src]')) {
      const orig = img.getAttribute('src');
      const p = resolveRelative(tab.path, orig);
      if (p) {
        localImages.set(img, { orig, path: p });
        img.setAttribute('src', backend.assetUrl(p));
      }
    }
  }
  return tpl.content;
}

function renderDoc(tab) {
  doc.replaceChildren(docFragment(tab));
  enhanceDoc();
}

// Maths and diagrams, after the text is in place. Rendering them changes what
// find can see, so it re-reads the document once they are drawn.
function enhanceDoc() {
  if (!doc.querySelector('.math-inline, .math-display, pre > code.language-mermaid, .diagram')) return;
  const target = doc;
  drawnTheme = effectiveTheme();
  renderEnhancements(target, { theme: drawnTheme })
    .then(() => find.refresh())
    .catch((err) => console.warn('maths/diagram rendering failed:', err));
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

// Scroll the rendered document (Read, or the Split preview) so the element
// with this id is at the top. `id` is the raw slug; the sanitiser prefixes
// ids with "user-content-". Returns whether it was found.
function scrollDocToId(id) {
  const target = document.getElementById(`user-content-${id}`) || document.getElementById(id);
  if (!target || !doc.contains(target)) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

function scrollToAnchor(href) {
  let hash = href.slice(1);
  try {
    hash = decodeURIComponent(hash);
  } catch {
    // keep as written
  }
  scrollDocToId(hash);
}

doc.addEventListener('click', (e) => {
  // [*|href] also finds SVG anchors (xlink:href), which a[href] misses.
  const link = e.target.closest('a[href], a[*|href]');
  if (!link) return;
  // Never let the webview navigate away from the app.
  e.preventDefault();
  const href = link.getAttribute('href') ?? link.getAttribute('xlink:href') ?? '';
  if (href.startsWith('#')) {
    scrollToAnchor(href);
  } else if (/^(https?|mailto):/i.test(href)) {
    backend.openExternal(href).catch((err) => console.warn('openExternal failed:', err));
  } else {
    const p = resolveRelative(getActiveTab()?.path, href);
    if (p && isMarkdownPath(p)) {
      const hash = href.indexOf('#');
      if (hash >= 0 && hash < href.length - 1) openThen(p, (tab) => scrollToFragment(tab, href.slice(hash + 1)));
      else openPaths([p]);
    }
  }
});
doc.addEventListener('auxclick', (e) => {
  if (e.target.closest('a[href], a[*|href]')) e.preventDefault();
});

// ---- start screen, shortcuts, drag and drop ------------------------------

$('start-open-file').addEventListener('click', pickAndOpen);
$('start-new-file').addEventListener('click', newFile);
$('start-open-folder').addEventListener('click', pickFolderAndOpen);

// WebView2 keeps its browser accelerators in release builds: a reload would
// wipe every tab without a prompt. Swallow them everywhere, editor included.
function isReloadKey(e) {
  if (e.key === 'F5' || e.key === 'BrowserRefresh') return true;
  return e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'r';
}

// Ctrl+F: open the find bar, prefilled with a single-line selection that lies
// inside the document.
function openFind() {
  const sel = window.getSelection();
  let query;
  if (sel && !sel.isCollapsed && doc.contains(sel.anchorNode) && doc.contains(sel.focusNode)) {
    const text = sel.toString();
    if (text.trim() && !/[\r\n]/.test(text)) query = text;
  }
  find.open(query);
}

// Ctrl+Shift+F: the Search tab, with the query box ready to type in.
function focusSearch() {
  showSidebar('search');
  const input = searchPanel.querySelector('.search-input');
  if (input && !sidebarEl.hidden) {
    input.focus();
    input.select();
  } else if (!sidebarEl.hidden) {
    sidebarTabEl('search').focus();
  }
}

function openQuickOpenPalette() {
  const files = folder
    ? flattenTree(folder.root)
    : recent.files.map((path) => ({ path, rel: dirname(path), name: basename(path) }));
  openQuickOpen({ files, recentPaths: recent.files, onPick: (path) => openPaths([path]) });
}

// Capture phase, so the shortcuts also work (and win) inside the editor.
window.addEventListener('keydown', (e) => {
  if (isReloadKey(e)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (find.isOpen() && !modalOpen) {
    if (e.key === 'F3' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      // Also keeps the WebView's own find from opening.
      e.preventDefault();
      e.stopPropagation();
      find.step(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Escape') {
      // Only from the bar or the document pane. With focus in the editor Esc
      // belongs to CodeMirror (tooltips, search panel, cursors).
      const a = document.activeElement;
      const here = !a || a === document.body || $('find').contains(a) || content.contains(a);
      if (here && !editorEl.contains(a)) {
        e.preventDefault();
        e.stopPropagation();
        find.close();
        return;
      }
    }
  }
  if (!e.ctrlKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  // AltGr arrives as Ctrl+Alt on Windows, and some layouts (German, French,
  // ...) need AltGr to type "\": allow Alt only for that character.
  if (e.altKey && key !== '\\') return;
  const plain = !e.shiftKey;
  let action;
  // Ctrl+Shift+= is Ctrl++; Shift is ignored by the code matches otherwise,
  // so Ctrl+Shift+0 / Ctrl+Shift+- don't zoom. Alt: AltGr can put "\\" on a
  // Minus code.
  const zoomDir = e.altKey ? null
    : key === '=' || key === '+' || e.code === 'Equal' || (plain && e.code === 'NumpadAdd') ? 1
    : plain && (key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') ? -1
    : plain && (key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') ? 0
    : null;
  if (zoomDir !== null) {
    action = () => zoomBy(zoomDir);
  } else if (key === 'o') {
    action = plain ? pickAndOpen : pickFolderAndOpen;
  } else if (key === 'b' && e.shiftKey) {
    action = toggleSidebar;
  } else if (key === 'f' && e.shiftKey) {
    action = focusSearch;
  } else if (key === 'l' && e.shiftKey) {
    action = () => showSidebar('outline', { focus: true });
  } else if (key === 'p' && plain) {
    // Also swallows the WebView's own print dialog.
    action = openQuickOpenPalette;
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
  } else if (key === 'f' && plain && state.activeId && !editorEl.contains(document.activeElement)) {
    // Read, or Split with focus outside the editor: the find bar. Otherwise
    // CodeMirror handles Ctrl+F itself when it has focus.
    if (showsDoc(view)) {
      action = openFind;
    } else if (showsEditor(view)) {
      action = () => {
        editor.focus();
        editor.openSearch();
      };
    }
  }
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  if (modalOpen) return; // the modal is answered first
  closeMenu(); // any app shortcut closes an open ⋯ menu
  // Every app shortcut sees the latest typed text. (Not done for plain typing
  // keys: that would turn a big document into a string on every keystroke.)
  editor.flush();
  action();
}, true);

// The native context menu offers Reload (and Back): only editable areas
// (the editor's text, inputs) keep theirs, for cut/copy/paste.
window.addEventListener('contextmenu', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (t && t.closest('.cm-content, input, textarea, [contenteditable="true"]')) return;
  e.preventDefault();
}, true);

// Tauri delivers dropped files as real paths (backend.onDragDrop); the
// browser's own drop must never navigate the page away.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---- startup -------------------------------------------------------------

async function startup() {
  await settings.load();
  syncAppearance();
  // Stored sidebar state: hidden stays hidden; shown means "while a folder is open".
  const sb = settings.get().sidebar;
  sidebarTab = sb.tab;
  if (sb.visible !== null) {
    sidebarWanted = sb.visible;
    sidebarChosen = true;
  }
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
  // Recovered drafts open before anything else: queue them now (ahead of any
  // open-paths event), let them start once the listeners below exist.
  let listenersReady;
  const restoring = restoreDrafts(new Promise((r) => { listenersReady = r; }));
  // The session comes next in the queue: drafts, session, then everything else.
  const restoringSession = restoreSession();
  try {
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
  } finally {
    listenersReady(); // even if a subscription failed: never leave the queue waiting
  }
  await restoring;
  await restoringSession;
  await openPaths(await backend.launchPaths(), { folders: true });
}

startup().catch((err) => console.error('Folio failed to start:', err));

// ---- export and print ------------------------------------------------------

// A detached, fully drawn copy of a tab's document (maths and diagrams done),
// independent of what is on screen: Edit mode doesn't render the document at
// all, and the live one may be mid-enhancement. Diagrams use `theme`.
async function drawnCopy(tab, theme) {
  const el = document.createElement('article');
  el.className = 'markdown';
  el.append(docFragment(tab));
  try {
    await renderEnhancements(el, { theme, isolated: true });
  } catch (err) {
    console.warn('maths/diagram rendering failed:', err);
  }
  return el;
}

const fetchOk = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r;
};
async function fetchBase64(url) {
  const bytes = new Uint8Array(await (await fetchOk(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function exportHtml() {
  const tab = getActiveTab();
  if (!tab) return;
  const stem = tab.title.replace(/\.[^./\\]+$/, '') || 'document';
  let path;
  try {
    path = await backend.pickExportPath(`${stem}.html`);
  } catch (err) {
    console.warn('pickExportPath failed:', err);
    return;
  }
  if (!path) return;
  const name = basename(path);
  try {
    const theme = effectiveTheme();
    const el = await drawnCopy(tab, theme);
    const images = await collectImages(el, backend.readImageBase64, (img) => localImages.get(img));
    const css = await collectCss(el, {
      fetchText: async (url) => (await fetchOk(url)).text(),
      fetchBase64,
    });
    const h1 = el.querySelector('h1')?.cloneNode(true);
    h1?.querySelectorAll('.katex-mathml').forEach((n) => n.remove()); // the visible maths text is enough
    const title = h1?.textContent.trim() || stem;
    const html = buildExportHtml({ title, bodyHtml: el.innerHTML, css, theme, images });
    await backend.writeFile(path, html, 'lf', false);
    showBanner(`Exported ${name}.`, 'info');
  } catch (err) {
    showBanner(`Couldn't export ${name}: ${errorText(err)}`);
  }
}

// Print always prints the rendered document, light, whatever the view: it is
// drawn into #print-area (hidden on screen, the only thing shown by
// @media print), so Edit mode and the theme don't matter.
const printArea = $('print-area');
let printing = false;
async function printDoc() {
  const tab = getActiveTab();
  if (!tab || printing) return;
  printing = true;
  const done = () => {
    document.body.classList.remove('printing');
    printArea.replaceChildren();
  };
  try {
    const el = await drawnCopy(tab, 'light');
    printArea.replaceChildren(el);
    // Pictures load lazily from the asset protocol; wait (briefly) for them.
    await Promise.race([
      Promise.all([...el.querySelectorAll('img')].map((img) => img.decode().catch(() => {}))),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
    document.body.classList.add('printing');
    window.addEventListener('afterprint', done, { once: true });
    try {
      window.print();
    } catch (err) {
      window.removeEventListener('afterprint', done);
      throw err;
    }
  } catch (err) {
    done();
    showBanner(`Couldn't print: ${errorText(err)}`);
  } finally {
    printing = false; // only the preparation is guarded; the dialog may stay open
  }
}
