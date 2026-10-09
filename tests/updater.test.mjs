import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdater } from '../src/desktop/updater.js';

// A harness with a manual timer queue and recorded UI calls.
function setup({ configured = true, update = null, checkError = null, closeOk = true, installError = null } = {}) {
  const timers = [];
  const log = [];
  const banners = [];
  const notes = [];
  const backend = {
    checks: 0,
    relaunched: 0,
    async checkUpdate() {
      this.checks++;
      if (checkError) throw checkError;
      if (!update) return null;
      return {
        version: update,
        install: async (onProgress) => {
          log.push('install');
          onProgress(0.42);
          if (installError) throw installError;
        },
      };
    },
    async relaunch() {
      this.relaunched++;
      log.push('relaunch');
    },
  };
  const u = createUpdater({
    backend,
    appInfo: async () => ({ version: '0.3.0', updaterConfigured: configured }),
    runCloseFlow: async () => {
      log.push('closeFlow');
      return closeOk;
    },
    showBanner: (text, opts = {}) => banners.push({ text, actions: opts.actions || [] }),
    hideBanner: () => banners.push({ hidden: true }),
    notify: (text, kind = 'info') => notes.push({ text, kind }),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
  });
  return { u, backend, timers, log, banners, notes };
}
const lastBanner = (h) => h.banners.filter((b) => !b.hidden).at(-1);
const click = (b, label) => b.actions.find((a) => a.label === label).onSelect();

test('startup check once after 10 s', async () => {
  const h = setup({ update: '0.3.1' });
  h.u.scheduleStartupCheck();
  h.u.scheduleStartupCheck(); // second call is a no-op
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 10000);
  assert.equal(h.backend.checks, 0);
  await h.timers[0].fn();
  assert.equal(h.backend.checks, 1);
  const b = lastBanner(h);
  assert.equal(b.text, 'Folio 0.3.1 is available.');
  assert.deepEqual(b.actions.map((a) => a.label), ['Install and restart', 'Later']);
});

test('startup check is skipped when not configured', async () => {
  const h = setup({ configured: false, update: '0.3.1' });
  h.u.scheduleStartupCheck();
  await h.timers[0].fn();
  assert.equal(h.backend.checks, 0);
  assert.equal(h.banners.length, 0);
  assert.equal(h.notes.length, 0);
});

test('startup check is silent on error and when up to date', async () => {
  const h = setup({ checkError: 'network down' });
  h.u.scheduleStartupCheck();
  await h.timers[0].fn();
  assert.equal(h.banners.length, 0);
  assert.equal(h.notes.length, 0);
  const g = setup({ update: null });
  g.u.scheduleStartupCheck();
  await g.timers[0].fn();
  assert.equal(g.banners.length + g.notes.length, 0);
});

test('Later dismisses the banner for this launch', async () => {
  const h = setup({ update: '0.3.1' });
  h.u.scheduleStartupCheck();
  await h.timers[0].fn();
  click(lastBanner(h), 'Later');
  assert.equal(h.banners.at(-1).hidden, true);
  assert.equal(h.log.length, 0);
});

test('checkNow reports up to date', async () => {
  const h = setup({ update: null });
  await h.u.checkNow();
  assert.deepEqual(h.notes, [{ text: 'Folio is up to date.', kind: 'info' }]);
});

test('checkNow reports errors', async () => {
  const h = setup({ checkError: new Error('offline') });
  await h.u.checkNow();
  assert.deepEqual(h.notes, [{ text: "Couldn't check for updates: offline", kind: 'error' }]);
});

test('not configured message', async () => {
  const h = setup({ configured: false, update: '0.3.1' });
  await h.u.checkNow();
  assert.deepEqual(h.notes, [{ text: 'Updates not configured', kind: 'info' }]);
  assert.equal(h.backend.checks, 0);
});

test('checkNow shows the banner when an update exists', async () => {
  const h = setup({ update: '0.3.1' });
  await h.u.checkNow();
  assert.equal(lastBanner(h).text, 'Folio 0.3.1 is available.');
});

test('Install and restart: close flow, then progress, install, relaunch', async () => {
  const h = setup({ update: '0.3.1' });
  await h.u.checkNow();
  await click(lastBanner(h), 'Install and restart');
  assert.deepEqual(h.log, ['closeFlow', 'install', 'relaunch']);
  assert.ok(h.banners.some((b) => b.text === 'Downloading… 42%' && b.actions.length === 0));
});

test('close flow cancel aborts install', async () => {
  const h = setup({ update: '0.3.1', closeOk: false });
  await h.u.checkNow();
  const shown = lastBanner(h);
  await click(shown, 'Install and restart');
  assert.deepEqual(h.log, ['closeFlow']);
  assert.equal(h.backend.relaunched, 0);
  assert.equal(lastBanner(h), shown, 'banner stays');
  assert.equal(h.banners.at(-1).hidden, undefined);
});

test('install error is reported and nothing relaunches', async () => {
  const h = setup({ update: '0.3.1', installError: 'signature mismatch' });
  await h.u.checkNow();
  await click(lastBanner(h), 'Install and restart');
  assert.equal(h.backend.relaunched, 0);
  assert.deepEqual(h.notes.at(-1), { text: "Couldn't install the update: signature mismatch", kind: 'error' });
});

test('a second Install click while installing is ignored', async () => {
  const h = setup({ update: '0.3.1' });
  await h.u.checkNow();
  const b = lastBanner(h);
  await Promise.all([click(b, 'Install and restart'), click(b, 'Install and restart')]);
  assert.equal(h.log.filter((x) => x === 'install').length, 1);
});
