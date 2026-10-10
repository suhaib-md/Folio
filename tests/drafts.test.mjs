import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraftScheduler, restorePlan } from '../src/desktop/drafts.js';
import * as T from '../src/desktop/tabs.js';

// Manual clock + timers + backend.
function rig({ saveImpl } = {}) {
  let t = 0;
  const timers = new Map();
  let nextTimer = 1;
  const log = [];
  const tabs = new Map();
  const saves = []; // pending save resolvers
  const sched = createDraftScheduler({
    getTab: (id) => tabs.get(id),
    now: () => t,
    setTimer: (fn, ms) => { const h = nextTimer++; timers.set(h, { at: t + ms, fn }); return h; },
    clearTimer: (h) => timers.delete(h),
    save: (d) => {
      log.push(['save', d.id, d.text]);
      if (saveImpl) return saveImpl(d, saves);
      return Promise.resolve();
    },
    remove: (id) => { log.push(['remove', id]); return Promise.resolve(); },
  });
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = Math.max(t, due[1].at);
      due[1].fn();
    }
    t = end;
  };
  const jump = (ms) => { t += ms; };
  const tick = () => new Promise((r) => setImmediate(r));
  const tab = (id, text, extra = {}) => {
    const v = { id, draftId: `n-${id}`, path: '/a.md', title: 'a.md', text, savedText: 'base', eol: 'lf', bom: false, ...extra };
    tabs.set(id, v);
    return v;
  };
  return { sched, advance, jump, tick, log, tab, tabs, saves, now: () => t, timers };
}

test('debounce 2 s', async () => {
  const r = rig();
  r.sched.changed(r.tab('t1', 'one'));
  r.advance(1999);
  assert.equal(r.log.length, 0);
  r.advance(1);
  assert.deepEqual(r.log, [['save', 'n-t1', 'one']]);
});

test('each change re-arms the debounce and the write holds the latest text', async () => {
  const r = rig();
  r.sched.changed(r.tab('t1', 'a'));
  r.advance(1500);
  r.sched.changed(r.tab('t1', 'ab'));
  r.advance(1500);
  assert.equal(r.log.length, 0);
  r.tab('t1', 'abc'); // typed without a changed() call: fire time reads the current tab
  r.advance(500);
  assert.deepEqual(r.log, [['save', 'n-t1', 'abc']]);
});

test('max interval 10 s while typing', async () => {
  const r = rig();
  for (let i = 0; i < 12; i++) {
    r.sched.changed(r.tab('t1', `x${i}`));
    r.advance(1000);
  }
  assert.equal(r.log.filter((l) => l[0] === 'save').length >= 1, true);
  assert.deepEqual(r.log[0], ['save', 'n-t1', 'x9']); // first write when the first change is 10 s old
  assert.equal(r.log.length, 1);
});

test('a change arriving after the max interval writes at once (late timers)', async () => {
  const r = rig();
  r.sched.changed(r.tab('t1', 'a'));
  r.jump(10000); // the 2 s timer never ran (e.g. a throttled background page)
  r.sched.changed(r.tab('t1', 'b'));
  assert.deepEqual(r.log, [['save', 'n-t1', 'b']]);
});

test('clean cancels pending', async () => {
  const r = rig();
  r.sched.changed(r.tab('t1', 'one'));
  r.advance(1000);
  r.sched.clean('t1', 'n-t1');
  r.advance(60000);
  assert.deepEqual(r.log, [['remove', 'n-t1']]);
});

test('clean after in-flight save removes the draft', async () => {
  let release;
  const r = rig({ saveImpl: () => new Promise((res) => { release = res; }) });
  r.sched.changed(r.tab('t1', 'one'));
  r.advance(2000);
  assert.deepEqual(r.log, [['save', 'n-t1', 'one']]);
  r.sched.clean('t1', 'n-t1'); // saved elsewhere while the draft write runs
  assert.deepEqual(r.log, [['save', 'n-t1', 'one'], ['remove', 'n-t1']]);
  release();
  await r.tick();
  assert.deepEqual(r.log.slice(2), [['remove', 'n-t1']]);
  await r.sched.settled();
});

