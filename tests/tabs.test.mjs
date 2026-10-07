import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePath, createState, openFile, newUntitled, setText, setMode,
  markSaved, setBanner, clearSaved, isDirty, closeTab, activate, cycle,
  windowTitle, findByPath,
} from '../src/desktop/tabs.js';

const open = (s, path, text = 'x') => openFile(s, { path, text, eol: 'lf', bom: false });
const active = (s) => s.tabs.find((t) => t.id === s.activeId);

test('normalizePath', () => {
  assert.equal(normalizePath('C:\\Users\\A//b.MD'), 'c:/users/a/b.md');
});

test('open adds read tab', () => {
  const s = openFile(createState(), { path: 'C:\\Notes\\A.md', text: 'hi', eol: 'crlf', bom: true });
  assert.equal(s.tabs.length, 1);
  const t = active(s);
  assert.equal(t.title, 'A.md');
  assert.equal(t.mode, 'read');
  assert.equal(t.text, 'hi');
  assert.equal(t.savedText, 'hi');
  assert.equal(t.eol, 'crlf');
  assert.equal(t.bom, true);
  assert.equal(t.scrollTop, 0);
  assert.equal(t.banner, null);
});

test('open same path focuses existing', () => {
  let s = open(createState(), 'C:\\Users\\Muhammed suhaib\\Notes\\A.md');
  s = open(s, 'D:\\other.md');
  s = open(s, 'c:/users/muhammed suhaib/notes/a.md');
  assert.equal(s.tabs.length, 2);
  assert.equal(active(s).path, 'C:\\Users\\Muhammed suhaib\\Notes\\A.md');
  assert.ok(findByPath(s, 'C:/USERS/muhammed suhaib/notes/a.md'));
});

test('untitled numbering', () => {
  let s = newUntitled(newUntitled(createState()));
  assert.deepEqual(s.tabs.map((t) => t.title), ['Untitled-1', 'Untitled-2']);
  for (const t of s.tabs) {
    assert.equal(t.mode, 'edit');
    assert.equal(t.eol, 'lf');
    assert.equal(t.bom, false);
    assert.equal(t.path, null);
  }
  assert.equal(s.activeId, s.tabs[1].id);
});

test('dirty tracking and purity', () => {
  const s0 = open(createState(), 'a.md', 'one');
  const id = s0.activeId;
  const s1 = setText(s0, id, 'two');
  assert.equal(isDirty(s0.tabs[0]), false);
  assert.equal(isDirty(s1.tabs[0]), true);
  const s2 = markSaved(s1, id, { text: 'two' });
  assert.equal(isDirty(s2.tabs[0]), false);
  assert.equal(s2.tabs[0].text, 'two');
  assert.equal(setText(s0, 'nope', 'z'), s0);
});

test('markSaved renames', () => {
  let s = newUntitled(createState());
  const id = s.activeId;
  s = setText(s, id, 'body');
  s = markSaved(s, id, { path: 'C:\\docs\\notes.md', text: 'body' });
  assert.equal(s.tabs[0].path, 'C:\\docs\\notes.md');
  assert.equal(s.tabs[0].title, 'notes.md');
  assert.equal(isDirty(s.tabs[0]), false);
});

test('clearSaved makes dirty', () => {
  let s = open(createState(), 'a.md', 'one');
  s = clearSaved(s, s.activeId);
  assert.equal(s.tabs[0].savedText, null);
  assert.equal(isDirty(s.tabs[0]), true);
});

test('setMode and setBanner', () => {
  let s = open(createState(), 'a.md');
  s = setMode(s, s.activeId, 'edit');
  s = setBanner(s, s.activeId, { kind: 'x' });
  assert.equal(s.tabs[0].mode, 'edit');
  assert.deepEqual(s.tabs[0].banner, { kind: 'x' });
  s = setBanner(s, s.activeId, null);
  assert.equal(s.tabs[0].banner, null);
});

test('setMode accepts read|edit|split and rejects others', () => {
  let s = open(createState(), 'a.md');
  const id = s.activeId;
  for (const mode of ['edit', 'split', 'read']) {
    s = setMode(s, id, mode);
    assert.equal(s.tabs[0].mode, mode);
  }
  for (const bad of ['preview', '', 'Edit', null, undefined, 3]) {
    assert.equal(setMode(s, id, bad), s, `mode ${String(bad)} accepted`);
  }
  assert.equal(s.tabs[0].mode, 'read');
});

test('close activates right then left', () => {
  let s = createState();
  s = open(s, 'a.md'); s = open(s, 'b.md'); s = open(s, 'c.md');
  const [a, b, c] = s.tabs.map((t) => t.id);
  s = activate(s, b);
  s = closeTab(s, b);
  assert.equal(s.activeId, c);
  s = closeTab(s, c);
  assert.equal(s.activeId, a);
  s = closeTab(s, a);
  assert.equal(s.activeId, null);
  assert.equal(s.tabs.length, 0);
});

test('closing a non-active tab keeps active', () => {
  let s = open(open(createState(), 'a.md'), 'b.md');
  const [a, b] = s.tabs.map((t) => t.id);
  s = closeTab(s, a);
  assert.equal(s.activeId, b);
});

test('cycle wraps', () => {
  let s = open(open(open(createState(), 'a.md'), 'b.md'), 'c.md');
  const [a, , c] = s.tabs.map((t) => t.id);
  assert.equal(cycle(s, 1).activeId, a);
  s = activate(s, a);
  assert.equal(cycle(s, -1).activeId, c);
  assert.equal(cycle(createState(), 1).activeId, null);
});

test('window title', () => {
  assert.equal(windowTitle(createState()), 'Folio');
  let s = open(createState(), 'C:\\x\\a.md', 'one');
  assert.equal(windowTitle(s), 'a.md — Folio');
  s = setText(s, s.activeId, 'two');
  assert.equal(windowTitle(s), '● a.md — Folio');
});
