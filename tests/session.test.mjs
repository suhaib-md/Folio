import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSession, startupOrder } from '../src/desktop/session.js';

const tab = (id, path, mode = 'read') => ({ id, path, mode, title: id });

test('capture skips untitled and keeps modes', () => {
  const state = { tabs: [tab('t1', 'C:/a.md'), tab('t2', null, 'edit'), tab('t3', 'C:/b.md', 'split')], activeId: 't3' };
  assert.deepEqual(captureSession(state, 'C:/docs'), {
    tabs: [{ path: 'C:/a.md', mode: 'read' }, { path: 'C:/b.md', mode: 'split' }],
    active: 'C:/b.md', folder: 'C:/docs',
  });
  assert.equal(captureSession({ ...state, activeId: 't2' }, null).active, null);
  assert.equal(captureSession({ tabs: [], activeId: null }, null).folder, null);
});

test('order drafts → session → launch', () => {
  const r = startupOrder({
    drafts: ['C:/d.md'],
    session: { tabs: [{ path: 'C:/d.md', mode: 'edit' }, { path: 'C:/s1.md', mode: 'edit' }, { path: 'C:/s2.md', mode: 'read' }], active: 'C:/s1.md', folder: 'C:/f' },
    launch: ['C:/l1.md', 'C:/l2.md'],
  });
  assert.deepEqual(r.open.map((o) => o.path), ['C:/d.md', 'C:/s1.md', 'C:/s2.md', 'C:/l1.md', 'C:/l2.md']);
  assert.equal(r.open[1].mode, 'edit');
  assert.equal(r.activate, 'C:/l2.md');
  assert.equal(r.folder, 'C:/f');
});

test('launch path already in session is activated not duplicated', () => {
  const r = startupOrder({
    session: { tabs: [{ path: 'C:/A.md', mode: 'edit' }, { path: 'C:/b.md', mode: 'read' }], active: 'C:/b.md', folder: null },
    launch: ['c:\\a.md'],
  });
  assert.deepEqual(r.open.map((o) => o.path), ['C:/A.md', 'C:/b.md']);
  assert.equal(r.activate, 'C:/A.md');
});

test('without launch: stored active, else last tab', () => {
  const session = { tabs: [{ path: 'x', mode: 'read' }, { path: 'y', mode: 'read' }], active: 'x', folder: null };
  assert.equal(startupOrder({ session }).activate, 'x');
  assert.equal(startupOrder({ session: { ...session, active: 'gone' } }).activate, 'y');
  assert.deepEqual(startupOrder({}), { open: [], activate: null, folder: null });
});

test('missing files are the caller\'s concern', () => {
  const r = startupOrder({ session: { tabs: [{ path: '/nope.md', mode: 'read' }], active: null, folder: '/nofolder' } });
  assert.equal(r.open.length, 1);
  assert.equal(r.folder, '/nofolder');
});
