# Folio Desktop — Design

Date: 2026-10-07
Status: Draft — awaiting review
Builds on: `2026-10-07-markdown-viewer-design.md` (the single-file viewer)

## Goal

Turn Folio into an installed Windows app: double-clicking a `.md` file opens
it in Folio, files open as tabs, and each tab can be read, edited and saved.
Also: a folder sidebar, a recent-files list, and live reload when a file
changes on disk.

## Decisions already made

| Topic | Decision |
|---|---|
| Shell | Tauri 2, Windows only for now |
| Editing | Per-tab mode: **Read** (default) / **Edit** / **Split** (source + live preview) |
| Saving | Explicit Ctrl+S; dirty dot; Save / Don't save / Cancel on close |
| Multiple files | Tabs in a single window (single instance) |
| Extras in v1 | New + Save As, reload on external change, folder sidebar, recent files |

## Success criteria

1. Running the installer, then choosing *Open with → Folio → Always* once,
   makes double-clicking any `.md` / `.markdown` file open it in Folio.
2. Double-clicking a second file while Folio is open adds a tab to the
   existing window instead of starting a second window.
3. A file can be edited and saved with Ctrl+S; the bytes on disk differ from
   the original only where the user typed (line endings and UTF-8 BOM
   preserved).
4. No unsaved edit is lost without the user choosing *Don't save*.
5. Works offline. Markdown content can't run scripts.
6. The single-file web viewer (`dist/folio.html`) still builds and works.

## Windows constraints (say these to the user, don't fight them)

- Since Windows 10, apps can't make themselves the default handler. The
  installer *registers* Folio for `.md` and `.markdown`; the user picks it
  once in *Open with*.
- The installer isn't code-signed, so SmartScreen shows "Windows protected
  your PC" on first run (*More info → Run anyway*). Signing is out of scope.

## Architecture

```
src/
  render.js            shared Markdown → safe HTML (unchanged API)
  styles.css           shared document + theme styles
  main.js, index.html  single-file web viewer (unchanged)
  desktop/
    index.html         app shell
    app.css            app chrome: tab bar, sidebar, toolbar, modal, banners
    main.js            wiring: events, shortcuts, rendering of UI state
    tabs.js            pure tab-list model (no DOM)
    reload.js          pure "what to do when a file changed" decision
    editor.js          CodeMirror 6 wrapper (one EditorState per tab)
    sidebar.js         folder tree view
    recent.js          recent list view on the start screen
    backend.js         the ONLY module that calls Tauri; has a fake for browsers
src-tauri/
  src/lib.rs           app setup, plugins, command registration
  src/files.rs         read/write with EOL+BOM handling, atomic save
  src/tree.rs          Markdown folder tree
  src/recent.rs        recent files/folders store
  src/watch.rs         file + folder watching (notify crate)
  tauri.conf.json      bundle, file associations, CSP, asset scope
build.mjs              also bundles src/desktop → dist-desktop/
```

Frontend is plain ES modules bundled by esbuild (same as today), no
framework.

### Rust ↔ frontend contract (`backend.js` mirrors this 1:1)

Commands:

| Command | Args | Returns |
|---|---|---|
| `launch_paths` | — | `string[]` file/folder paths from the command line |
| `read_file` | `path` | `{ text, eol: "lf" \| "crlf", bom: bool }` — `text` has LF endings, no BOM. Error string if missing / not UTF-8 / contains NUL |
| `write_file` | `path, text, eol, bom` | `()` — converts LF→CRLF if `eol=="crlf"`, prepends BOM if `bom`, writes `<name>.folio-tmp` in the same folder then renames over the target |
| `list_tree` | `folder` | `TreeNode { name, path, kind: "dir" \| "file", children? }` |
| `watch` | `files: string[], folder: string \| null` | `()` — replaces the watched set |
| `recent_get` | — | `{ files: string[], folders: string[] }` |
| `recent_add` | `path, kind: "file" \| "folder"` | updated recent |
| `recent_remove` | `path` | updated recent |

