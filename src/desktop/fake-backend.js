// In-memory stand-in for the Tauri backend, used when the desktop UI runs in
// a plain browser (development and browser checks). Same API as backend.js.
//
// Test hooks on window.__fake:
//   fs                 plain object, path -> file text (images: data URLs)
//   emit(event, data)  fire 'open-paths', 'file-changed', 'folder-changed',
//                      'drag-drop' (payload: paths)
//   change(path, text) write `text` to fs[path] and fire file-changed
//                      'modified' (as the watcher would, if path is watched)
//   remove(path)       delete fs[path] and fire file-changed 'removed'
//   add(path, text)    create fs[path] (no file-changed: nothing has it open)
//                      Each of change/remove/add also fires folder-changed
//                      (async, like the debounced watcher) when the path is
//                      inside the watched folder.
//   addRecent(path, kind)  put a path on the recent lists without checking
//                      that it exists (simulates an entry deleted since)
//   listTreeCalls      number of listTree calls so far
//   requestClose()     simulate the window close button
//   drafts             (getter) the crash-recovery drafts, oldest first; they
//                      live in localStorage ('folio-fake-drafts'), so a page
//                      reload simulates a crash that keeps them
//   opened, watched, closed, recent   what the app asked for
//   settings            what settings.json would hold (localStorage
//                      'folio-fake-settings'), or null
//   exportPath         set to a path (or null to cancel) to answer the Export
//                      HTML save dialog; unset it answers /demo/<default name>
//   exportDefaultName  the default name the last export dialog was given
//   failWrites         (get/set) writes reject with "permission denied"
// URL flags: ?failWrites=1 makes writeFile and writeImage reject with
// "permission denied";
// ?open=/a.md,/b.md sets the launch paths (files or folders);
// ?truncated=1 makes listTree report a truncated tree;
// ?searchLimit=N sets the searchFolder match limit (default 1000);
// ?slowDrafts=MS delays the crash-recovery drafts listing by MS (startup race checks);
// ?noDrafts=1 turns crash-recovery drafts off (none stored, none restored);
// ?recentFiles=/a.md,/b.md and ?recentFolders=/x seed the recent lists
// (paths need not exist).

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
  '/demo/notes/ideas.md': '# Ideas\n\n- A folder sidebar.\n',
  '/demo/notes/archive/2025 retrospective with a rather long file name.md': '# 2025\n\nLooking back.\n',
  '/demo/notes/drafts.txt': 'not Markdown: not listed',
  '/demo/.git/HEAD.md': 'hidden: not listed',
  '/demo/node_modules/pkg/README.md': 'skipped: not listed',
  '/demo/img/pic.png': PIC,
};
let closeHandler = null;

const params = new URLSearchParams(globalThis.location?.search || '');
const listParam = (name) => (params.get(name) || '').split(',').filter(Boolean);
let recent = { files: listParam('recentFiles'), folders: listParam('recentFolders') };
const isImage = (text) => typeof text === 'string' && text.startsWith('data:');
const norm = (p) => String(p).replace(/\\/g, '/').toLowerCase();

function emit(event, payload) {
  for (const cb of listeners.get(event) || []) cb(payload);
}

// The watcher reports any change inside the watched (sidebar) folder.
function folderChanged(path) {
  const folder = fake.watched?.folder;
  if (folder && norm(path).startsWith(norm(folder).replace(/\/+$/, '') + '/')) {
    setTimeout(() => emit('folder-changed', { folder }), 0);
  }
}

function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return Promise.resolve(() => listeners.get(event).delete(cb));
}

const DRAFTS_KEY = 'folio-fake-drafts';
const draftsOff = params.get('noDrafts') === '1';
const readDrafts = () => {
  try {
    return JSON.parse(globalThis.localStorage.getItem(DRAFTS_KEY)) || {};
  } catch {
    return {};
  }
};
const writeDrafts = (all) => {
  try {
    globalThis.localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: drafts just don't survive
  }
};
const sortedDrafts = () =>
  Object.values(readDrafts()).sort((a, b) => a.savedAt - b.savedAt || (a.id < b.id ? -1 : 1));
const validDraftId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);

const SETTINGS_KEY = 'folio-fake-settings';
const readSettings = () => {
  try {
    return JSON.parse(globalThis.localStorage.getItem(SETTINGS_KEY));
  } catch {
    return null;
  }
};

let failWrites = params.get('failWrites') === '1';

