import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGate } from '../src/desktop/gate.js';

test('wait resolves at once when nothing is held', async () => {
  const g = createGate();
  assert.equal(g.closed, false);
  await g.wait();
});

test('wait blocks until every held promise settles, rejections included', async () => {
  const g = createGate();
  let resolveA;
  let rejectB;
  g.hold(new Promise((r) => { resolveA = r; }));
  g.hold(new Promise((_, rej) => { rejectB = rej; })).catch(() => {});
  assert.equal(g.closed, true);
  const log = [];
  const w = g.wait().then(() => log.push('open'));
  resolveA();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(log, []);
  rejectB(new Error('x'));
  await w;
  assert.deepEqual(log, ['open']);
  assert.equal(g.closed, false);
});

test('a save gated by a rename reads the path after the rename', async () => {
  const g = createGate();
  const tab = { path: '/old.md' };
  let release;
  g.hold(new Promise((r) => { release = r; }).then(() => { tab.path = '/new.md'; }));
  const written = [];
  const save = (async () => { await g.wait(); written.push(tab.path); })();
  release();
  await save;
  assert.deepEqual(written, ['/new.md']);
});
