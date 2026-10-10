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

**[⬇ Download the latest Windows installer](https://github.com/suhaib-md/Folio/releases/latest)**

**Install**

1. On the [latest release](https://github.com/suhaib-md/Folio/releases/latest),
   download `Folio_<version>_x64-setup.exe` under *Assets*. (Before the first
   release is published, use the `Folio-installer` artifact from the latest
   successful run under the repo's *Actions* tab, and unzip it.)
2. Run the installer. It installs per-user, no admin needed.
3. The installer isn't code-signed, so SmartScreen may warn: click
   **More info → Run anyway**.
4. To make Folio the default: right-click a `.md` file → **Open with →
   Choose another app → Folio → Always**.

**Features**

- Tabs; opening a second file in a running Folio adds a tab to the same window
- Read, Edit (CodeMirror) and side-by-side Split modes
- Saves keep the file's line endings (LF/CRLF) and BOM
- Reloads when a file changes on disk; prompts before closing unsaved work
- Sidebar with Files, Outline and Search tabs; recent files and folders;
  relative images
- Outline of the document's headings, with the current section highlighted
- Find in Read mode (Ctrl+F), with match count and match-case
- Quick open (Ctrl+P): fuzzy file finder over the open folder
- Search across the folder (Ctrl+Shift+F)
- `other.md#section` links scroll to the section
- Formatting shortcuts: bold, italic, link
- Paste an image into the editor: it is saved next to the file and linked
- Word count and reading time
- Crash recovery: unsaved edits are kept as drafts and offered back on the
  next launch
- Optional autosave (status bar or Settings)
- Zoom (Ctrl+= / Ctrl+- / Ctrl+0) and a System / Light / Dark theme
- A serif (Newsreader) or sans (Geist) reading font, in Settings (Ctrl+,)
- A command palette: Ctrl+P finds files, typing `>` (or Ctrl+Shift+P) runs
  any command
- A status bar with word count, cursor position, line endings, encoding,
  zoom and theme
- Mermaid diagrams and KaTeX maths (`$…$`, `$$…$$`), bundled, offline
- Export to a standalone HTML file, and print (or save as PDF)
- Session restore: reopens your tabs, folder and sidebar
- File operations in the sidebar: new file/folder, rename, delete (to the
  Recycle Bin), show in Explorer
- Auto-update from GitHub Releases

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
| Ctrl+Shift+B | Sidebar |
| Ctrl+Shift+L | Outline |
| Ctrl+Shift+F | Search folder |
| Ctrl+P | Go to file (type `>` for commands) |
| Ctrl+Shift+P | Run a command |
| Ctrl+, | Settings |
| Ctrl+F | Find |
| Ctrl+B | Bold (editor) |
| Ctrl+I | Italic (editor) |
| Ctrl+K | Link (editor) |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| F5 / Ctrl+R | Do nothing (so a reload can't lose edits) |

Print and Export HTML are in the ⋯ menu and the command palette.

**Updates**

Folio checks GitHub Releases for a newer version 10 seconds after it starts.
If there is one, the status bar offers **Install and restart** (it downloads and
verifies the package first, then asks about unsaved work). You can also use
**Check for updates…** in the ⋯ menu. Update packages are signed; the
one-time key setup is in [docs/updater-setup.md](docs/updater-setup.md).
The updater only sees **published** releases, not drafts.

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
# installer: src-tauri/target/release/bundle/nsis/Folio_0.3.0_x64-setup.exe
```

CI (`.github/workflows/desktop.yml`) runs the tests and builds this
installer on every push and pull request.

**Releasing**

0. Commit the updater public key first
   ([docs/updater-setup.md](docs/updater-setup.md)); the release job fails
   without it, because installs built without it can never update.
1. Bump the version in `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/folio-core/Cargo.toml` and `src-tauri/tauri.conf.json`
   (refresh the lock files), and commit.
2. Tag and push the tag: `git tag v0.3.0 && git push origin v0.3.0`.
3. CI builds a signed draft release with the installer, the update package
   and `latest.json` (needs the secrets from
   [docs/updater-setup.md](docs/updater-setup.md)).
4. Check the draft and **publish** it. Installed copies only see published
   releases.

## Known limitations

- Web viewer: images with relative paths (`![](images/pic.png)`) don't load
  (the desktop app loads them); web (`https://`) images do. It is view-only.
- Desktop app: Windows only and not code-signed (SmartScreen warns on
  install).
- Mermaid diagrams and maths render in the desktop app only; the web viewer
  shows them as plain code and text.
- The first update check needs a published release (a draft is invisible to
  the updater).

## Layout

- `src/render.js`: Markdown → sanitised HTML (`createRenderer(window)`)
- `src/main.js`: web viewer: open button, drag-and-drop, anchor links
- `src/index.html`, `src/styles.css`: page template and styles
- `src/desktop/`: desktop app UI: tabs and editor; sidebar (files, outline,
  search); find, command palette, settings dialog, formatting, paste image; crash-recovery drafts,
  autosave, session and settings; theme, zoom, diagrams, maths, export;
  updater; `backend.js` is the only bridge to Tauri (`fake-backend.js` is
  the in-browser stand-in used by tests)
- `src-tauri/`: Tauri 2 app (Rust) and `folio-core` (file I/O, tree, recent,
  folder search, file operations, drafts, settings)
- `build.mjs`: bundles the web viewer into one file (`--desktop`: the app UI)
- `src/desktop/fonts/`: Geist, Geist Mono and Newsreader, bundled with the
  app (SIL Open Font License, texts alongside)
- `docs/superpowers/`: design spec and implementation plan
