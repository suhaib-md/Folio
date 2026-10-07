// Pure tab-list model. No DOM; every function returns new state.

export function normalizePath(p) {
  return String(p).replace(/\\/g, '/').replace(/\/{2,}/g, '/').toLowerCase();
}

function basename(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || String(p);
}

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
    eol, bom, mode: 'read', scrollTop: 0, banner: null,
  };
  return { ...state, tabs: [...state.tabs, tab], activeId: id, nextId: state.nextId + 1 };
}

export function newUntitled(state) {
  const n = state.untitledCounter + 1;
  const id = `t${state.nextId}`;
  const tab = {
    id, path: null, title: `Untitled-${n}`, text: '', savedText: '',
    eol: 'lf', bom: false, mode: 'edit', scrollTop: 0, banner: null,
  };
  return {
    ...state, tabs: [...state.tabs, tab], activeId: id,
    untitledCounter: n, nextId: state.nextId + 1,
  };
}

function update(state, id, fn) {
  if (!state.tabs.some((t) => t.id === id)) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...fn(t) } : t)) };
}

export const setText = (state, id, text) => update(state, id, () => ({ text }));
export const setMode = (state, id, mode) => update(state, id, () => ({ mode }));
export const setBanner = (state, id, banner) => update(state, id, () => ({ banner }));
export const clearSaved = (state, id) => update(state, id, () => ({ savedText: null }));

export function markSaved(state, id, { path, text }) {
  return update(state, id, () =>
    path != null ? { savedText: text, path, title: basename(path) } : { savedText: text });
}

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