Events (Rust → frontend):

| Event | Payload |
|---|---|
| `open-paths` | `string[]` — from a second launch (single-instance) |
| `file-changed` | `{ path, kind: "modified" \| "removed" }` (debounced ~300 ms) |
| `folder-changed` | `{ folder }` (debounced ~500 ms) |

Plugins: `tauri-plugin-single-instance` (forward argv → `open-paths`),
`tauri-plugin-dialog` (open/save dialogs), `tauri-plugin-opener` (open
`http(s)` links in the default browser). Drag-and-drop uses Tauri's
window drag-drop event (gives real paths).

## Tabs

Tab: `{ id, path | null, title, text, savedText, eol, bom, mode, scrollTop, banner | null }`.

- `dirty` = `text !== savedText`.
- New untitled tabs are titled `Untitled-1`, `Untitled-2`, … and start in
  **Edit**; files start in **Read**.
- Opening a path that's already open activates that tab (paths compared
  case-insensitively, separators normalised).
- Closing the active tab activates the tab to its right, else left.
- With zero tabs the start screen shows: Open file, Open folder, New file,
  and the recent lists.
- Window title: `● name — Folio` when dirty, `name — Folio` otherwise,
  `Folio` with no tabs. Tabs show `●` when dirty.
- Tab bar scrolls horizontally when it overflows; middle-click closes a tab.

## Modes

