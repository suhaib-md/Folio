// App settings: the shape, normalizing whatever was stored, and a small
// store that notifies listeners at once and saves (debounced) to the backend.
export const SAVE_DELAY = 300;
export const ZOOM_MIN = 70;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
// One zoom step: dir 1 up, -1 down, 0 reset. Always lands on the 10% grid
// inside ZOOM_MIN..ZOOM_MAX.
export function zoomStep(zoom, dir) {
  if (dir === 0) return DEFAULTS.zoom;
  const z = Number.isFinite(zoom) ? Math.round(zoom / ZOOM_STEP) * ZOOM_STEP : DEFAULTS.zoom;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z + dir * ZOOM_STEP));
}
const THEMES = ['system', 'light', 'dark'];
const SIDEBAR_TABS = ['files', 'outline', 'search'];
const MODES = ['read', 'edit', 'split'];

export const DEFAULTS = Object.freeze({
  zoom: 100,
  theme: 'system',
  autosave: false,
  sidebar: Object.freeze({ visible: true, tab: 'files' }),
  session: Object.freeze({ tabs: Object.freeze([]), active: null, folder: null }),
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);

// Always returns a fresh, valid Settings; unknown fields are dropped.
export function normalize(raw) {
  const r = isObj(raw) ? raw : {};
  const z = Number(r.zoom);
  const zoom = Number.isFinite(z)
    ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z / ZOOM_STEP) * ZOOM_STEP))
    : DEFAULTS.zoom;
  const sb = isObj(r.sidebar) ? r.sidebar : {};
  const se = isObj(r.session) ? r.session : {};
  const tabs = [];
  if (Array.isArray(se.tabs)) {
    for (const t of se.tabs) {
      const path = isObj(t) ? str(t.path) : null;
      if (path) tabs.push({ path, mode: MODES.includes(t.mode) ? t.mode : 'read' });
    }
  }
  return {
    zoom,
    theme: THEMES.includes(r.theme) ? r.theme : DEFAULTS.theme,
    autosave: r.autosave === undefined ? DEFAULTS.autosave : r.autosave === true || r.autosave === 'true',
    sidebar: {
      visible: sb.visible === undefined ? DEFAULTS.sidebar.visible : sb.visible !== false && sb.visible !== 'false',
      tab: SIDEBAR_TABS.includes(sb.tab) ? sb.tab : DEFAULTS.sidebar.tab,
    },
    session: { tabs, active: str(se.active), folder: str(se.folder) },
  };
}

// backend: { settingsGet() -> raw, settingsSet(settings) }.
// load() once at startup (before the first render that needs a setting);
// get() is synchronous after that.
export function createSettings(backend, {
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
} = {}) {
  let current = normalize(null);
  const listeners = new Set();
  let timer = null;
  let dirty = false;
  let inFlight = Promise.resolve();

  const write = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    if (!dirty) return inFlight;
    dirty = false;
    const snapshot = current;
    inFlight = inFlight
      .then(() => backend.settingsSet(snapshot))
      .catch((err) => console.warn('saving settings failed:', err));
    return inFlight;
  };

  return {
    async load() {
      try {
        current = normalize(await backend.settingsGet());
      } catch (err) {
        console.warn('loading settings failed:', err);
        current = normalize(null);
      }
      return current;
    },
    get: () => current,
    // patch: any subset; sidebar and session merge one level deep.
    update(patch) {
      const merged = { ...current, ...patch };
      if (isObj(patch?.sidebar)) merged.sidebar = { ...current.sidebar, ...patch.sidebar };
      if (isObj(patch?.session)) merged.session = { ...current.session, ...patch.session };
      const next = normalize(merged);
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      current = next;
      for (const cb of [...listeners]) {
        try {
          cb(current);
        } catch (err) {
          console.error('settings listener failed:', err);
        }
      }
      dirty = true;
      if (timer != null) clearTimer(timer);
      timer = setTimer(write, SAVE_DELAY);
      return current;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    // Write any pending change now (window close). Resolves when written.
    flush: write,
  };
}
