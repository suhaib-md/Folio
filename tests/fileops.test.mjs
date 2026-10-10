import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateName, withMdExtension, keepExtension, remapPath, joinPath, isInside } from '../src/desktop/fileops.js';

test('validateName accepts ordinary names', () => {
  for (const n of ['notes', 'notes.md', 'my file.md', 'a.b.c', '.hidden', 'CONSOLE', 'com10', 'lpt0', 'été.md']) {
    assert.equal(validateName(n), null, n);
  }
});

test('validateName rejects empty, bad characters, trailing dot/space, reserved names', () => {
  const bad = ['', '   ', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b',
    'a.', 'a ', '..', '.', 'CON', 'con', 'PRN', 'Aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9', 'con.txt', 'nul.md', 'a\u0001b'];
  for (const n of bad) {
    const err = validateName(n);
    assert.equal(typeof err, 'string', JSON.stringify(n));
    assert.ok(err.length > 0);
  }
  assert.equal(validateName(null), 'Enter a name.');
});

test('withMdExtension adds .md only when there is no extension', () => {
  assert.equal(withMdExtension('notes'), 'notes.md');
  assert.equal(withMdExtension('notes.md'), 'notes.md');
  assert.equal(withMdExtension('notes.txt'), 'notes.txt');
  assert.equal(withMdExtension('a.b'), 'a.b');
  assert.equal(withMdExtension('.hidden'), '.hidden.md');
});

test('remapPath for file and folder with mixed case and separators', () => {
  // the file itself
  assert.equal(remapPath('/demo/a.md', '/demo/a.md', '/demo/b.md'), '/demo/b.md');
  assert.equal(remapPath('C:\\Docs\\A.md', 'c:/docs/a.md', 'C:\\Docs\\B.md'), 'C:\\Docs\\B.md');
  // inside a renamed folder
  assert.equal(remapPath('/demo/notes/todo.md', '/demo/notes', '/demo/memos'), '/demo/memos/todo.md');
  assert.equal(remapPath('/demo/Notes/deep/x.md', '/demo/notes', '/demo/memos'), '/demo/memos/deep/x.md');
  assert.equal(remapPath('C:\\Docs\\Notes\\deep\\X.md', 'c:/docs/notes', 'C:\\Docs\\Memos'), 'C:\\Docs\\Memos\\deep\\X.md');
  assert.equal(remapPath('C:/Docs/Notes/x.md', 'C:\\docs\\notes', 'C:\\Docs\\Memos'), 'C:\\Docs\\Memos\\x.md');
  assert.equal(remapPath('/demo//notes/x.md', '/demo/notes/', '/demo/memos'), '/demo/memos/x.md');
  // not inside: sibling with the same prefix, parent, unrelated
  assert.equal(remapPath('/demo/notes2/x.md', '/demo/notes', '/demo/memos'), null);
  assert.equal(remapPath('/demo', '/demo/notes', '/demo/memos'), null);
  assert.equal(remapPath('/other/x.md', '/demo/notes', '/demo/memos'), null);
  // a normalised (lower-case) key maps to the new spelling
  assert.equal(remapPath('/demo/notes/deep', '/demo/notes', '/demo/Memos'), '/demo/Memos/deep');
});

test('joinPath keeps the separator style and isInside is case/separator blind', () => {
  assert.equal(joinPath('/demo/notes', 'a.md'), '/demo/notes/a.md');
  assert.equal(joinPath('C:\\Docs', 'a.md'), 'C:\\Docs\\a.md');
  assert.equal(joinPath('C:\\Docs\\', 'a.md'), 'C:\\Docs\\a.md');
  assert.equal(isInside('C:\\Docs', 'c:/docs/x/a.md'), true);
  assert.equal(isInside('/demo', '/demo'), true);
  assert.equal(isInside('/demo', '/demo2/a.md'), false);
});

test('keepExtension keeps the original extension when the new name has none', () => {
  assert.equal(keepExtension('manual', 'guide.md'), 'manual.md');
  assert.equal(keepExtension('manual.txt', 'guide.md'), 'manual.txt');
  assert.equal(keepExtension('manual', 'README'), 'manual');
  assert.equal(keepExtension('v1.2', 'guide.md'), 'v1.2');
  assert.equal(keepExtension('manual', 'a.b.markdown'), 'manual.markdown');
});
