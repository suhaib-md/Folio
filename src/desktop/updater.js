// Auto-update flow. Pure of the DOM and of Tauri: everything it touches comes
// in through createUpdater's arguments, so tests drive it with fakes.
//
//   backend.checkUpdate()  -> { version, install(onProgress) } | null
//                             (onProgress gets a 0..1 fraction, or null when
//                             the size is unknown)
//   backend.relaunch()
//   appInfo                -> { updaterConfigured } (value, or function
//                             returning it / a promise of it)
//   runCloseFlow()         -> true to go on, false when the user cancelled
//   showBanner(text, { actions: [{ label, onSelect }] }) / hideBanner()
//   notify(text, kind)     -> a plain message ('info' | 'error')
//   setTimer(fn, ms)

export const STARTUP_DELAY_MS = 10000;

const reason = (err) => (err && err.message) || String(err);

export function createUpdater({ backend, appInfo, runCloseFlow, showBanner, hideBanner, notify, setTimer = setTimeout }) {
  let scheduled = false;
  let installing = false;

  async function configured() {
    try {
      const info = typeof appInfo === 'function' ? await appInfo() : appInfo;
      return !!info?.updaterConfigured;
    } catch {
      return false;
    }
  }

  async function install(update) {
    if (installing) return;
    installing = true;
    try {
      // Same prompts as closing the window; Cancel keeps everything as it is.
      if (!(await runCloseFlow())) return;
      showBanner('Downloading…', { actions: [] });
      await update.install((fraction) => {
        const pct = typeof fraction === 'number' ? Math.round(Math.min(Math.max(fraction, 0), 1) * 100) : null;
        showBanner(pct === null ? 'Downloading…' : `Downloading… ${pct}%`, { actions: [] });
      });
      await backend.relaunch();
    } catch (err) {
      notify(`Couldn't install the update: ${reason(err)}`, 'error');
    } finally {
      installing = false;
    }
  }

  function offer(update) {
    showBanner(`Folio ${update.version} is available.`, {
      actions: [
        { label: 'Install and restart', primary: true, onSelect: () => install(update) },
        { label: 'Later', onSelect: () => hideBanner() },
      ],
    });
  }

  function scheduleStartupCheck() {
    if (scheduled) return;
    scheduled = true;
    setTimer(async () => {
      if (!(await configured())) return;
      try {
        const update = await backend.checkUpdate();
        if (update) offer(update);
      } catch {
        // silent: no network is not worth a message at startup
      }
    }, STARTUP_DELAY_MS);
  }

  async function checkNow() {
    if (!(await configured())) {
      notify('Updates not configured', 'info');
      return;
    }
    let update;
    try {
      update = await backend.checkUpdate();
    } catch (err) {
      notify(`Couldn't check for updates: ${reason(err)}`, 'error');
      return;
    }
    if (update) offer(update);
    else notify('Folio is up to date.', 'info');
  }

  return { scheduleStartupCheck, checkNow };
}
