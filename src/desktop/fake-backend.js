// In-memory stand-in for the Tauri backend, used when the desktop UI runs in
// a plain browser (development and browser checks). Same API as backend.js.
//
// Test hooks on window.__fake:
//   fs                 plain object, path -> file text (images: data URLs)
//   emit(event, data)  fire 'open-paths', 'file-changed', 'folder-changed',
//                      'drag-drop' (payload: paths)
//   requestClose()     simulate the window close button
//   opened, watched, closed, recent   what the app asked for
// URL flags: ?failWrites=1 makes writeFile reject with "permission denied";
// ?open=/a.md,/b.md sets the launch paths.

const PIC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAC6UlEQVR42u3YUxZdWRhF4byWEdupOKnYNq917HOt2EkZLdw/dleqGzUyVhe+tzlXfNE3X/bNV33zdWm+Kc23pfmuNN+XZuPcbJqbzXOzZW62zmjbjLbPaMeM1ue0IaONGW3KaHNGWzLamtK2lA5M6OCEDk3o8JiOjOnomI6N6fiI9sd0IKaDMR2K6XDERyI+GvHPEV8Y8sUBXxrw5QFfGfDVAV/r8/U+nwv4fMAXfL7o8yWfL/t8xeerHj8o+GHBjwp+XHAll2outVzqudxz5b4jDxx56MgjRx47UulJtSduKl4qfiJBImEiUSJxIkksvY44HXE74nXEb2vQ1rCtUVtHkY5DnYY6C3Ue6iLQZaBPAh02ddTUcUMnDZ02dNbQeUMXdX3r6TtP33v6wdOPrv3k2l9c+6trX1ftm6p9W7XvqvZ91X6o2I8V+6liVwAa0IAGNKABDWhAA/qzgl65NKuWZvXSrFmYtQuzbmHWL8yGhfmhMD8WZmVhVhVmdU5rclqb07qcds5o15R2T2nPlH6a0t4p7ZvQ/gltT2lHSjtT2pXQ7oT2JLQ3oX0xnRjRyRGdGtHpEZ0Z8tkhnxvy+SEfi/h4yCdCPhnyqZBPh3wm4LMB3+jzzT7fKvl2yXdKvlvyvZLvF3zN4+se3/D4pse3XLntyh1X7rrSyKWZSSuTdiadTLqZ9FJxUqn1pN6TRleaXWl1pd2VTle6HUljyWLJYyliKSPtRzqIdBhp3NakpVlL85YWLS2b2m/qoKlPA30W6HNfX/j60tdXvr729Y2ny7o+qevTuj6r6/OafVGzL2v2Vc3+5tjfHfuHY/907F+O/btn/+nZf3uABjSgAQ1oQAMa0ID+zKARLChDQAMa0IAGNKABDWhA40ejDAENaEADGtCABjSgAY0fjTIENKABDWhAAxrQgAY0fjTKENCABjSgAQ1oQAMa0PjRCBaUIaABDWhAAxrQgAY0fjSCBWUIaEAD+n8H/R9PQyBWRm317gAAAABJRU5ErkJggg==';

const README = `# Folio demo

This is the **fake backend** README. It lets the desktop shell run in a
plain browser.

- Read the [guide](guide.md) next.
- Open [my todo list](notes/todo.md).
- Jump to the [table section](#a-table).
- Visit [example.com](https://example.com) (opens externally).

![pic](img/pic.png)

## Some code

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

## A table

| Shortcut | Action |
|---|---|
| Ctrl+O | Open file |
| Ctrl+W | Close tab |
| Ctrl+Tab | Next tab |

## The end

That's all. [Back to the top](#folio-demo).
`;

const GUIDE = `# Guide

How to use Folio.

1. Open a file.
2. Read it.
3. Follow links to other [files](README.md).

> Tabs keep their scroll position when you switch between them.
`;

const TODO = `# Todo

- [x] Tab model
- [ ] Editor
- [ ] Save
- [ ] Watcher

Back to the [README](../README.md).
`;

