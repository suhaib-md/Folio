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

test('a rename that throws reopens the gate (try/finally pattern)', async () => {
  const g = createGate();
  const rename = async () => {
    let open;
    g.hold(new Promise((r) => { open = r; }));
    try { throw new Error('rename failed'); } finally { open(); }
  };
  await assert.rejects(rename(), /rename failed/);
  assert.equal(g.closed, false);
  await g.wait();
});

test('queued savers wait for the gate, the rename waits only for writers past it', async () => {
  const g = createGate();
  const writing = new Set();
  const order = [];
  const save = async (name, ms) => {
    await g.wait();
    const w = new Promise((r) => setTimeout(r, ms)).then(() => order.push(`wrote ${name}`));
    writing.add(w);
    w.then(() => writing.delete(w));
    await w;
  };
  const first = save('a', 20); // passes the (open) gate
  await Promise.resolve();
  let open;
  g.hold(new Promise((r) => { open = r; })); // rename starts: gate closes first
  const queued = save('b', 5); // chained behind: waits at the gate
  const inFlight = [...writing];
  await Promise.all(inFlight); // must not include `queued`
  order.push('renamed');
  open();
  await Promise.all([first, queued]);
  assert.deepEqual(order, ['wrote a', 'renamed', 'wrote b']);
});

test('re-checking closed after waking sees a hold added in between', async () => {
  const g = createGate();
  let open1;
  g.hold(new Promise((r) => { open1 = r; }));
  let open2;
  const seen = [];
  const save = (async () => {
    while (g.closed) await g.wait();
    seen.push(g.closed); // nothing may await between this check and the read
  })();
  open1();
  // A second hold lands in the microtask gap before the waiter continues.
  Promise.resolve().then(() => g.hold(new Promise((r) => { open2 = r; })));
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, []);
  open2();
  await save;
  assert.deepEqual(seen, [false]);
});
