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
// settings.session; launch: paths from the command line / a second launch.
// -> open: in this order (drafts, session tabs, launch paths), each path once;
// activate: the last launch path, else the stored active tab, else the last
// restored tab. No file is checked here.
export function startupOrder({ drafts = [], session = null, launch = [] } = {}) {
  const open = [];
  const seen = new Set();
  const add = (entry) => {
    const key = normalizePath(entry.path);
    if (seen.has(key)) return false;
    seen.add(key);
    open.push(entry);
    return true;
  };
  for (const path of drafts) if (path != null) add({ path });
  for (const t of session?.tabs ?? []) add(t.mode ? { path: t.path, mode: t.mode } : { path: t.path });
  for (const path of launch) add({ path });
  const find = (p) => open.find((o) => normalizePath(o.path) === normalizePath(p))?.path;
  let activate = null;
  if (launch.length) activate = find(launch[launch.length - 1]);
  else if (session?.active != null) activate = find(session.active) ?? null;
  if (activate == null && open.length) activate = open[open.length - 1].path;
  return { open, activate: activate ?? null, folder: session?.folder ?? null };
}
