import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planWindowClose, runWindowClose } from '../src/desktop/closing.js';
import { createState, openFile, setText, closeTab } from '../src/desktop/tabs.js';

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

test('runWindowClose re-plans: a tab that becomes dirty during a prompt is prompted too', async () => {
  let s = createState();
  for (const p of ['/a.md', '/b.md']) s = open(s, p);
  const [a, b] = s.tabs;
  s = setText(s, a.id, 'edited a');
  const asked = [];
  const ok = await runWindowClose({
    getState: () => s,
    closeTabFlow: async (id) => {
      asked.push(id);
      // While a's prompt/save is pending the user types in the clean tab b.
      if (id === a.id) s = setText(s, b.id, 'edited b');
      s = closeTab(s, id);
      return true;
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(asked, [a.id, b.id]);
});

test('runWindowClose stops at the first cancel', async () => {
  let s = createState();
  for (const p of ['/a.md', '/b.md']) s = open(s, p);
  const [a, b] = s.tabs;
  s = setText(setText(s, a.id, '1'), b.id, '2');
  const asked = [];
  const ok = await runWindowClose({
    getState: () => s,
    closeTabFlow: async (id) => { asked.push(id); return false; },
  });
  assert.equal(ok, false);
  assert.deepEqual(asked, [a.id]);
});

test('runWindowClose with nothing dirty allows close without prompts', async () => {
  const s = open(createState(), '/a.md');
  let calls = 0;
  assert.equal(await runWindowClose({ getState: () => s, closeTabFlow: async () => { calls++; return true; } }), true);
  assert.equal(calls, 0);
});
