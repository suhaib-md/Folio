import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

globalThis.window = new JSDOM('<!doctype html><body></body>').window;
globalThis.document = window.document;
const { createMermaidQueue } = await import('../src/desktop/diagrams.js');

test('interleaved light/dark jobs each render under their own theme', async () => {
  let theme = null;
  const lib = {
    async render(id) {
      const used = theme;
      await new Promise((r) => setTimeout(r, 5)); // another job could change the theme here
      return { svg: `${id}:${used}` };
    },
  };
  const q = createMermaidQueue(async () => lib, (_m, t) => { theme = t; });
  const jobs = ['light', 'dark', 'dark', 'light', 'dark'].map((t, i) =>
    q.run(t, (m) => m.render(`j${i}`)).then((r) => [t, r.svg]));
  for (const [t, svg] of await Promise.all(jobs)) assert.ok(svg.endsWith(`:${t}`), svg);
});

test('a failing job or load does not wedge the queue', async () => {
  let n = 0;
  const q = createMermaidQueue(async () => { if (++n === 1) throw new Error('boom'); return {}; }, () => {});
  await assert.rejects(q.run('light', () => 1), /boom/);
  assert.equal(await q.run('light', () => 2), 2);
  await assert.rejects(q.run('dark', () => { throw new Error('job'); }), /job/);
  assert.equal(await q.run('dark', () => 3), 3);
});
