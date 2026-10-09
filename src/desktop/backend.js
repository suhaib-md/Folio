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
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch as relaunchApp } from '@tauri-apps/plugin-process';
import * as fake from './fake-backend.js';

const MARKDOWN_FILTER = { name: 'Markdown', extensions: ['md', 'markdown'] };
const HTML_FILTER = { name: 'HTML', extensions: ['html'] };

const real = {
  launchPaths: () => invoke('launch_paths'),
  readFile: (path) => invoke('read_file', { path }),
  writeFile: (path, text, eol, bom) => invoke('write_file', { path, text, eol, bom }),
  writeImage: (path, base64) => invoke('write_image', { path, base64 }),
  readImageBase64: (path) => invoke('read_image', { path }),
  createFile: (path) => invoke('create_file', { path }),
  createDir: (path) => invoke('create_dir', { path }),
  renamePath: (from, to) => invoke('rename_path', { from, to }),
  trashPath: (path) => invoke('trash_path', { path }),
  revealPath: (path) => revealItemInDir(path),
  listTree: (folder) => invoke('list_tree', { folder }),
  searchFolder: (folder, query, matchCase, requestId) =>
    invoke('search_folder', { folder, query, matchCase, requestId }),
  watch: (files, folder) => invoke('watch', { files, folder }),
  recentGet: () => invoke('recent_get'),
  recentAdd: (path, kind) => invoke('recent_add', { path, kind }),
  recentRemove: (path) => invoke('recent_remove', { path }),
  draftsList: () => invoke('drafts_list'),
  draftSave: (draft) => invoke('draft_save', { draft }),
  draftDelete: (id) => invoke('draft_delete', { id }),
  settingsGet: () => invoke('settings_get'),
  settingsSet: (settings) => invoke('settings_set', { settings }),
  appInfo: () => invoke('app_info'),

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
  async pickExportPath(defaultName) {
    return (await save({ defaultPath: defaultName, filters: [HTML_FILTER] })) || null;
  },
  openExternal: (url) => openUrl(url),
  // { version, download(onProgress), install() } or null. Only works once the updater
  // plugin is registered (a public key in tauri.conf.json); callers check
  // appInfo().updaterConfigured first. onProgress gets a 0..1 fraction, or
  // null when the download size is unknown.
  async checkUpdate() {
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      download: (onProgress) => {
        let total = 0;
        let done = 0;
        return update.download((e) => {
          if (e.event === 'Started') total = e.data.contentLength || 0;
          else if (e.event === 'Progress') {
            done += e.data.chunkLength;
            onProgress(total ? done / total : null);
          }
        });
      },
      install: () => update.install(),
    };
  },
  relaunch: () => relaunchApp(),
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
  // 'light' | 'dark' forces the title bar theme, null follows the system.
  setWindowTheme: (theme) => getCurrentWindow().setTheme(theme),
};

export const isDesktop = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const impl = isDesktop ? real : fake;

export const launchPaths = () => impl.launchPaths();
export const readFile = (path) => impl.readFile(path);
export const writeFile = (path, text, eol, bom) => impl.writeFile(path, text, eol, bom);
export const writeImage = (path, base64) => impl.writeImage(path, base64);
export const readImageBase64 = (path) => impl.readImageBase64(path);
export const createFile = (path) => impl.createFile(path);
export const createDir = (path) => impl.createDir(path);
export const renamePath = (from, to) => impl.renamePath(from, to);
export const trashPath = (path) => impl.trashPath(path);
export const revealPath = (path) => impl.revealPath(path);
export const listTree = (folder) => impl.listTree(folder);
// Request ids must increase monotonically, also across webview reloads (the
// Rust side keeps the highest id seen and cancels any lower one); callers
// seed them from Date.now().
export const searchFolder = (folder, query, matchCase, requestId) =>
  impl.searchFolder(folder, query, matchCase, requestId);
export const watch = (files, folder) => impl.watch(files, folder);
export const recentGet = () => impl.recentGet();
export const recentAdd = (path, kind) => impl.recentAdd(path, kind);
export const recentRemove = (path) => impl.recentRemove(path);
export const draftsList = () => impl.draftsList();
export const draftSave = (draft) => impl.draftSave(draft);
export const draftDelete = (id) => impl.draftDelete(id);
export const settingsGet = () => impl.settingsGet();
export const settingsSet = (settings) => impl.settingsSet(settings);
export const appInfo = () => impl.appInfo();
export const pickFiles = () => impl.pickFiles();
export const pickFolder = () => impl.pickFolder();
export const pickSavePath = (defaultName) => impl.pickSavePath(defaultName);
export const pickExportPath = (defaultName) => impl.pickExportPath(defaultName);
export const openExternal = (url) => impl.openExternal(url);
export const checkUpdate = () => impl.checkUpdate();
export const relaunch = () => impl.relaunch();
export const assetUrl = (path) => impl.assetUrl(path);
export const onOpenPaths = (cb) => impl.onOpenPaths(cb);
export const onFileChanged = (cb) => impl.onFileChanged(cb);
export const onFolderChanged = (cb) => impl.onFolderChanged(cb);
export const onDragDrop = (cb) => impl.onDragDrop(cb);
export const onCloseRequested = (cb) => impl.onCloseRequested(cb);
export const closeWindow = () => impl.closeWindow();
export const setTitle = (t) => impl.setTitle(t);
export const setWindowTheme = (theme) => impl.setWindowTheme(theme);
