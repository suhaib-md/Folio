import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

execFileSync(process.execPath, ['build.mjs']);
const html = readFileSync('dist/md-viewer.html', 'utf8');

function load() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  return dom.window;
}

async function dropFile(win, text, name) {
  const ev = new win.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', {
    value: { types: ['Files'], files: [new win.File([text], name)] },
  });
  win.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 100));
}

test('built page renders the sample file', async () => {
  const win = load();
  await dropFile(win, readFileSync('tests/sample.md', 'utf8'), 'sample.md');
  const $ = (id) => win.document.getElementById(id);
  assert.equal($('error').hidden, true, $('error').textContent);
  assert.equal($('filename').textContent, 'sample.md');
  assert.equal(win.document.title, 'sample.md');
  assert.match($('doc').innerHTML, /<h1 id="user-content-sample-document">/);
  assert.equal(win.__pwned, undefined);
});

test('built page shows an error for binary files', async () => {
  const win = load();
  await dropFile(win, 'PK\u0003\u0004\u0000\u0000', 'archive.zip');
  const error = win.document.getElementById('error');
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, "Couldn't read archive.zip. Is it a text/Markdown file?");
});
