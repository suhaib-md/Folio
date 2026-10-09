import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;
const { searchFolder } = await import('../src/desktop/fake-backend.js');
const fs = globalThis.__fake.fs;
for (const k of Object.keys(fs)) delete fs[k];
Object.assign(fs, {
  '/s/a.md': 'Ünï foo\nnothing\nFOO foo',
  '/s/b/c.md': 'foo',
  '/s/.git/x.md': 'foo',
  '/s/node_modules/y.md': 'foo',
  '/s/n.txt': 'foo',
  '/s/long.md': 'é'.repeat(300) + 'NEEDLE' + 'z'.repeat(300),
});

test('searchFolder: order, skip rules, offsets', async () => {
  const r = await searchFolder('/s', 'foo', true, 1);
  assert.equal(r.requestId, 1);
  assert.deepEqual(r.files.map((f) => f.path), ['/s/b/c.md', '/s/a.md']);
  assert.deepEqual(r.files[1].matches.map((m) => [m.line, m.start, m.end]), [[1, 4, 7], [3, 4, 7]]);
});

test('searchFolder: case folding, empty query, window', async () => {
  const ci = await searchFolder('/s', 'foo', false, 2);
  assert.equal(ci.files.find((f) => f.path === '/s/a.md').matches.length, 3);
  assert.deepEqual(await searchFolder('/s', '', false, 3), { requestId: 3, files: [], truncated: false });
  const r = await searchFolder('/s', 'needle', false, 4);
  const m = r.files[0].matches[0];
  assert.equal([...m.text].length, 200);
  assert.deepEqual([m.start, m.end], [60, 66]);
});

test('searchFolder: a newer request rejects the older one', async () => {
  const older = searchFolder('/s', 'foo', true, 10);
  const newer = searchFolder('/s', 'foo', true, 11);
  await assert.rejects(older, (e) => e === 'cancelled');
  assert.equal((await newer).requestId, 11);
});