test('writes for one tab never overlap; the latest text wins', async () => {
  const releases = [];
  const r = rig({ saveImpl: () => new Promise((res) => releases.push(res)) });
  r.sched.changed(r.tab('t1', 'one'));
  r.advance(2000);
  r.sched.changed(r.tab('t1', 'two'));
  r.advance(2000);
  r.sched.changed(r.tab('t1', 'three'));
  r.advance(2000);
  assert.deepEqual(r.log, [['save', 'n-t1', 'one']]); // still the first write
  releases[0]();
  await r.tick();
  assert.deepEqual(r.log, [['save', 'n-t1', 'one'], ['save', 'n-t1', 'three']]);
  releases[1]();
  await r.tick();
  assert.equal(r.log.length, 2);
});

test('typing again after clean while a stale write is in flight is written afterwards', async () => {
  const releases = [];
  const r = rig({ saveImpl: () => new Promise((res) => releases.push(res)) });
  r.sched.changed(r.tab('t1', 'one'));
  r.advance(2000);
  r.sched.clean('t1', 'n-t1');
  r.sched.changed(r.tab('t1', 'again'));
  r.advance(2000); // fires while the old write runs
  releases[0]();
  await r.tick();
  await r.tick();
  assert.deepEqual(r.log.map((l) => l.join(':')), [
    'save:n-t1:one', 'remove:n-t1', 'remove:n-t1', 'save:n-t1:again',
  ]);
});

test('nothing is written for a tab that is clean or gone at fire time', async () => {
  const r = rig();
  r.sched.changed(r.tab('t1', 'x'));
  r.tab('t1', 'base'); // text back to the saved text
  r.advance(2000);
  r.sched.changed(r.tab('t2', 'y'));
  r.tabs.delete('t2');
  r.advance(2000);
  assert.deepEqual(r.log, []);
});

