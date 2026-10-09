import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalize, createSettings, zoomStep } from '../src/desktop/settings.js';

test('normalize: defaults for junk', () => {
  for (const raw of [null, undefined, 5, 'x', [], {}]) assert.deepEqual(normalize(raw), DEFAULTS);
});

test('normalize clamps zoom and theme', () => {
  assert.equal(normalize({ zoom: 20 }).zoom, 70);
  assert.equal(normalize({ zoom: 999 }).zoom, 200);
  assert.equal(normalize({ zoom: 114 }).zoom, 110);
  assert.equal(normalize({ zoom: 'abc' }).zoom, 100);
  assert.equal(normalize({ zoom: '130' }).zoom, 130);
  assert.equal(normalize({ theme: 'dark' }).theme, 'dark');
  assert.equal(normalize({ theme: 'purple' }).theme, 'system');
  assert.equal(normalize({ autosave: 'true' }).autosave, true);
  assert.equal(normalize({ autosave: 1 }).autosave, false);
});

test('normalize: sidebar and session are sanitized', () => {
  const n = normalize({
    sidebar: { visible: false, tab: 'bogus' },
    session: { tabs: [{ path: '/a.md', mode: 'edit' }, { path: '' }, 7, { path: '/b.md', mode: 'x' }], active: 3, folder: '/f' },
    extra: 1,
  });
  assert.deepEqual(n.sidebar, { visible: false, tab: 'files' });
  assert.deepEqual(n.session, { tabs: [{ path: '/a.md', mode: 'edit' }, { path: '/b.md', mode: 'read' }], active: null, folder: '/f' });
  assert.equal('extra' in n, false);
});

function rig(initial) {
  const saved = [];
  const timers = new Map();
  let n = 1;
  const s = createSettings(
    { settingsGet: async () => initial, settingsSet: async (v) => { saved.push(v); } },
    { setTimer: (fn, ms) => { timers.set(n, { fn, ms }); return n++; }, clearTimer: (h) => timers.delete(h) },
  );
  const fire = () => { for (const [k, t] of [...timers]) { timers.delete(k); t.fn(); } };
  return { s, saved, timers, fire };
}

test('update debounces save (300 ms) and notifies immediately', async () => {
  const { s, saved, timers, fire } = rig({ zoom: 120 });
  await s.load();
  assert.equal(s.get().zoom, 120);
  const seen = [];
  s.onChange((v) => seen.push(v.autosave));
  s.update({ autosave: true });
  s.update({ sidebar: { tab: 'outline' } });
  assert.deepEqual(seen, [true, true]);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 300);
  assert.equal(saved.length, 0);
  fire();
  await s.flush();
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].sidebar, { visible: true, tab: 'outline' }); // deep merge keeps visible
  assert.equal(saved[0].autosave, true);
  assert.equal(saved[0].zoom, 120);
});

test('update with no change neither notifies nor saves; flush writes pending', async () => {
  const { s, saved } = rig({});
  await s.load();
  let calls = 0;
  const off = s.onChange(() => { calls++; });
  s.update({ zoom: 100 });
  assert.equal(calls, 0);
  s.update({ theme: 'dark' });
  await s.flush();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].theme, 'dark');
  await s.flush();
  assert.equal(saved.length, 1);
  off();
  s.update({ theme: 'light' });
  assert.equal(calls, 1);
});

test('load failure gives defaults; a failing save does not throw', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = createSettings({ settingsGet: async () => { throw 'boom'; }, settingsSet: async () => { throw 'nope'; } });
  assert.deepEqual(await s.load(), DEFAULTS);
  s.update({ autosave: true });
  await s.flush();
  assert.equal(warn.mock.callCount(), 2);
  assert.match(String(warn.mock.calls[0].arguments[0]), /loading settings failed/);
  assert.match(String(warn.mock.calls[1].arguments[0]), /saving settings failed/);
});

test('zoomStep up/down/reset and clamps at 70 and 200', () => {
  assert.equal(zoomStep(100, 1), 110);
  assert.equal(zoomStep(100, -1), 90);
  assert.equal(zoomStep(150, 0), 100);
  assert.equal(zoomStep(200, 1), 200);
  assert.equal(zoomStep(70, -1), 70);
  assert.equal(zoomStep(74, 1), 80); // off-grid values snap first
  assert.equal(zoomStep(NaN, 1), 110);
});