const listeners = new Map();
const fs = {
  '/demo/README.md': README,
  '/demo/guide.md': GUIDE,
  '/demo/notes/todo.md': TODO,
  '/demo/img/pic.png': PIC,
};
let recent = { files: [], folders: [] };
let closeHandler = null;

const params = new URLSearchParams(globalThis.location?.search || '');
const isImage = (text) => typeof text === 'string' && text.startsWith('data:');
const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase();

function emit(event, payload) {
  for (const cb of listeners.get(event) || []) cb(payload);
}

function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return Promise.resolve(() => listeners.get(event).delete(cb));
}

const fake = {
  fs,
  emit,
  opened: [],
  watched: null,
  closed: false,
  get recent() {
    return structuredClone(recent);
  },
  async requestClose() {
    const allow = closeHandler ? await closeHandler() : true;
    if (allow) fake.closed = true;
    return allow;
  },
};
if (typeof window !== 'undefined' && !window.__TAURI_INTERNALS__) window.__fake = fake;

export const isDesktop = false;

export async function launchPaths() {
  const open = params.get('open');
  return open ? open.split(',').filter(Boolean) : [];
}

export async function readFile(path) {
  if (!(path in fs)) throw 'The system cannot find the file specified. (os error 2)';
  const text = fs[path];
  if (isImage(text) || text.includes('\u0000')) throw 'stream did not contain valid UTF-8';
  return { text, eol: 'lf', bom: false };
}

export async function writeFile(path, text /* , eol, bom */) {
  if (params.get('failWrites') === '1') throw 'permission denied';
  fs[path] = text;
}

export async function listTree(folder) {
  const prefix = folder.replace(/\/+$/, '') + '/';
  const root = { name: folder.split('/').pop() || folder, path: folder, kind: 'dir', children: [] };
  const files = Object.keys(fs).filter((p) => p.startsWith(prefix) && /\.(md|markdown)$/i.test(p));
  for (const file of files) {
    let node = root;
    const parts = file.slice(prefix.length).split('/');
    parts.forEach((name, i) => {
      const path = prefix + parts.slice(0, i + 1).join('/');
      if (i === parts.length - 1) {
        node.children.push({ name, path, kind: 'file' });
        return;
      }
      let dir = node.children.find((c) => c.kind === 'dir' && c.name === name);
      if (!dir) {
        dir = { name, path, kind: 'dir', children: [] };
        node.children.push(dir);
      }
      node = dir;
    });
  }
  const sort = (n) => {
    if (!n.children) return;
    n.children.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    n.children.forEach(sort);
  };
  sort(root);
  return { root, truncated: false };
}

export async function watch(files, folder) {
  fake.watched = { files: [...files], folder };
}

export async function recentGet() {
  return structuredClone(recent);
}

export async function recentAdd(path, kind) {
  const key = kind === 'folder' ? 'folders' : 'files';
  const cap = kind === 'folder' ? 5 : 10;
  const list = recent[key].filter((p) => norm(p) !== norm(path));
  recent = { ...recent, [key]: [path, ...list].slice(0, cap) };
  return recentGet();
}

export async function recentRemove(path) {
  recent = {
    files: recent.files.filter((p) => norm(p) !== norm(path)),
    folders: recent.folders.filter((p) => norm(p) !== norm(path)),
  };
  return recentGet();
}

export async function pickFiles() {
  return ['/demo/README.md'];
}

export async function pickFolder() {
  return '/demo';
}

export async function pickSavePath(/* defaultName */) {
  return '/demo/saved.md';
}

export async function openExternal(url) {
  fake.opened.push(url);
}

export function assetUrl(path) {
  return isImage(fs[path]) ? fs[path] : path;
}

export const onOpenPaths = (cb) => on('open-paths', cb);
export const onFileChanged = (cb) => on('file-changed', cb);
export const onFolderChanged = (cb) => on('folder-changed', cb);
export const onDragDrop = (cb) => on('drag-drop', cb);

export async function onCloseRequested(cb) {
  closeHandler = cb;
  return () => {
    if (closeHandler === cb) closeHandler = null;
  };
}

export async function closeWindow() {
  fake.closed = true;
}

export async function setTitle(t) {
  document.title = t;
}
