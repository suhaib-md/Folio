import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosave } from '../src/desktop/autosave.js';
import * as T from '../src/desktop/tabs.js';

function rig({ blocked = () => false } = {}) {
  let n = 1;
  const timers = new Map();
  const saves = [];
  const tabs = new Map();
  const a = createAutosave({
    getTab: (id) => tabs.get(id) || null,
    save: async (id) => { saves.push(id); },
    blocked,
    setTimer: (fn, ms) => { timers.set(n, { fn, ms }); return n++; },
    clearTimer: (h) => timers.delete(h),
  });
  const tab = (id, extra = {}) => {
    const v = { id, path: '/a.md', text: 'x', savedText: 'y', ...extra };
    tabs.set(id, v);
    return v;
  };
  const fire = () => { for (const [k, t] of [...timers]) { timers.delete(k); t.fn(); } };
  return { a, tab, tabs, timers, saves, fire };
}

test('setAutosavePaused is pure and sets the flag', () => {
  let s = T.openFile(T.createState(), { path: '/a.md', text: 'a', eol: 'lf', bom: false });
  const id = s.activeId;
  const s2 = T.setAutosavePaused(s, id, true);
  assert.equal(s2.tabs[0].autosavePaused, true);
  assert.notEqual(s2, s);
  assert.equal(s.tabs[0].autosavePaused, undefined);
  assert.equal(T.setAutosavePaused(s2, id, false).tabs[0].autosavePaused, false);
  assert.equal(T.setAutosavePaused(s, 'nope', true), s);
});

test('dirty tab with a path is saved 1 s after the last change', () => {
  const { a, tab, timers, saves, fire } = rig();
  const t = tab('t1');
  a.sync([t], true);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].ms, 1000);
  const t2 = tab('t1', { text: 'xy' }); // typing: re-armed, still one timer
  a.sync([t2], true);
  assert.equal(timers.size, 1);
  a.sync([t2], true); // same text: left alone
  assert.equal(timers.size, 1);
  fire();
  assert.deepEqual(saves, ['t1']);
});

test('not saved: untitled, clean, paused, or autosave off; turning off cancels', () => {
  const { a, tab, timers } = rig();
  a.sync([tab('u', { path: null })], true);
  a.sync([tab('c', { savedText: 'x' })], true);
  a.sync([tab('p', { autosavePaused: true })], true);
  a.sync([tab('o')], false);
  assert.equal(timers.size, 0);
  a.sync([tab('t')], true);
  assert.equal(timers.size, 1);
  a.sync([tab('t')], false);
  assert.equal(timers.size, 0);
  a.sync([tab('t')], true);
  a.sync([], true); // tab gone
  assert.equal(timers.size, 0);
});

test('blocked by a modal: rescheduled, saved once it clears', () => {
  let block = true;
  const { a, tab, timers, saves, fire } = rig({ blocked: () => block });
  a.sync([tab('t1')], true);
  fire();
  assert.deepEqual(saves, []);
  assert.equal(timers.size, 1);
  block = false;
  fire();
  assert.deepEqual(saves, ['t1']);
});

test('a tab that became ineligible before the timer fired is not saved', () => {
  const { a, tab, saves, fire } = rig();
  a.sync([tab('t1')], true);
  tab('t1', { autosavePaused: true });
  fire();
  assert.deepEqual(saves, []);
});
