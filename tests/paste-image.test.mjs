import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageTarget, imageExtension, savePastedImage } from '../src/desktop/paste-image.js';

const D = new Date(2026, 9, 9, 14, 5, 7); // local 2026-10-09 14:05:07

test('name from doc and date', () => {
  const t = imageTarget('/demo/notes/todo.md', D, 'png');
  assert.equal(t.path, '/demo/notes/images/todo-20261009-140507.png');
  assert.equal(t.link, 'images/todo-20261009-140507.png');
});

test('collision suffix', () => {
  assert.equal(imageTarget('/d/a.md', D, 'png', 1).link, 'images/a-20261009-140507.png');
  assert.equal(imageTarget('/d/a.md', D, 'png', 2).link, 'images/a-20261009-140507-2.png');
  assert.equal(imageTarget('/d/a.md', D, 'jpg', 3).link, 'images/a-20261009-140507-3.jpg');
});

test('link encodes spaces and non-ascii', () => {
  const t = imageTarget('/d/My Notes é.md', D, 'png');
  assert.equal(t.link, 'images/My%20Notes%20%C3%A9-20261009-140507.png');
  assert.equal(t.path, '/d/images/My Notes é-20261009-140507.png');
  assert.equal(imageTarget('/d/a (1)#x.md', D, 'png').link, 'images/a%20%281%29%23x-20261009-140507.png');
});

test('windows doc path keeps backslashes in path, slashes in link', () => {
  const t = imageTarget('C:\\Users\\Me\\Notes\\a b.md', D, 'png');
  assert.equal(t.path, 'C:\\Users\\Me\\Notes\\images\\a b-20261009-140507.png');
  assert.equal(t.link, 'images/a%20b-20261009-140507.png');
});

test('root and extensionless docs', () => {
  assert.equal(imageTarget('/a.md', D, 'png').path, '/images/a-20261009-140507.png');
  assert.equal(imageTarget('/d/README', D, 'png').link, 'images/README-20261009-140507.png');
});

test('imageExtension maps clipboard types', () => {
  assert.equal(imageExtension('image/png'), 'png');
  assert.equal(imageExtension('image/jpeg'), 'jpg');
  assert.equal(imageExtension('image/gif'), 'gif');
  assert.equal(imageExtension('image/webp'), 'webp');
  assert.equal(imageExtension('image/tiff'), null);
});

test('savePastedImage retries on already exists, then returns markdown', async () => {
  const taken = new Set(['/d/images/a-20261009-140507.png', '/d/images/a-20261009-140507-2.png']);
  const calls = [];
  const write = async (p) => {
    calls.push(p);
    if (taken.has(p)) throw 'already exists';
  };
  const md = await savePastedImage('/d/a.md', 'QUJD', 'png', D, write);
  assert.equal(md, '![](images/a-20261009-140507-3.png)');
  assert.equal(calls.length, 3);
});

test('savePastedImage gives up after 50 and passes other errors through', async () => {
  let n = 0;
  await assert.rejects(
    savePastedImage('/d/a.md', 'QUJD', 'png', D, async () => { n++; throw 'already exists'; }),
    /already exists/,
  );
  assert.equal(n, 50);
  await assert.rejects(
    savePastedImage('/d/a.md', 'QUJD', 'png', D, async () => { throw 'permission denied'; }),
    /permission denied/,
  );
});
