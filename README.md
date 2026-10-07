# Folio

A simple, offline Markdown viewer. One HTML file, no install.

Open `folio.html` in Edge or Chrome, then click **Open file**, press
**Ctrl+O**, or drag a `.md` file onto the window.

- GitHub-style rendering: tables, task lists, strikethrough, code highlighting
- Light and dark themes that follow your system setting
- Works with no internet connection
- Safe: HTML inside a Markdown file is sanitised, so a file can't run scripts

## Desktop app (Windows)

Folio also ships as a Windows desktop app: double-click a `.md` file to read
it, edit it, and keep a folder sidebar.

**Install**

1. Download the `Folio-installer` artifact from the latest successful run
   under the repo's *Actions* tab (or the installer from a GitHub Release
   once a `v*` tag is published), and unzip it.
2. Run `Folio_0.2.0_x64-setup.exe`. It installs per-user, no admin needed.
3. The installer isn't code-signed, so SmartScreen may warn: click
   **More info → Run anyway**.
4. To make Folio the default: right-click a `.md` file → **Open with →
   Choose another app → Folio → Always**.

**Features**

- Tabs; opening a second file in a running Folio adds a tab to the same window
- Read, Edit (CodeMirror) and side-by-side Split modes
- Saves keep the file's line endings (LF/CRLF) and BOM
- Reloads when a file changes on disk; prompts before closing unsaved work
- Folder sidebar, recent files and folders, relative images

**Keyboard shortcuts**

| Shortcut | Action |
|---|---|
| Ctrl+O | Open file |
| Ctrl+Shift+O | Open folder |
| Ctrl+N | New |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save as |
| Ctrl+W | Close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+E | Read ↔ Edit |
| Ctrl+\ | Split |
| Ctrl+B | Sidebar |
| Ctrl+F | Find (in Edit/Split) |

A manual test list is in `docs/desktop-install-checklist.md`.

## Build

**Web viewer** (requires Node.js):

```bash
npm install
npm run build   # writes dist/folio.html
npm test
```

**Desktop app** (on Windows; requires Rust and Node.js):

```bash
npm ci
npx tauri build
# installer: src-tauri/target/release/bundle/nsis/Folio_0.2.0_x64-setup.exe
```

CI (`.github/workflows/desktop.yml`) runs the tests and builds this
installer on every push and pull request.

## Known limitations

- Web viewer: images with relative paths (`![](images/pic.png)`) don't load
  (the desktop app loads them); web (`https://`) images do. It is view-only.
- Desktop app: Windows only, not code-signed, no auto-update, no autosave.

## Layout

- `src/render.js`: Markdown → sanitised HTML (`createRenderer(window)`)
- `src/main.js`: web viewer: open button, drag-and-drop, anchor links
- `src/index.html`, `src/styles.css`: page template and styles
- `src/desktop/`: desktop app UI (tabs, editor, sidebar, backend bridge)
- `src-tauri/`: Tauri 2 app (Rust) and `folio-core` (file I/O, tree, recent)
- `build.mjs`: bundles the web viewer into one file (`--desktop`: the app UI)
- `docs/superpowers/`: design spec and implementation plan