const fake = {
  fs,
  get failWrites() {
    return failWrites;
  },
  set failWrites(v) {
    failWrites = !!v;
  },
  get settings() {
    return readSettings();
  },
  get drafts() {
    return sortedDrafts();
  },
  emit,
  opened: [],
  watched: null,
  closed: false,
  get recent() {
    return structuredClone(recent);
  },
  listTreeCalls: 0,
  change(path, text) {
    fs[path] = text;
    emit('file-changed', { path, kind: 'modified' });
    folderChanged(path);
  },
  remove(path) {
    delete fs[path];
    emit('file-changed', { path, kind: 'removed' });
    folderChanged(path);
  },
  add(path, text) {
    fs[path] = text;
    folderChanged(path);
  },
  addRecent(path, kind) {
    return recentAdd(path, kind);
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

export async function settingsGet() {
  return readSettings() || {};
}

export async function settingsSet(settings) {
  try {
    globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable: settings just don't survive a reload
  }
}

export async function appInfo() {
  return { version: '0.3.0-dev', updaterConfigured: false };
}

export async function readFile(path) {
  // Same error strings as folio-core (files.rs / tree.rs).
  if (!(path in fs)) throw 'file not found';
  const text = fs[path];
  if (isImage(text) || text.includes('\u0000')) throw 'stream did not contain valid UTF-8';
  return { text, eol: 'lf', bom: false };
}

export async function writeFile(path, text /* , eol, bom */) {
  if (failWrites) throw 'permission denied';
  fs[path] = text;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const MIME = { jpg: 'jpeg', svg: 'svg+xml', ico: 'x-icon' };

// Same checks and error strings as folio-core image.rs. Stored as a data URL
// (like the demo picture) so assetUrl can show it.
export async function writeImage(path, base64) {
  const m = IMAGE_EXT.exec(path);
  if (!m) throw 'not an image file';
  if (failWrites) throw 'permission denied';
  if (path in fs) throw 'already exists';
  const ext = m[1].toLowerCase();
  fs[path] = `data:image/${MIME[ext] || ext};base64,${base64}`;
  folderChanged(path);
}

// Same checks and error strings as folio-core image.rs read_image.
export async function readImageBase64(path) {
  if (!IMAGE_EXT.test(path)) throw 'not an image file';
  if (!(path in fs)) throw 'file not found';
  const m = /^data:[^,]*;base64,(.*)$/s.exec(fs[path]);
  if (!m) throw 'not an image file';
  if (m[1].length * 0.75 > 10 * 1024 * 1024) throw 'too large';
  return m[1];
}

// Same rules as the Rust lister: .md/.markdown files, folders only if they
// contain some (recursively), folders named ".*" or node_modules skipped,
// folders first then files, case-insensitive.
export async function listTree(folder) {
  fake.listTreeCalls += 1;
  const base = String(folder).replace(/\/+$/, '') || '/';
  if (base in fs) throw 'not a folder';
  const prefix = base === '/' ? '/' : base + '/';
  const inside = Object.keys(fs).filter((p) => p.startsWith(prefix));
  if (!inside.length) throw 'folder not found';
  const root = { name: base.split('/').pop() || base, path: folder, kind: 'dir', children: [] };
  const skipped = (parts) => parts.slice(0, -1).some((n) => n.startsWith('.') || n === 'node_modules');
  for (const file of inside) {
    const parts = file.slice(prefix.length).split('/');
    if (!/\.(md|markdown)$/i.test(file) || skipped(parts)) continue;
    let node = root;
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
  return { root, truncated: params.get('truncated') === '1' };
}

// Same rules as folio-core search.rs: tree skip rules and order, plain
// substring matching on code points, 200-char windows around each match.
const SEARCH_WINDOW = 200;
const SEARCH_LEAD = 60;
let latestSearch = 0;
const foldChar = (c) => {
  if (c === '\u03c2') return '\u03c3';
  const l = c.toLowerCase();
  return [...l].length === 1 ? l : c;
};

function lineMatches(lineNo, rawLine, query, matchCase, out, limit, total) {
  const chars = [...rawLine.replace(/\r+$/, '')];
  const q = query.length;
  const hay = matchCase ? chars : chars.map(foldChar);
  let i = 0;
  while (i + q <= hay.length) {
    let ok = true;
    for (let k = 0; k < q; k++) {
      if (hay[i + k] !== query[k]) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      i += 1;
      continue;
    }
    if (total.n >= limit) return true;
    total.n += 1;
    let ws = 0;
    let we = chars.length;
    if (chars.length > SEARCH_WINDOW) {
      ws =
        q >= SEARCH_WINDOW
          ? i
          : Math.min(Math.max(i - SEARCH_LEAD, 0, i + q - SEARCH_WINDOW), chars.length - SEARCH_WINDOW);
      we = Math.min(ws + SEARCH_WINDOW, chars.length);
    }
    const start = chars.slice(ws, i).join('').length;
    out.push({
      line: lineNo,
      col: chars.slice(0, i).join('').length,
      text: chars.slice(ws, we).join(''),
      start,
      end: start + chars.slice(i, Math.min(i + q, we)).join('').length,
    });
    i += q;
  }
  return false;
}

export async function searchFolder(folder, query, matchCase, requestId) {
  // Like the Rust side: a request is cancelled once a newer (greater) id exists.
  latestSearch = Math.max(latestSearch, requestId);
  const cancelled = () => latestSearch > requestId;
  await Promise.resolve(); // keep the async shape: a newer call can overtake
  if (cancelled()) throw 'cancelled';
  if (!query) return { requestId, files: [], truncated: false };
  const limit = Number(params.get('searchLimit')) || 1000;
  const q = [...query].map((c) => (matchCase ? c : foldChar(c)));
  const base = String(folder).replace(/\/+$/, '') || '/';
  const prefix = base === '/' ? '/' : base + '/';
  const key = (s) => [s.toLowerCase(), s];
  const cmp = (a, b) => {
    const [la, ra] = key(a);
    const [lb, rb] = key(b);
    return la < lb ? -1 : la > lb ? 1 : ra < rb ? -1 : ra > rb ? 1 : 0;
  };
  // Order like the tree: per folder, subfolders first, then files.
  const orderIn = (paths, pre) => {
    const dirs = new Map();
    const files = [];
    for (const p of paths) {
      const rest = p.slice(pre.length).split('/');
      if (rest.length === 1) files.push(p);
      else {
        if (!dirs.has(rest[0])) dirs.set(rest[0], []);
        dirs.get(rest[0]).push(p);
      }
    }
    const out = [];
    for (const name of [...dirs.keys()].sort(cmp)) out.push(...orderIn(dirs.get(name), pre + name + '/'));
    return out.concat(files.sort((a, b) => cmp(a.split('/').pop(), b.split('/').pop())));
  };
  const skipped = (parts) =>
    parts.slice(0, -1).some((n) => n.startsWith('.') || n === 'node_modules') || parts[parts.length - 1].startsWith('.');
  const candidates = Object.keys(fs).filter((p) => {
    if (!p.startsWith(prefix) || !/\.(md|markdown)$/i.test(p)) return false;
    return !skipped(p.slice(prefix.length).split('/'));
  });
  const files = [];
  const total = { n: 0 };
  let truncated = false;
  for (const path of orderIn(candidates, prefix)) {
    if (cancelled()) throw 'cancelled';
    const text = fs[path];
    if (isImage(text) || text.includes('\u0000')) continue;
    const matches = [];
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lineMatches(i + 1, lines[i], q, matchCase, matches, limit, total)) {
        truncated = true;
        break;
      }
    }
    if (matches.length) files.push({ path, matches });
    if (truncated) break;
  }
  return { requestId, files, truncated };
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

export async function draftsList() {
  const slow = Number(params.get('slowDrafts'));
  if (slow > 0) await new Promise((r) => setTimeout(r, slow));
  return draftsOff ? [] : sortedDrafts();
}

export async function draftSave(draft) {
  if (!validDraftId(draft?.id)) throw 'invalid draft id';
  if (draftsOff) return;
  const all = readDrafts();
  all[draft.id] = structuredClone(draft);
  writeDrafts(all);
}

export async function draftDelete(id) {
  if (!validDraftId(id)) throw 'invalid draft id';
  const all = readDrafts();
  if (id in all) {
    delete all[id];
    writeDrafts(all);
  }
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

// Test hook: window.__fake.exportPath overrides the answer; null cancels.
export async function pickExportPath(defaultName) {
  if ('exportPath' in fake) return fake.exportPath;
  fake.exportDefaultName = defaultName;
  return `/demo/${defaultName}`;
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

export async function setWindowTheme(/* theme */) {}

export async function setTitle(t) {
  document.title = t;
}
