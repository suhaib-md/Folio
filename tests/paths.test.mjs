import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, basename, resolveRelative, isMarkdownPath } from '../src/desktop/paths.js';

test('resolveRelative keeps Windows separators and spaces', () => {
  assert.equal(
    resolveRelative('C:\\Users\\Muhammed suhaib\\Notes\\a.md', 'img/p 1.png'),
    'C:\\Users\\Muhammed suhaib\\Notes\\img\\p 1.png',
  );
});

test('resolveRelative handles .. and .', () => {
  assert.equal(resolveRelative('/x/y/a.md', '../b.md'), '/x/b.md');
  assert.equal(resolveRelative('/x/y/a.md', './c/./d.md'), '/x/y/c/d.md');
  assert.equal(resolveRelative('C:\\a\\b\\doc.md', '..\\up.md'), 'C:\\a\\up.md');
});

test('resolveRelative from a document at the POSIX root', () => {
  assert.equal(resolveRelative('/a.md', 'b.md'), '/b.md');
  assert.equal(resolveRelative('/a.md', '../b.md'), '/b.md');
  assert.equal(resolveRelative('/a.md', 'img/p.png'), '/img/p.png');
});

test('resolveRelative decodes percent-escapes', () => {
  assert.equal(resolveRelative('/x/a.md', '%20space.md'), '/x/ space.md');
  assert.equal(resolveRelative('/x/a.md', 'my%20notes.md'), '/x/my notes.md');
});

test('resolveRelative strips query and hash', () => {
  assert.equal(resolveRelative('/x/a.md', 'guide.md#intro'), '/x/guide.md');
  assert.equal(resolveRelative('/x/a.md', 'pic.png?v=2'), '/x/pic.png');
});

test('resolveRelative returns null for URLs and anchors', () => {
  assert.equal(resolveRelative('/x/a.md', 'https://e.com/x'), null);
  assert.equal(resolveRelative('/x/a.md', 'http://e.com/x'), null);
  assert.equal(resolveRelative('/x/a.md', 'mailto:a@b.c'), null);
  assert.equal(resolveRelative('/x/a.md', 'data:image/png;base64,AA'), null);
  assert.equal(resolveRelative('/x/a.md', 'file:///etc/passwd'), null);
  assert.equal(resolveRelative('/x/a.md', '//host/share'), null);
  assert.equal(resolveRelative('/x/a.md', '#h'), null);
  assert.equal(resolveRelative('/x/a.md', ''), null);
  assert.equal(resolveRelative(null, 'b.md'), null);
});

test('resolveRelative treats a leading slash as absolute only on POSIX docs', () => {
  assert.equal(resolveRelative('/x/a.md', '/y/b.md'), '/y/b.md');
  assert.equal(resolveRelative('C:\\x\\a.md', '/y/b.md'), null);
});

test('dirname and basename', () => {
  assert.equal(dirname('/x/y/a.md'), '/x/y');
  assert.equal(dirname('C:\\x\\a.md'), 'C:\\x');
  assert.equal(basename('C:\\x\\a.md'), 'a.md');
  assert.equal(basename('/x/y/a.md'), 'a.md');
  assert.equal(basename('a.md'), 'a.md');
});

test('isMarkdownPath', () => {
  assert.equal(isMarkdownPath('A.MARKDOWN'), true);
  assert.equal(isMarkdownPath('x/b.md'), true);
  assert.equal(isMarkdownPath('a.txt'), false);
  assert.equal(isMarkdownPath('md'), false);
});

test('resolveRelative keeps the leading \\\\ of a UNC document path', () => {
  assert.equal(resolveRelative('\\\\server\\share\\a.md', 'img/x.png'), '\\\\server\\share\\img\\x.png');
  assert.equal(resolveRelative('\\\\server\\share\\d\\a.md', '../b.md'), '\\\\server\\share\\b.md');
  // The share is the root: .. never climbs above it.
  assert.equal(resolveRelative('\\\\server\\share\\a.md', '../../b.md'), '\\\\server\\share\\b.md');
});
