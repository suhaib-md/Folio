import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWindowClose } from '../src/desktop/closing.js';
import { createState, openFile, setText } from '../src/desktop/tabs.js';

const open = (s, path) => openFile(s, { path, text: 'x', eol: 'lf', bom: false });

test('planWindowClose returns dirty tabs in order', () => {
  let s = createState();
  for (const p of ['/clean1.md', '/a.md', '/clean2.md', '/b.md']) s = open(s, p);
  const [, a, , b] = s.tabs;
  s = setText(s, b.id, 'edited b');
  s = setText(s, a.id, 'edited a');
  assert.deepEqual(planWindowClose(s).map((t) => t.title), ['a.md', 'b.md']);
  assert.deepEqual(planWindowClose(s).map((t) => t.id), [a.id, b.id]);
});

test('no dirty tabs → []', () => {
  let s = open(open(createState(), '/a.md'), '/b.md');
  assert.deepEqual(planWindowClose(s), []);
  assert.deepEqual(planWindowClose(createState()), []);
});
