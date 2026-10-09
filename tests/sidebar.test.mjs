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

// ---- file operations -------------------------------------------------------

const ctx = (el, x = 10, y = 20) => el.dispatchEvent(
  new el.ownerDocument.defaultView.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
const key = (el, k, o = {}) => el.dispatchEvent(
  new el.ownerDocument.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));

test('context menu callback gets the node, the position and the row', () => {
  const { c } = setup();
  const got = [];
  renderTree(c, root, opts({ onContextMenu: (node, x, y, anchor) => got.push([node.path, x, y, anchor.dataset.path]) }));
  ctx(c.querySelector('[data-path="/demo/guide.md"]'), 11, 22);
  assert.deepEqual(got, [['/demo/guide.md', 11, 22, '/demo/guide.md']]);
  // empty space in the tree: the root folder
  ctx(c.querySelector('.tree-scroll'), 1, 2);
  assert.equal(got[1][0], '/demo');
});

test('Shift+F10, ContextMenu, F2 and Delete on a focused row', () => {
  const { c } = setup();
  const log = [];
  renderTree(c, root, opts({
    onContextMenu: (n) => log.push(['menu', n.path]),
    onRename: (n) => log.push(['rename', n.path]),
    onDelete: (n) => log.push(['delete', n.path]),
  }));
  const row = c.querySelector('[data-path="/demo/guide.md"]');
  key(row, 'F10', { shiftKey: true });
  key(row, 'ContextMenu');
  key(row, 'F2');
  key(row, 'Delete');
  assert.deepEqual(log, [['menu', '/demo/guide.md'], ['menu', '/demo/guide.md'], ['rename', '/demo/guide.md'], ['delete', '/demo/guide.md']]);
});

test('the row more-button and header buttons call back', () => {
  const { c } = setup();
  const log = [];
  renderTree(c, root, opts({
    onContextMenu: (n, x, y, a) => log.push(['menu', n.path, a.tagName]),
    onNew: (kind, parent) => log.push(['new', kind, parent]),
  }));
  c.querySelector('[data-path="/demo/guide.md"]').parentElement.querySelector('.tree-more').click();
  c.querySelector('.sidebar-new-file').click();
  c.querySelector('.sidebar-new-folder').click();
  assert.deepEqual(log, [['menu', '/demo/guide.md', 'BUTTON'], ['new', 'file', '/demo'], ['new', 'dir', '/demo']]);
});

test('inline edit: new row at the top of the folder, Enter commits, Esc cancels', () => {
  const { c } = setup();
  const log = [];
  const ex = new Set([normalizePath('/demo/notes')]);
  renderTree(c, root, opts({
    expanded: ex,
    editing: { parent: '/demo/notes', kind: 'file', initial: '' },
    onCommit: (name, o) => log.push(['commit', name, !!o?.fromBlur]),
    onCancel: () => log.push(['cancel']),
  }));
  const input = c.querySelector('input.tree-input');
  assert.ok(input);
  assert.equal(input.getAttribute('aria-label'), 'New file name');
  // first child of the notes group
  const group = c.querySelector('[data-path="/demo/notes"]').parentElement.querySelector('ul');
  assert.ok(group.firstElementChild.contains(input));
  input.value = 'idea';
  key(input, 'Enter');
  key(input, 'Escape');
  assert.deepEqual(log, [['commit', 'idea', false], ['cancel']]);
});

test('inline edit: blur commits as fromBlur once; an error shows under the input', () => {
  const { c, window } = setup();
  const log = [];
  renderTree(c, root, opts({
    editing: { parent: '/demo', kind: 'dir', initial: 'x', error: 'A name can’t be empty.' },
    onCommit: (name, o) => log.push([name, !!o?.fromBlur]),
    onCancel: () => log.push(['cancel']),
  }));
  const alert = c.querySelector('[role="alert"]');
  assert.equal(alert.textContent, 'A name can’t be empty.');
  const input = c.querySelector('input.tree-input');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  input.dispatchEvent(new window.FocusEvent('blur'));
  input.dispatchEvent(new window.FocusEvent('blur'));
  assert.deepEqual(log, [['x', true]]);
});

test('inline rename replaces the row, preselecting the name without its extension', () => {
  const { c } = setup();
  renderTree(c, root, opts({
    editing: { kind: 'rename', path: '/demo/guide.md', parent: '/demo', initial: 'guide.md' },
  }));
  assert.equal(c.querySelector('[data-path="/demo/guide.md"]'), null);
  const input = c.querySelector('input.tree-input');
  assert.equal(input.value, 'guide.md');
  assert.equal(input.getAttribute('aria-label'), 'Rename guide.md');
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, 5);
});

test('a re-render while editing keeps what was typed', () => {
  const { c } = setup();
  const editing = { parent: '/demo', kind: 'file', initial: '' };
  renderTree(c, root, opts({ editing }));
  c.querySelector('input.tree-input').value = 'half-typed';
  renderTree(c, root, opts({ editing }));
  assert.equal(c.querySelector('input.tree-input').value, 'half-typed');
  // a different edit starts fresh
  renderTree(c, root, opts({ editing: { parent: '/demo', kind: 'dir', initial: '' } }));
  assert.equal(c.querySelector('input.tree-input').value, '');
});
