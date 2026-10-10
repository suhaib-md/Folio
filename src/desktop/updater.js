// Auto-update flow. Pure of the DOM and of Tauri: everything it touches comes
// in through createUpdater's arguments, so tests drive it with fakes.
//
//   backend.checkUpdate()  -> { version, download(onProgress), install() } | null
//                             (onProgress gets a 0..1 fraction, or null when
//                             the size is unknown)
//   backend.relaunch()
//   appInfo                -> { updaterConfigured } (value, or function
//                             returning it / a promise of it)
//   runCloseFlow()         -> true to go on, false when the user cancelled
//   abortExit()            undo what a successful runCloseFlow froze (the
//                             session, autosave) when the update then fails
//   busyReason()           optional: a message when an install cannot start
//                             now (e.g. a dialog is open), else null
//   showBanner(text, { actions: [{ label, primary, onSelect }] }) / hideBanner()
//   notify(text, kind)     -> a plain message ('info' | 'error')
//   setTimer(fn, ms)
//
// Install order: download, then the close prompts, then install and relaunch,
// so a failed download never costs the user a prompt.

export const STARTUP_DELAY_MS = 10000;

const reason = (err) => (err && err.message) || String(err);

export function createUpdater({
  backend,
  appInfo,
  runCloseFlow,
  abortExit = () => {},
  busyReason = () => null,
  showBanner,
  hideBanner,
  notify,
  setTimer = setTimeout,
}) {
  let scheduled = false;
  let installing = false;
  let pending = null; // the offered update, until Later or an install
  let downloaded = null; // the update whose package is already downloaded

  async function configured() {
    try {
      const info = typeof appInfo === 'function' ? await appInfo() : appInfo;
      return !!info?.updaterConfigured;
    } catch {
      return false;
    }
  }

  const progress = (text) => showBanner(text, { actions: [] });

  async function install(update) {
    if (installing) return;
    const busy = busyReason();
    if (busy) {
      notify(busy, 'info');
      return;
    }
    installing = true;
    let exitPrepared = false;
    try {
      if (downloaded !== update) {
        progress('Downloading…');
        await update.download((fraction) => {
          const pct = typeof fraction === 'number' ? Math.round(Math.min(Math.max(fraction, 0), 1) * 100) : null;
          progress(pct === null ? 'Downloading…' : `Downloading… ${pct}%`);
        });
        downloaded = update;
      }
      // Same prompts as closing the window; Cancel keeps everything as it is.
      if (!(await runCloseFlow())) {
        offer(update);
        return;
      }
      exitPrepared = true;
      await update.install();
      await backend.relaunch();
    } catch (err) {
      if (exitPrepared) abortExit();
      notify(`Couldn't install the update: ${reason(err)}`, 'error');
    } finally {
      installing = false;
    }
  }

  function offer(update) {
    pending = update;
    showBanner(`Folio ${update.version} is ready`, {
      actions: [
        { label: 'Install and restart', primary: true, onSelect: () => install(update) },
        {
          label: 'Later',
          onSelect: () => {
            pending = null;
            hideBanner();
          },
        },
      ],
    });
  }

  // The app banner was dismissed (some other message): bring the offer back.
  function bannerDismissed() {
    if (pending && !installing) offer(pending);
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

  return { scheduleStartupCheck, checkNow, bannerDismissed };
}
