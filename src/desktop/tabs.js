// Pure tab-list model. No DOM; every function returns new state.

export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
}

function basename(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || String(p);
}

// Tab ids (t1, t2, ...) restart every launch, so a draft's id adds a
// per-launch nonce: base36 time + 4 random chars (all in [A-Za-z0-9_-]).
export const launchNonce =
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6).padEnd(4, '0');

export function createState() {
  return { tabs: [], activeId: null, untitledCounter: 0, nextId: 1 };
}

export function isDirty(tab) {
  return tab.text !== tab.savedText;
}

export function findByPath(state, path) {
  if (path == null) return undefined;
  const n = normalizePath(path);
  return state.tabs.find((t) => t.path != null && normalizePath(t.path) === n);
}

export function openFile(state, { path, text, eol, bom }) {
  const existing = findByPath(state, path);
  if (existing) return { ...state, activeId: existing.id };
  const id = `t${state.nextId}`;
  const tab = {
    id, path, title: basename(path), text, savedText: text,
    eol, bom, mode: 'read', scrollTop: 0, banner: null, draftId: `${launchNonce}-${id}`,
  };
  return { ...state, tabs: [...state.tabs, tab], activeId: id, nextId: state.nextId + 1 };
}

export function newUntitled(state) {
  const n = state.untitledCounter + 1;
  const id = `t${state.nextId}`;
  const tab = {
    id, path: null, title: `Untitled-${n}`, text: '', savedText: '',
    eol: 'lf', bom: false, mode: 'edit', scrollTop: 0, banner: null, draftId: `${launchNonce}-${id}`,
  };
  return {
    ...state, tabs: [...state.tabs, tab], activeId: id,
    untitledCounter: n, nextId: state.nextId + 1,
  };
}

// A tab rebuilt from a crash-recovery draft. It keeps the draft's id, so
// another crash overwrites the same draft. `savedText` is the file's text on
// disk now (null: unreadable; the tab then stays dirty). Opens in Edit.
// Untitled tabs keep their title and keep the counter ahead of it.
export function openRecovered(state, { draftId, path, title, text, savedText, eol, bom, banner }) {
  const id = `t${state.nextId}`;
  const tab = {
    id, path, title: path != null ? basename(path) : title, text, savedText,
    eol, bom, mode: 'edit', scrollTop: 0, banner, draftId,
  };
  const m = path == null ? /^Untitled-(\d+)$/.exec(title) : null;
  return {
    ...state, tabs: [...state.tabs, tab], activeId: id, nextId: state.nextId + 1,
    untitledCounter: m ? Math.max(state.untitledCounter, Number(m[1])) : state.untitledCounter,
  };
}

function update(state, id, fn) {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)) };
}

export const setText = (state, id, text) => update(state, id, () => ({ text }));
export const MODES = ['read', 'edit', 'split'];
export const setMode = (state, id, mode) =>
  (MODES.includes(mode) ? update(state, id, () => ({ mode })) : state);
export const setBanner = (state, id, banner) => update(state, id, () => ({ banner }));
// Set by a failed autosave, cleared by the next successful save.
export const setAutosavePaused = (state, id, paused) =>
  update(state, id, () => ({ autosavePaused: !!paused }));
// A save reached the disk: `text` is now the file (and `path` the file, for
// Save As). Save errors and disk banners are moot, and autosave may resume.
export function saveSucceeded(state, id, { path, text }) {
  let next = markSaved(state, id, path != null ? { path, text } : { text });
  const tab = next.tabs.find((t) => t.id === id);
  if (tab?.banner) next = setBanner(next, id, null);
  return setAutosavePaused(next, id, false);
}
export const clearSaved = (state, id) => update(state, id, () => ({ savedText: null }));

export function markSaved(state, id, { path, text }) {
  return update(state, id, () =>
    path != null ? { savedText: text, path, title: basename(path) } : { savedText: text });
}

// The file was (re)read from disk: it becomes the tab's text and saved text.
export const loadFromDisk = (state, id, { text, eol, bom }) =>
  update(state, id, () => ({ text, savedText: text, eol, bom }));

export function activate(state, id) {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { ...state, activeId: id };
}

export function closeTab(state, id) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  let activeId = state.activeId;
  if (activeId === id) {
    const next = tabs[i] || tabs[i - 1];
    activeId = next ? next.id : null;
  }
  return { ...state, tabs, activeId };
}

export function cycle(state, dir) {
  const n = state.tabs.length;
  if (n === 0) return state;
  const i = state.tabs.findIndex((t) => t.id === state.activeId);
  const j = ((i < 0 ? 0 : i + dir) % n + n) % n;
  return { ...state, activeId: state.tabs[j].id };
}

export function windowTitle(state) {
  const tab = state.tabs.find((t) => t.id === state.activeId);
  if (!tab) return 'Folio';
  return `${isDirty(tab) ? '● ' : ''}${tab.title} — Folio`;
}
