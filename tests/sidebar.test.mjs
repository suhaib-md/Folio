import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderTree } from '../src/desktop/sidebar.js';
import { renderRecent } from '../src/desktop/recent.js';
import { normalizePath } from '../src/desktop/tabs.js';

const root = {
  name: 'demo', path: '/demo', kind: 'dir', children: [
    { name: 'notes', path: '/demo/notes', kind: 'dir', children: [
      { name: 'deep', path: '/demo/notes/deep', kind: 'dir', children: [
        { name: 'x.md', path: '/demo/notes/deep/x.md', kind: 'file' },
      ] },
      { name: 'todo.md', path: '/demo/notes/todo.md', kind: 'file' },
    ] },
    { name: 'guide.md', path: '/demo/guide.md', kind: 'file' },
    { name: 'README.md', path: '/demo/README.md', kind: 'file' },
  ],
};

function setup() {
  const { window } = new JSDOM('<!doctype html><div id="c"></div>');
  return { window, c: window.document.getElementById('c') };
}

const opts = (o = {}) => ({
  activePath: null, expanded: new Set(), truncated: false,
  onOpen() {}, onToggle() {}, ...o,
});
const rowPaths = (c) => [...c.querySelectorAll('.tree-row')].map((r) => r.dataset.path);

test('renders folders collapsed except root', () => {
  const { c } = setup();
  renderTree(c, root, opts());
  assert.equal(c.querySelector('.sidebar-title').textContent, 'demo');
  // Root's children are visible; the "notes" folder's are not.
  assert.deepEqual(rowPaths(c), ['/demo/notes', '/demo/guide.md', '/demo/README.md']);
  const notes = c.querySelector('[data-path="/demo/notes"]');
  assert.equal(notes.tagName, 'BUTTON');
  assert.equal(notes.getAttribute('aria-expanded'), 'false');
  assert.equal(c.querySelector('[data-path="/demo/guide.md"]').hasAttribute('aria-expanded'), false);
});

test('clicking a file calls onOpen with its path', () => {
  const { c } = setup();
  const opened = [];
  const toggled = [];
  renderTree(c, root, opts({ onOpen: (p) => opened.push(p), onToggle: (p) => toggled.push(p) }));
  c.querySelector('[data-path="/demo/guide.md"]').click();
  c.querySelector('[data-path="/demo/notes"]').click();
  assert.deepEqual(opened, ['/demo/guide.md']);
  assert.deepEqual(toggled, ['/demo/notes']);
});

test('active file is highlighted', () => {
  const { c } = setup();
  // Compared normalised: case and separators may differ.
  renderTree(c, root, opts({ activePath: '\\DEMO\\Guide.md' }));
  const current = [...c.querySelectorAll('[aria-current]')];
  assert.deepEqual(current.map((r) => r.dataset.path), ['/demo/guide.md']);
  assert.equal(current[0].getAttribute('aria-current'), 'page');
  assert.ok(current[0].classList.contains('active'));
});

test('expanded set survives re-render', () => {
  const { c } = setup();
  const expanded = new Set(['/demo/notes', '/demo/notes/deep']);
  renderTree(c, root, opts({ expanded }));
  const all = ['/demo/notes', '/demo/notes/deep', '/demo/notes/deep/x.md', '/demo/notes/todo.md',
    '/demo/guide.md', '/demo/README.md'];
  assert.deepEqual(rowPaths(c), all);
  // A re-list returns a new tree object; the same set keeps it open.
  renderTree(c, structuredClone(root), opts({ expanded }));
  assert.deepEqual(rowPaths(c), all);
  assert.equal(c.querySelector('[data-path="/demo/notes"]').getAttribute('aria-expanded'), 'true');
  assert.equal(c.querySelectorAll('.tree-row').length, all.length); // replaced, not appended
});

test('expanded holds normalised paths (case / separators may differ)', () => {
  const { c } = setup();
  // Expanded as "/demo/notes"; the folder reopened as "C:\\Demo" lists it
  // as "C:\\Demo\\Notes".
  const win = JSON.parse(JSON.stringify(root).replaceAll('/demo', 'C:\\\\Demo').replaceAll('/', '\\\\')
    .replaceAll('Demo\\\\notes', 'Demo\\\\Notes'));
  renderTree(c, win, opts({ expanded: new Set([normalizePath('C:/demo/notes')]) }));
  const notes = c.querySelector('.tree-dir');
  assert.equal(notes.dataset.path, 'C:\\Demo\\Notes');
  assert.equal(notes.getAttribute('aria-expanded'), 'true');
  assert.ok(rowPaths(c).includes('C:\\Demo\\Notes\\todo.md'));
});

test('truncated shows "Folder too large — showing first 5000 items"', () => {
  const { c } = setup();
  renderTree(c, root, opts());
  assert.equal(c.querySelector('.sidebar-notice'), null);
  renderTree(c, root, opts({ truncated: true }));
  assert.equal(c.querySelector('.sidebar-notice').textContent, 'Folder too large — showing first 5000 items');
});

test('renderRecent shows name and dimmed parent', () => {
  const { c } = setup();
  const opened = [];
  renderRecent(c, {
    files: ['C:\\Users\\me\\notes\\todo.md', '/demo/guide.md'],
    folders: ['/demo'],
  }, { onOpen: (p, kind) => opened.push([p, kind]) });
  const files = [...c.querySelectorAll('.recent-files .recent-item')];
  assert.deepEqual(files.map((b) => b.querySelector('.recent-name').textContent), ['todo.md', 'guide.md']);
  assert.deepEqual(files.map((b) => b.querySelector('.recent-parent').textContent), ['C:\\Users\\me\\notes', '/demo']);
  assert.equal(files[0].tagName, 'BUTTON');
  assert.equal(files[0].title, 'C:\\Users\\me\\notes\\todo.md');
  const folders = [...c.querySelectorAll('.recent-folders .recent-item')];
  assert.deepEqual(folders.map((b) => b.querySelector('.recent-name').textContent), ['demo']);
  files[1].click();
  folders[0].click();
  assert.deepEqual(opened, [['/demo/guide.md', 'file'], ['/demo', 'folder']]);
  // Nothing recent: nothing shown.
  renderRecent(c, { files: [], folders: [] }, { onOpen() {} });
  assert.equal(c.children.length, 0);
});