- **Read:** rendered document (today's view), 760px column.
- **Edit:** CodeMirror with Markdown highlighting, line wrapping on, no line
  numbers, Ctrl+F search, undo history kept per tab.
- **Split:** editor left, preview right (50/50), preview re-renders 150 ms
  after typing stops. Below 900px window width Split falls back to Edit.
- Ctrl+E toggles Read ↔ Edit (from Split goes to Read). Ctrl+\ toggles
  Split on/off. A three-way switch in the toolbar does the same.

## Rendering in the desktop app

- Uses `createRenderer(window)` unchanged.
- After rendering, relative `img` sources are resolved against the
  document's folder and converted with `convertFileSrc` (asset protocol).
  The asset scope only allows image extensions: png, jpg, jpeg, gif, webp,
  svg, bmp, ico, avif.
- Link clicks: `#anchor` scrolls (as today); a relative link to a `.md` /
  `.markdown` file opens it in a tab; `http(s)` and `mailto:` go to the
  system via the opener plugin; anything else does nothing.
- Untitled tabs have no folder, so relative images/links show as broken.

## Saving

- **Ctrl+S:** save; if untitled, behaves as Save As.
- **Ctrl+Shift+S (Save As):** dialog filtered to `*.md`, `*.markdown`;
  default name = tab title + `.md`. On success the tab's path, title and
  watch entry update and the file goes into recent.
- **Ctrl+N:** new untitled tab (eol `lf`, no BOM).
- Write failure (read-only, permission, disk full): tab stays dirty, error
  banner in the tab: `Couldn't save <name>: <reason>`.
- **Closing a dirty tab** (Ctrl+W, ×, middle-click) shows an in-app modal:
  `Save changes to <name>?` — **Save** / **Don't save** / **Cancel**. Save
  that fails or a cancelled Save As dialog keeps the tab open.
- **Closing the window** intercepts the close, then runs the same modal for
  each dirty tab in order; any Cancel aborts the whole close.

## External changes (reload.js)

Pure decision `decide(tab, event, diskText) → action`:

| Situation | Action |
|---|---|
| `modified`, `diskText === savedText` | `ignore` (our own save or no real change) |
| `modified`, not dirty | `reload` (replace text + savedText, keep scroll/mode) |
| `modified`, dirty | `ask` → banner *"<name> changed on disk."* **Reload** / **Keep mine** |
| `removed` | `removed` → banner *"<name> was deleted or moved."*; `savedText` is cleared so the tab is dirty and closing prompts |

*Keep mine* sets `savedText = diskText` so the next save overwrites knowingly
and the tab stays dirty.

## Folder sidebar

- Ctrl+Shift+O (or start-screen button, or dropping a folder) opens a
  folder; one folder at a time. Ctrl+B shows/hides the sidebar.
- `list_tree` includes `.md` / `.markdown` files and folders that contain
  them (recursively); skips names starting with `.`, `node_modules`, and
  stops after 5000 entries (sidebar shows "Folder too large — showing first
  5000 items"). Sorted folders first, then files, case-insensitive.
- Folders start collapsed except the root; clicking a file opens/activates
  its tab; the active tab's file is highlighted.
- `folder-changed` re-lists and keeps expanded folders expanded.
- Sidebar width 260px; hidden automatically below 700px window width.

## Recent

- Stored in the app config dir as `recent.json`: up to 10 files, 5 folders,
  most recent first, de-duplicated (case-insensitive).
- Added on: opening a file (any way), Save As, opening a folder.
- Start screen lists them with the file name and a dimmed parent path.
- Clicking an entry that no longer exists removes it and shows
  `<name> no longer exists.` in a dismissible banner.

## Errors

- Read failure → no tab is opened; dismissible app-level banner
  `Couldn't open <name>. Is it a text/Markdown file?`.
- Dropping a non-Markdown file is allowed (`.txt` etc. open as text);
  binary content hits the read error above.
- Everything failing in Rust returns a readable string, never panics.

## Security

- Same sanitiser as the web viewer (DOMPurify, no `style`/`form`).
- CSP: `default-src 'self'; img-src 'self' asset: http://asset.localhost https: data:; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost`.
- Rendered content can't call Tauri: only bundled code can, and the
  sanitiser removes scripts and event handlers.
- The asset protocol is limited to image extensions.

## Keyboard shortcuts

Ctrl+O open file · Ctrl+Shift+O open folder · Ctrl+N new · Ctrl+S save ·
Ctrl+Shift+S save as · Ctrl+W close tab · Ctrl+Tab / Ctrl+Shift+Tab next /
previous tab · Ctrl+E read ↔ edit · Ctrl+\ split · Ctrl+B sidebar ·
Ctrl+F find (in Edit/Split).

## Packaging

- NSIS installer, per-user install (no admin prompt).
- File associations: `md`, `markdown` (name "Markdown document", role
  Editor).
- App identifier `com.suhaib.folio`, version `0.2.0`, product name `Folio`.
- App icon generated with `tauri icon` from a source image in the repo.
- Output: `src-tauri/target/release/bundle/nsis/Folio_0.2.0_x64-setup.exe`.

## Testing

- **Rust (`cargo test`):** EOL detection and round-trip, BOM round-trip,
  atomic write replaces content and leaves no temp file, non-UTF-8 and NUL
  rejected, tree filtering/sorting/limit, recent cap + de-dup + remove.
- **JS (`npm test`):** existing renderer/build tests; `tabs.js` (open,
  focus existing incl. case/separator differences, untitled numbering,
  dirty, close-activation order); `reload.js` decision table; desktop
  bundle builds.
- **Browser check:** the desktop UI loaded in the built-in browser with the
  fake backend: tabs, modes, split preview, modal flow, banners, sidebar,
  recent, light/dark.
- **Real build:** `tauri build` produces the installer.
- **User checklist (can't be automated from here):** install, set *Open
  with*, double-click a file, double-click a second file → tab, edit + save
  → check file in Notepad, close with unsaved changes → prompt.

## Out of scope

Code signing, auto-update, macOS/Linux builds, autosave / crash recovery,
multiple folders in the sidebar, file operations in the sidebar (rename,
delete, new file in folder), export to PDF/HTML, spell check.

## Delivery phases

Each phase ends with a working app:

1. Desktop shell + install + double-click + tabs (read only).
2. Edit / Split modes, Save, Save As, New, close prompts.
3. External change detection and reload.
4. Folder sidebar and recent files.
