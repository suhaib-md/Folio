// Crash-recovery drafts: when to write a dirty tab's text to disk, and how
// to turn the drafts found at launch into tabs. No DOM, no backend import:
// the caller injects save/remove/timers, so the timing is testable.
import { isDirty } from './tabs.js';
import { basename } from './paths.js';

export const DEBOUNCE_MS = 2000; // quiet time after typing before a write
export const MAX_WAIT_MS = 10000; // longest an unsaved change waits while typing continues

function buildDraft(tab, savedAt) {
  return {
    id: tab.draftId,
    path: tab.path ?? null,
    title: tab.title,
    text: tab.text,
    eol: tab.eol,
    bom: !!tab.bom,
    // Untitled tabs have no file to compare against.
    baseText: tab.path != null && typeof tab.savedText === 'string' ? tab.savedText : null,
    savedAt,
  };
}

// getTab(tabId) must return the tab as it is NOW (the app flushes pending
// editor text first), so a write at timer time holds the latest text.
export function createDraftScheduler({
  getTab, save, remove,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  debounce = DEBOUNCE_MS,
  maxWait = MAX_WAIT_MS,
}) {
  const tabs = new Map(); // tab id -> per-tab state
  let disposed = false;

  const stateOf = (id) => {
    let s = tabs.get(id);
    if (!s) {
      s = { timer: null, firstAt: null, gen: 0, inFlight: null, flushing: false, again: false, draftId: null, removes: new Set() };
      tabs.set(id, s);
    }
    return s;
  };

  const disarm = (s) => {
    if (s.timer != null) clearTimer(s.timer);
    s.timer = null;
  };

  const arm = (id, s, delay) => {
    disarm(s);
    s.timer = setTimer(() => {
      s.timer = null;
      flush(id);
    }, delay);
  };

  // A remove that never throws; tracked so a later write waits for it.
  const doRemove = (s, draftId) => {
    let p;
    try {
      p = Promise.resolve(remove(draftId));
    } catch (err) {
      p = Promise.reject(err);
    }
    const tracked = p.catch((err) => console.warn('removing draft failed:', err)).then(() => {
      s.removes.delete(tracked);
    });
    s.removes.add(tracked);
    return tracked;
  };

  function flush(id) {
    const s = tabs.get(id);
    if (!s || disposed) return;
    disarm(s);
    // Writes for one tab never overlap: run again when this one is done.
    if (s.inFlight) {
      s.again = true;
      return;
    }
    if (s.removes.size) {
      // A remove is still on its way: write after it, not before.
      s.inFlight = Promise.allSettled([...s.removes]).then(() => {
        s.inFlight = null;
        s.again = false;
        flush(id);
      });
      return;
    }
    // getTab flushes the editor, which can call changed() again (render ->
    // sync). That call only records; this write takes the latest text.
    s.flushing = true;
    let tab;
    try {
      tab = getTab(id);
    } finally {
      s.flushing = false;
    }
    disarm(s);
    if (!tab || !tab.draftId) return;
    s.draftId = tab.draftId;
    if (!isDirty(tab)) {
      s.firstAt = null;
      return;
    }
    const gen = s.gen;
    const firstAt = s.firstAt;
    s.firstAt = null; // changes from here on start a new interval
    const draft = buildDraft(tab, now());
    let p;
    try {
      p = Promise.resolve(save(draft));
    } catch (err) {
      p = Promise.reject(err);
    }
    s.inFlight = p
      .then(() => true, (err) => {
        console.warn('saving draft failed:', err);
        return false;
      })
      .then(async (ok) => {
        if (s.gen !== gen) {
          // The tab became clean (or closed) while we wrote: the file we
          // just wrote must not outlive that.
          await doRemove(s, draft.id);
        } else if (!ok) {
          // Keep the interval's start and try again later.
          s.firstAt = s.firstAt ?? firstAt ?? now();
          const soon = s.again;
          s.again = false;
          if (!disposed) arm(id, s, soon ? debounce : maxWait);
        }
        s.inFlight = null;
        if (s.again) {
          s.again = false;
          flush(id);
        }
      });
  }

  return {
    // The tab's text changed and it is dirty.
    changed(tab) {
      if (disposed) return;
      const s = stateOf(tab.id);
      s.draftId = tab.draftId;
      const t = now();
      if (s.firstAt == null) s.firstAt = t;
      if (s.flushing) return; // the running flush reads the latest text
      const waited = t - s.firstAt;
      if (waited >= maxWait) flush(tab.id);
      else arm(tab.id, s, Math.min(debounce, maxWait - waited));
    },
    // The tab is clean or gone: no draft may remain, now or after a write
    // that is already running.
    clean(tabId, draftId) {
      const s = stateOf(tabId);
      if (draftId != null) s.draftId = draftId;
      disarm(s);
      s.gen += 1;
      s.firstAt = null;
      s.again = false;
      if (s.draftId != null) doRemove(s, s.draftId);
      // (An in-flight write sees the new generation and removes again.)
    },
    // Resolves when no write or remove is running.
    async settled() {
      for (;;) {
        const all = [];
        for (const s of tabs.values()) {
          if (s.inFlight) all.push(s.inFlight);
          all.push(...s.removes);
        }
        if (!all.length) return;
        await Promise.allSettled(all);
      }
    },
    dispose() {
      disposed = true;
      for (const s of tabs.values()) disarm(s);
    },
  };
}

// Drafts found at launch -> what to restore, oldest first. diskChanged: the
// file on disk no longer holds the text the draft was based on.
// diskTexts: path -> current text (LF), or null when it can't be read.
export function restorePlan(drafts, diskTexts) {
  return [...drafts]
    .sort((a, b) => (a.savedAt - b.savedAt) || String(a.id).localeCompare(String(b.id)))
    .map((draft) => {
      const disk = draft.path != null ? diskTexts.get(draft.path) : null;
      return { draft, diskChanged: typeof disk === 'string' && disk !== draft.baseText };
    });
}

// What startup does with one draft. `file`: the draft's file as read now
// (null: not readable, or untitled). `ctx`: { diskChanged, pathOpen (is a tab
// already open for this path), titles (titles of the open tabs) }.
// -> { action: 'delete' }                      nothing to recover
//  | { action: 'open', path, title, savedText, bannerText }
export function restoreDecision(draft, file, { diskChanged = false, pathOpen = false, titles = [] } = {}) {
  // The file already holds exactly this text.
  if (draft.path != null && file && file.text === draft.text) return { action: 'delete' };
  let path = draft.path;
  let title = draft.title;
  // Untitled: nothing to compare with. Unreadable file: null keeps it dirty.
  let savedText = path == null ? '' : file ? file.text : null;
  if (path != null && pathOpen) {
    // A second draft for one file: keep its text as a separate untitled tab.
    const base = `${basename(path)} (recovered`;
    const taken = new Set(titles);
    title = `${base})`;
    for (let n = 2; taken.has(title); n++) title = `${base} ${n})`;
    path = null;
    savedText = '';
  }
  const name = basename(draft.path ?? draft.title);
  const bannerText = diskChanged
    ? `Recovered unsaved changes. ${name} also changed on disk.`
    : 'Recovered unsaved changes.';
  return { action: 'open', path, title, savedText, bannerText };
}