test('a failed write is retried', async () => {
  let fail = true;
  const r = rig({ saveImpl: () => (fail ? Promise.reject('disk full') : Promise.resolve()) });
  const warn = console.warn;
  console.warn = () => {};
  try {
    r.sched.changed(r.tab('t1', 'one'));
    r.advance(2000);
    await r.tick();
    fail = false;
    r.advance(10000);
    await r.tick();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(r.log.map((l) => l[0]), ['save', 'save']);
});

test('restore order and disk-changed flag', () => {
  const mk = (id, path, baseText, savedAt) => ({ id, path, title: 't', text: 'x', eol: 'lf', bom: false, baseText, savedAt });
  const drafts = [
    mk('c', '/c.md', 'same', 30),
    mk('a', '/a.md', 'old', 10),
    mk('u', null, null, 20),
    mk('m', '/gone.md', 'x', 40),
  ];
  const disk = new Map([['/c.md', 'same'], ['/a.md', 'new'], ['/gone.md', null]]);
  const plan = restorePlan(drafts, disk);
  assert.deepEqual(plan.map((p) => p.draft.id), ['a', 'u', 'c', 'm']);
  assert.deepEqual(plan.map((p) => p.diskChanged), [true, false, false, false]);
});

test('tabs carry a draftId with the launch nonce; recovered tabs keep the draft id', () => {
  let s = T.createState();
  s = T.openFile(s, { path: '/a.md', text: 'x', eol: 'lf', bom: false });
  s = T.newUntitled(s);
  const [a, u] = s.tabs;
  assert.match(a.draftId, /^[A-Za-z0-9_-]+$/);
  assert.equal(a.draftId, `${T.launchNonce}-${a.id}`);
  assert.notEqual(a.draftId, u.draftId);
  s = T.openRecovered(s, {
    draftId: 'old-t3', path: null, title: 'Untitled-4', text: 'hi', savedText: '', eol: 'lf', bom: false, banner: null,
  });
  assert.equal(s.tabs[2].draftId, 'old-t3');
  assert.equal(s.untitledCounter, 4);
  assert.equal(T.newUntitled(s).tabs[3].title, 'Untitled-5');
});

test('re-entrant changed() from inside getTab never overlaps writes; the latest text is persisted', async () => {
  let t = 0;
  const timers = new Map();
  let h = 1;
  let running = 0;
  let maxConc = 0;
  const persisted = [];
  const releases = [];
  const tab = { id: 't1', draftId: 'n-t1', path: '/a.md', title: 'a.md', text: 'v0', savedText: 'base', eol: 'lf', bom: false };
  let reenter = true;
  const sched = createDraftScheduler({
    getTab: () => {
      // like getState() -> editor.flush() -> onEditorChange -> render -> syncDrafts
      if (reenter) { tab.text = tab.text + '+'; sched.changed(tab); }
      return tab;
    },
    now: () => t,
    setTimer: (fn, ms) => { timers.set(h, { at: t + ms, fn }); return h++; },
    clearTimer: (x) => timers.delete(x),
    save: (d) => new Promise((res) => {
      running++; maxConc = Math.max(maxConc, running);
      releases.push(() => { running--; persisted.push(d.text); res(); });
    }),
    remove: async () => {},
  });
  const run = (ms) => {
    t += ms;
    for (const [k, v] of [...timers]) if (v.at <= t) { timers.delete(k); v.fn(); }
  };
  sched.changed(tab);
  t += 10000; // first change is 10 s old
  for (let i = 0; i < 4; i++) { sched.changed(tab); run(2000); }
  assert.equal(maxConc, 1);
  while (releases.length) { releases.shift()(); await new Promise((r) => setImmediate(r)); run(2000); }
  assert.equal(maxConc, 1);
  assert.equal(persisted.at(-1), tab.text);
  reenter = false;
});

import { restoreDecision } from '../src/desktop/drafts.js';

test('restoreDecision: equal-to-disk deletes, second draft for an open path becomes a numbered copy, missing file stays dirty', () => {
  const d = (over = {}) => ({ id: 'x', path: '/a.md', title: 'a.md', text: 'draft', eol: 'lf', bom: false, baseText: 'b', savedAt: 1, ...over });
  assert.deepEqual(restoreDecision(d(), { text: 'draft' }), { action: 'delete' });
  const normal = restoreDecision(d(), { text: 'disk' });
  assert.deepEqual(normal, { action: 'open', path: '/a.md', title: 'a.md', savedText: 'disk', bannerText: 'Recovered unsaved changes.' });
  const changed = restoreDecision(d(), { text: 'disk' }, { diskChanged: true });
  assert.equal(changed.bannerText, 'Recovered unsaved changes. a.md also changed on disk.');
  const missing = restoreDecision(d(), null);
  assert.equal(missing.path, '/a.md');
  assert.equal(missing.savedText, null);
  const untitled = restoreDecision(d({ path: null, title: 'Untitled-2' }), null);
  assert.deepEqual([untitled.path, untitled.title, untitled.savedText], [null, 'Untitled-2', '']);
  const dup1 = restoreDecision(d(), { text: 'disk' }, { pathOpen: true, titles: ['a.md'] });
  assert.deepEqual([dup1.path, dup1.title, dup1.savedText], [null, 'a.md (recovered)', '']);
  const dup2 = restoreDecision(d(), { text: 'disk' }, { pathOpen: true, titles: ['a.md', 'a.md (recovered)'] });
  assert.equal(dup2.title, 'a.md (recovered 2)');
  const dup3 = restoreDecision(d(), { text: 'disk' }, { pathOpen: true, titles: ['a.md (recovered)', 'a.md (recovered 2)'] });
  assert.equal(dup3.title, 'a.md (recovered 3)');
});
