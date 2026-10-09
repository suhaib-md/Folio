// Opt-in autosave: a dirty tab with a path is saved AUTOSAVE_MS after its
// text last changed. Like the draft scheduler it is driven by reconciling:
// the app calls sync(tabs, enabled) after every render and this decides which
// tabs have a timer. No DOM, no backend import; timers and the save are
// injected so the timing is testable.
import { isDirty } from './tabs.js';

export const AUTOSAVE_MS = 1000;

// Banners that are not a pending decision: a save error (autosavePaused
// covers it) and a failed image paste. Any other banner (changed on disk,
// removed, recovered draft) waits for the user's answer first.
const HARMLESS_BANNERS = ['save-error', 'paste-error'];

// savedText null: the file is gone (or unreadable), saving would recreate it.
export const eligible = (tab) =>
  tab.path != null && isDirty(tab) && !tab.autosavePaused &&
  typeof tab.savedText === 'string' &&
  (!tab.banner || HARMLESS_BANNERS.includes(tab.banner.kind));

// getTab(id) -> the tab as it is NOW (flushed), or null.
// save(id) -> Promise; the app's normal save, plus pausing the tab on failure.
// blocked() -> true while something modal is open: the timer is rescheduled.
export function createAutosave({
  getTab, save, blocked = () => false, delay = AUTOSAVE_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
}) {
  const timers = new Map(); // tab id -> { handle, text }

  const cancel = (id) => {
    const t = timers.get(id);
    if (!t) return;
    clearTimer(t.handle);
    timers.delete(id);
  };

  function arm(id, text) {
    cancel(id);
    const handle = setTimer(() => fire(id), delay);
    timers.set(id, { handle, text });
  }

  function fire(id) {
    const t = timers.get(id);
    timers.delete(id);
    if (!t) return;
    const tab = getTab(id);
    if (!tab || !eligible(tab)) return;
    if (blocked()) {
      arm(id, tab.text);
      return;
    }
    // Resolves whatever happens; the app's save() commits, which syncs again
    // (a tab typed into meanwhile is still dirty and gets a fresh timer).
    Promise.resolve(save(id)).catch(() => {});
  }

  return {
    sync(tabs, enabled) {
      const present = new Set();
      for (const tab of tabs) {
        present.add(tab.id);
        if (!enabled || !eligible(tab)) {
          cancel(tab.id);
        } else {
          const t = timers.get(tab.id);
          if (!t || t.text !== tab.text) arm(tab.id, tab.text);
        }
      }
      for (const id of [...timers.keys()]) if (!present.has(id)) cancel(id);
    },
    cancelAll() {
      for (const id of [...timers.keys()]) cancel(id);
    },
    pending: () => timers.size,
  };
}
