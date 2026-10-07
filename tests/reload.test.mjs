import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/desktop/reload.js';

const tab = (text, savedText) => ({
  id: 't1', path: '/a.md', title: 'a.md', text, savedText,
  eol: 'lf', bom: false, mode: 'read', scrollTop: 0, banner: null,
});

test('modified, diskText === savedText → ignore (our own save / no real change)', () => {
  assert.equal(decide(tab('same', 'same'), 'modified', 'same'), 'ignore');
  // Dirty tab, but the disk still holds what we last saved: nothing to do.
  assert.equal(decide(tab('typed', 'same'), 'modified', 'same'), 'ignore');
});

test('modified, not dirty → reload', () => {
  assert.equal(decide(tab('old', 'old'), 'modified', 'new'), 'reload');
});

test('modified, dirty → ask', () => {
  assert.equal(decide(tab('typed', 'old'), 'modified', 'new'), 'ask');
});

test('removed → removed (clean or dirty; diskText ignored)', () => {
  assert.equal(decide(tab('old', 'old'), 'removed', null), 'removed');
  assert.equal(decide(tab('typed', 'old'), 'removed', undefined), 'removed');
  assert.equal(decide(tab('old', 'old'), 'removed', 'old'), 'removed');
});

test('CRLF-normalised disk text equal to savedText → ignore', () => {
  // read_file hands back LF text; a CRLF file whose content matches is no change.
  const saved = 'line one\nline two\n';
  assert.equal(decide(tab(saved, saved), 'modified', 'line one\nline two\n'), 'ignore');
  // Defensive: raw CRLF text compares equal to its LF form.
  assert.equal(decide(tab(saved, saved), 'modified', 'line one\r\nline two\r\n'), 'ignore');
});

test('savedText null (after removed) and the file comes back different → ask', () => {
  assert.equal(decide(tab('mine', null), 'modified', 'other'), 'ask');
});

test('modified, diskText === current text → reload quietly (nothing to lose)', () => {
  // Removed, then restored with the same content.
  assert.equal(decide(tab('mine', null), 'modified', 'mine'), 'reload');
  // Dirty tab, external edit wrote exactly what was typed.
  assert.equal(decide(tab('typed', 'old'), 'modified', 'typed'), 'reload');
  // CRLF disk text equal to the LF tab text.
  assert.equal(decide(tab('a\nb\n', 'old'), 'modified', 'a\r\nb\r\n'), 'reload');
});
