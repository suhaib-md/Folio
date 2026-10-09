// Session restore, pure parts: what to store, and what to open at launch.
import { normalizePath } from './tabs.js';

// state: the tab-list state. Untitled tabs are not stored (drafts cover them).
// `active` is the active tab's path, null when the active tab is untitled.
export function captureSession(state, folder) {
  const tabs = [];
  const seen = new Set();
  for (const t of state.tabs) {
    if (t.path == null) continue;
    const key = normalizePath(t.path);
    if (seen.has(key)) continue;
    seen.add(key);
    tabs.push({ path: t.path, mode: t.mode });
  }
  const act = state.tabs.find((t) => t.id === state.activeId);
  return { tabs, active: act?.path ?? null, folder: folder ?? null };
}

// drafts: paths of the draft tabs (already restored); session: stored
// settings.session. Launch paths are not handled here: they go through
// openPaths on the open queue, after the restore, and become active as any
// opened file does.
// -> open: drafts, then the session tabs they don't cover, each path once;
// activate: the stored active tab, else the last restored tab; null when the
// stored active tab was an untitled one (the draft-restored tab stays active).
// No file is checked here.
export function startupOrder({ drafts = [], session = null } = {}) {
  const open = [];
  const seen = new Set();
  const add = (entry) => {
    const key = normalizePath(entry.path);
    if (seen.has(key)) return;
    seen.add(key);
    open.push(entry);
  };
  for (const path of drafts) if (path != null) add({ path });
  for (const t of session?.tabs ?? []) add(t.mode ? { path: t.path, mode: t.mode } : { path: t.path });
  let activate = null;
  if (session?.active != null) {
    activate = open.find((o) => normalizePath(o.path) === normalizePath(session.active))?.path ?? null;
  }
  if (activate == null && session?.active != null && open.length) activate = open[open.length - 1].path;
  return { open, activate, folder: session?.folder ?? null };
}

// Entries the restore skipped (missing right now) stay in the stored session
// until the user changes the tab set or the folder. skipped: { tabs, folder }.
export function mergeSkipped(session, skipped) {
  if (!skipped) return session;
  const have = new Set(session.tabs.map((t) => normalizePath(t.path)));
  const tabs = [...session.tabs, ...skipped.tabs.filter((t) => !have.has(normalizePath(t.path)))];
  return { ...session, tabs, folder: session.folder ?? skipped.folder ?? null };
}

// The part of a session the user changes by opening/closing tabs or folders.
export const sessionShape = (s) => JSON.stringify([s.tabs.map((t) => normalizePath(t.path)).sort(), s.folder]);
