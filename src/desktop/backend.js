// The ONLY module that talks to Tauri. Mirrors the Rust command/event
// contract 1:1. In a plain browser (no window.__TAURI_INTERNALS__) every call
// goes to the in-memory fake instead, so the UI can be developed and checked
// without the desktop app. The @tauri-apps imports are safe in a browser:
// they only touch Tauri internals when called.
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import * as fake from './fake-backend.js';

const MARKDOWN_FILTER = { name: 'Markdown', extensions: ['md', 'markdown'] };

const real = {
  launchPaths: () => invoke('launch_paths'),
  readFile: (path) => invoke('read_file', { path }),
  writeFile: (path, text, eol, bom) => invoke('write_file', { path, text, eol, bom }),
  listTree: (folder) => invoke('list_tree', { folder }),
  watch: (files, folder) => invoke('watch', { files, folder }),
  recentGet: () => invoke('recent_get'),
  recentAdd: (path, kind) => invoke('recent_add', { path, kind }),
  recentRemove: (path) => invoke('recent_remove', { path }),

  async pickFiles() {
    const picked = await open({
      multiple: true,
      filters: [MARKDOWN_FILTER, { name: 'All files', extensions: ['*'] }],
    });
    if (!picked) return [];
    return Array.isArray(picked) ? picked : [picked];
  },
  async pickFolder() {
    return (await open({ directory: true })) || null;
  },
  async pickSavePath(defaultName) {
    return (await save({ defaultPath: defaultName, filters: [MARKDOWN_FILTER] })) || null;
  },
  openExternal: (url) => openUrl(url),
  assetUrl: (path) => convertFileSrc(path),

  onOpenPaths: (cb) => listen('open-paths', (e) => cb(e.payload)),
  onFileChanged: (cb) => listen('file-changed', (e) => cb(e.payload)),
  onFolderChanged: (cb) => listen('folder-changed', (e) => cb(e.payload)),
  onDragDrop: (cb) =>
    getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'drop') cb(e.payload.paths);
    }),
  // cb resolves true to let the window close, false to keep it open.
  onCloseRequested: (cb) =>
    getCurrentWindow().onCloseRequested(async (e) => {
      if (!(await cb())) e.preventDefault();
    }),
  // destroy() skips the close-requested handler (we already asked).
  closeWindow: () => getCurrentWindow().destroy(),
  setTitle: (t) => getCurrentWindow().setTitle(t),
};

export const isDesktop = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const impl = isDesktop ? real : fake;

export const launchPaths = () => impl.launchPaths();
export const readFile = (path) => impl.readFile(path);
export const writeFile = (path, text, eol, bom) => impl.writeFile(path, text, eol, bom);
export const listTree = (folder) => impl.listTree(folder);
export const watch = (files, folder) => impl.watch(files, folder);
export const recentGet = () => impl.recentGet();
export const recentAdd = (path, kind) => impl.recentAdd(path, kind);
export const recentRemove = (path) => impl.recentRemove(path);
export const pickFiles = () => impl.pickFiles();
export const pickFolder = () => impl.pickFolder();
export const pickSavePath = (defaultName) => impl.pickSavePath(defaultName);
export const openExternal = (url) => impl.openExternal(url);
export const assetUrl = (path) => impl.assetUrl(path);
export const onOpenPaths = (cb) => impl.onOpenPaths(cb);
export const onFileChanged = (cb) => impl.onFileChanged(cb);
export const onFolderChanged = (cb) => impl.onFolderChanged(cb);
export const onDragDrop = (cb) => impl.onDragDrop(cb);
export const onCloseRequested = (cb) => impl.onCloseRequested(cb);
export const closeWindow = () => impl.closeWindow();
export const setTitle = (t) => impl.setTitle(t);
