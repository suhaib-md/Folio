# Folio Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installable Windows Tauri app for Folio: double-click to open `.md` files as tabs, Read/Edit/Split per tab, save, external-change reload, folder sidebar, recent files.

**Architecture:** Pure Rust logic (file I/O with EOL/BOM, folder tree, recent store, watcher) lives in a `folio-core` crate with no Tauri dependency so it tests anywhere. The Tauri app crate (`src-tauri`) is a thin layer of commands/events over it. The frontend is plain ES modules in `src/desktop/`, bundled by the existing `build.mjs`; all Tauri calls go through `backend.js`, which has an in-memory fake so the UI runs and is checked in a normal browser. A GitHub Actions job on `windows-latest` builds the installer.

**Tech Stack:** Tauri 2 (crates `tauri = "2"` with `protocol-asset`, `tauri-build = "2"`, `tauri-plugin-single-instance = "2"`, `tauri-plugin-dialog = "2"`, `tauri-plugin-opener = "2"`), `notify = "8"` + `notify-debouncer-mini = "0.7"`, `serde`/`serde_json`, `tempfile` (dev); npm `@tauri-apps/cli@^2.12`, `@tauri-apps/api@^2.12`, `@tauri-apps/plugin-dialog@^2.8`, `@tauri-apps/plugin-opener@^2.7`, `codemirror@^6.0.2`, `@codemirror/lang-markdown@^6.5`, `@codemirror/language-data@^6.5`; existing esbuild, marked, DOMPurify, highlight.js, jsdom, node:test.

**Spec:** `docs/superpowers/specs/2026-10-07-folio-desktop-design.md` — read it before Task 1; copy strings, sizes and shortcuts from it verbatim.

## Execution environment

This plan is expected to run in a **Linux cloud session**, not on Windows.

- Install once: `sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev build-essential pkg-config` (needed for `cargo check` of the Tauri crate; `folio-core` needs none of it).
- The desktop app **cannot be launched** here (no Windows/WebView2). UI is verified in a browser against the fake backend; the app crate is verified with `cargo check`/`cargo clippy`; the installer is produced and verified by the CI workflow (Task 9) on `windows-latest`.
- Push the branch `desktop` after each task so CI and the user can follow along.

## Global Constraints

- Windows-only bundle: NSIS, `installMode: "currentUser"`; identifier `com.suhaib.folio`; productName `Folio`; version `0.2.0`.
- File associations: `ext: ["md", "markdown"]`, name `Markdown document`, role `Editor`.
- `src/render.js` API is unchanged (`createRenderer(win)`); `dist/folio.html` must still build and its tests stay green.
- Only `src/desktop/backend.js` imports `@tauri-apps/*`.
- Copy, verbatim from the spec: `Couldn't open <name>. Is it a text/Markdown file?` · `Couldn't save <name>: <reason>` · `Save changes to <name>?` with **Save** / **Don't save** / **Cancel** · `<name> changed on disk.` with **Reload** / **Keep mine** · `<name> was deleted or moved.` · `<name> no longer exists.` · `Folder too large — showing first 5000 items`.
- Shortcuts, verbatim from the spec's Keyboard shortcuts section.
- Sizes: content column 760px; sidebar 260px; Split falls back to Edit below 900px; sidebar auto-hides below 700px; split preview debounce 150 ms; watcher debounce ~300 ms files / ~500 ms folders.
- New untitled tabs: eol `lf`, no BOM, mode Edit. Opened files: mode Read.
- Recent: max 10 files, 5 folders, case-insensitive de-dup, most recent first.
- Tree: `.md`/`.markdown` only; skip names starting with `.` and `node_modules`; cap 5000 entries; folders first, case-insensitive sort.

## Review Focus

1. **Paths with spaces, non-ASCII, mixed case and `/` vs `\`** (the user's own profile is `C:\Users\Muhammed suhaib\…`) — opening the same file twice must focus one tab, and relative images in such folders must load. Tests in Task 3 (`normalizePath`) and Task 4 (`resolveRelative`).
2. **Saving over a read-only file** — returns an error, leaves the original untouched and no `.folio-tmp` behind; tab stays dirty with the save banner. Test in Task 1; banner checked in Task 6.
3. **A CRLF file saved then re-read by the watcher** — must not raise `changed on disk.`: `read_file` normalises to LF so `diskText === savedText`. Test in Task 1 (round-trip) and Task 7 (`decide` → `ignore`).
4. **Double-clicking a second file during startup or while a modal is open** — the path must not be lost. Task 2 registers single-instance first; Task 4 subscribes to `open-paths` before calling `launch_paths` and queues opens while a modal is up (test in Task 4).
5. **A multi-MB file in Split mode** — typing stays responsive: preview is debounced and only the active tab renders. Manual timing check in Task 5 (5 MB fake file; keystroke-to-paint stays under ~50 ms with preview lagging by the debounce).

---

## Phase 1 — Desktop shell, install, double-click, tabs (read only)

### Task 1: `folio-core` crate — files, tree, recent

**Files:**
- Create: `src-tauri/folio-core/Cargo.toml` (lib `folio_core`; deps `serde` (derive), `serde_json`; dev-deps `tempfile`)
- Create: `src-tauri/folio-core/src/lib.rs`, `files.rs`, `tree.rs`, `recent.rs`
- Modify: `.gitignore` (add `target/`, `dist-desktop/`)

**Interfaces:**
- Produces:
  - `files::ReadResult { text: String, eol: Eol, bom: bool }` (Serialize, camelCase), `enum Eol { Lf, Crlf }` (serialised `"lf"`/`"crlf"`)
  - `files::read_file(path: &Path) -> Result<ReadResult, String>`
  - `files::write_file(path: &Path, text: &str, eol: Eol, bom: bool) -> Result<(), String>`
  - `tree::TreeNode { name, path, kind: "dir"|"file", children: Option<Vec<TreeNode>> }`, `tree::list_tree(root: &Path, limit: usize) -> Result<(TreeNode, bool /*truncated*/), String>`
  - `recent::Recent { files: Vec<String>, folders: Vec<String> }`, `Recent::load(path) -> Recent` (missing/corrupt → empty), `save(&self, path) -> Result<(), String>`, `add(&mut self, p: &str, kind: Kind)`, `remove(&mut self, p: &str)`

- [ ] **Step 1: Write failing tests** (in each module's `#[cfg(test)]`, using `tempfile::tempdir()`):
  - `read_crlf_normalises`: file `"a\r\nb\r\n"` → `text == "a\nb\n"`, `eol == Crlf`, `bom == false`.
  - `read_lf`: `"a\nb"` → `eol == Lf`.
  - `read_bom_stripped`: bytes `EF BB BF` + `"# T"` → `text == "# T"`, `bom == true`.
  - `read_rejects_non_utf8`: bytes `[0xff, 0xfe, 0x41]` → `Err`.
  - `read_rejects_nul`: `"a\0b"` → `Err`.
  - `write_round_trip_crlf_bom`: `write_file(p, "a\nb\n", Crlf, true)` → bytes `EF BB BF 61 0D 0A 62 0D 0A`; `read_file(p)` → `text == "a\nb\n"`.
  - `write_replaces_and_leaves_no_temp`: existing file `"old"` → write `"new"` → content `"new"`; dir contains no `*.folio-tmp`.
  - `write_readonly_fails_cleanly`: file `"orig"` set read-only → `write_file` is `Err`, content still `"orig"`, no `*.folio-tmp` left. (On Linux run as non-root; mark the test `#[cfg_attr(target_os = "linux", ignore)]` only if the runner is root — note it in the ledger.)
  - `tree_filters_and_sorts`: dirs `b/`, `A/x.md`, `.git/y.md`, `node_modules/z.md`, `empty/` (no md), files `c.MD`, `a.markdown`, `n.txt` → root children in order `A` (dir), `a.markdown`, `c.MD`; no `b`, `empty`, `.git`, `node_modules`, `n.txt`.
  - `tree_truncates`: 10 md files, `limit = 3` → 3 file nodes, `truncated == true`.
  - `recent_caps_and_dedups`: add 12 files → 10 kept, newest first; re-adding `"C:\\X\\a.md"` as `"c:\\x\\A.md"` moves it to front without duplicate; folders cap at 5.
  - `recent_remove` and `recent_load_corrupt_is_empty`.
- [ ] **Step 2:** `cargo test --manifest-path src-tauri/folio-core/Cargo.toml` → FAIL (unresolved functions).
- [ ] **Step 3: Implement.** EOL = `Crlf` if the text contains `"\r\n"`, else `Lf`. `write_file`: build bytes, write `<file_name>.folio-tmp` in the same directory, `fs::rename` over the target; on any error remove the temp file before returning. If the target exists and is read-only, return `Err` before writing (rename would otherwise succeed on some platforms). `list_tree` walks depth-first counting file nodes toward `limit`; a dir is included only if it (recursively) contains an included file. Error strings are human-readable (e.g. `"not UTF-8"`, `"file contains binary data"`, `"permission denied"`).
- [ ] **Step 4:** Re-run the cargo test command → all PASS.
- [ ] **Step 5:** Commit `feat(core): file io with eol/bom, markdown tree, recent store`; push.

### Task 2: Tauri app crate, config, packaging

**Files:**
- Create: `src-tauri/Cargo.toml` (package `folio`, deps: `folio-core = { path = "folio-core" }`, tauri crates per Tech Stack, `serde`, `serde_json`; build-dep `tauri-build`), `src-tauri/build.rs`, `src-tauri/src/main.rs` (`#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`, calls `folio::run()`), `src-tauri/src/lib.rs`
- Create: `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`
- Create: `assets/folio-icon.svg` (simple: rounded square, accent `#0969da`, white folded-page glyph), generated `src-tauri/icons/*`
- Modify: `package.json` (devDeps `@tauri-apps/cli`; deps `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-opener`; scripts `"build:desktop": "node build.mjs --desktop"`, `"tauri": "tauri"`)
- Test: `tests/tauri-config.test.mjs`

**Interfaces:**
- Consumes: `folio_core::{files, tree, recent}` from Task 1.
- Produces Tauri commands exactly as in the spec's contract table: `launch_paths`, `read_file`, `write_file`, `list_tree` (returns `{ root: TreeNode, truncated: bool }`), `recent_get`, `recent_add`, `recent_remove` (`watch` arrives in Task 7). Event `open-paths: string[]`.

- [ ] **Step 1: Write failing test** `tests/tauri-config.test.mjs` reading `src-tauri/tauri.conf.json`:
  - `identity`: `identifier === 'com.suhaib.folio'`, `productName === 'Folio'`, `version === '0.2.0'`.
  - `bundle`: `targets` deep-equals `['nsis']`; `windows.nsis.installMode === 'currentUser'`; `fileAssociations[0].ext` deep-equals `['md','markdown']`, `.name === 'Markdown document'`, `.role === 'Editor'`.
  - `frontend`: `build.frontendDist === '../dist-desktop'`, `build.beforeBuildCommand === 'npm run build:desktop'`.
  - `security`: `app.security.csp` equals the spec's CSP string; `assetProtocol.enable === true`; `assetProtocol.scope` contains `**/*.png` and `**/*.svg` and no entry without an image extension.
- [ ] **Step 2:** `npm test` → the new test FAILS (file missing).
- [ ] **Step 3: Implement.** `lib.rs::run()`: register `tauri_plugin_single_instance::init(|app, argv, _cwd| emit "open-paths" with argv[1..] filtered to existing paths, then unminimize + focus the main window)` **first**, then `tauri_plugin_dialog::init()`, `tauri_plugin_opener::init()`. `launch_paths` returns `std::env::args().skip(1)` filtered to existing paths. Recent file = `app.path().app_config_dir()/recent.json` (create dir). Commands map core errors to `String`. Window: title `Folio`, 1100×760, min 480×360. Capabilities: `core:default`, `core:window:allow-destroy`, `core:window:allow-set-title`, `dialog:default`, `opener:default`. Icon: `npx tauri icon assets/folio-icon.svg` (if the CLI rejects SVG, rasterise to a 1024px PNG first with `npx @resvg/resvg-js-cli` and ledger the ruling).
- [ ] **Step 4:** `npm test` → PASS. `cargo check --manifest-path src-tauri/Cargo.toml` → no errors (needs the apt packages). `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` → clean.
- [ ] **Step 5:** Commit `feat(desktop): tauri app crate, commands, packaging config`; push.

### Task 3: `tabs.js` — pure tab model

**Files:**
- Create: `src/desktop/tabs.js`
- Test: `tests/tabs.test.mjs`

**Interfaces:**
- Produces (all pure, returning new state; state = `{ tabs: Tab[], activeId: string|null, untitledCounter: number }`):
  - `normalizePath(p: string): string` — `\`→`/`, collapse duplicate `/`, lower-case.
  - `createState()`
  - `openFile(state, { path, text, eol, bom }) -> state` (activates existing tab if `normalizePath` matches; new tab mode `read`, title = basename)
  - `newUntitled(state) -> state` (title `Untitled-N`, mode `edit`, eol `lf`, bom `false`)
  - `setText(state, id, text)`, `setMode(state, id, mode)`, `markSaved(state, id, { path?, text })` (updates path/title when given), `setBanner(state, id, banner|null)`, `clearSaved(state, id)` (savedText → `null`)
  - `isDirty(tab) -> boolean` (`text !== savedText`)
  - `closeTab(state, id) -> state` (activates right neighbour, else left, else `null`)
  - `activate(state, id)`, `cycle(state, +1|-1)`
  - `windowTitle(state) -> string` (`● name — Folio` / `name — Folio` / `Folio`)
  - `findByPath(state, path) -> Tab|undefined`

- [ ] **Step 1: Write failing tests:** `open adds read tab`; `open same path focuses existing` (`'C:\\Users\\Muhammed suhaib\\Notes\\A.md'` then `'c:/users/muhammed suhaib/notes/a.md'` → 1 tab, active); `untitled numbering` (two → `Untitled-1`, `Untitled-2`, both mode `edit`, eol `lf`); `dirty tracking` (setText differs → dirty; markSaved → clean); `markSaved renames` (path set, title = basename); `clearSaved makes dirty`; `close activates right then left` (tabs A,B,C active B → close → C; close C → A; close A → `activeId === null`); `cycle wraps`; `window title` (three cases, with `●` and em dash `—`).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement; ids via an incrementing counter in state (no randomness).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(desktop): tab model`; push.

### Task 4: Backend layer, desktop shell UI (read only), desktop build

**Files:**
- Create: `src/desktop/backend.js`, `src/desktop/fake-backend.js`, `src/desktop/paths.js`, `src/desktop/main.js`, `src/desktop/index.html`, `src/desktop/app.css`
- Modify: `build.mjs` (`--desktop` flag: bundle `src/desktop/main.js` as ESM to `dist-desktop/app.js`, copy `index.html`, concatenate `src/styles.css` + `src/desktop/app.css` → `dist-desktop/app.css`; default run keeps building `dist/folio.html` exactly as today)
- Test: `tests/paths.test.mjs`, `tests/desktop-build.test.mjs`

**Interfaces:**
- Consumes: `createRenderer` (render.js), tab functions (Task 3), commands/events (Task 2).
- Produces:
  - `backend.js` exports `isDesktop: boolean` and async `launchPaths()`, `readFile(path)`, `writeFile(path, text, eol, bom)`, `listTree(folder)`, `watch(files, folder)`, `recentGet()`, `recentAdd(path, kind)`, `recentRemove(path)`, `pickFiles()`, `pickFolder()`, `pickSavePath(defaultName)`, `openExternal(url)`, `assetUrl(path)`, `onOpenPaths(cb)`, `onFileChanged(cb)`, `onFolderChanged(cb)`, `onDragDrop(cb: (paths) => void)`, `onCloseRequested(cb: () => Promise<boolean /*allow*/>)`, `closeWindow()`, `setTitle(t)`. Real implementation when `window.__TAURI_INTERNALS__` exists, else re-exports `fake-backend.js`.
  - `fake-backend.js`: in-memory FS seeded with `/demo/README.md` (links to `guide.md` and an image `img/pic.png` as a data URL), `/demo/guide.md`, `/demo/notes/todo.md`; `?failWrites=1` makes `writeFile` reject with `"permission denied"`; `window.__fake = { emit(event, payload), fs }` for tests; `pickFiles` returns `['/demo/README.md']`, `pickSavePath` returns `'/demo/saved.md'`.
  - `paths.js`: `dirname(p)`, `basename(p)`, `resolveRelative(docPath, href) -> string|null` (null for absolute URLs/anchors), `isMarkdownPath(p)`.

- [ ] **Step 1: Write failing tests:**
  - `paths.test.mjs`: `resolveRelative('C:\\Users\\Muhammed suhaib\\Notes\\a.md', 'img/p 1.png') === 'C:\\Users\\Muhammed suhaib\\Notes\\img\\p 1.png'`; `'../b.md'` from `'/x/y/a.md'` → `'/x/b.md'`; `'%20space.md'` is decoded; `'https://e.com/x'` and `'#h'` → `null`; `isMarkdownPath('A.MARKDOWN') === true`, `('a.txt') === false`.
  - `desktop-build.test.mjs`: runs `node build.mjs --desktop`; `dist-desktop/index.html`, `app.js`, `app.css` exist; every `src/desktop/*.js` file except `backend.js` has no `@tauri-apps` import (Global Constraint); running `node build.mjs` still produces `dist/folio.html` with one `</body>`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3: Implement the shell.** Layout: top tab bar (scrolls horizontally; `●` for dirty; × close; middle-click close) + toolbar row (file name, mode switch placeholder hidden until Task 5) + content area; start screen when no tabs with **Open file**, **Open folder** (disabled until Task 8), **New file** (disabled until Task 6). Startup: subscribe `onOpenPaths` → then `launchPaths()` → open each. Opening queue: if a modal is open (Task 6), queue and flush when it closes — implement the queue now with a `modalOpen` flag. Read-only render path: `renderMarkdown(tab.text)`, then rewrite relative `img[src]` via `resolveRelative` + `assetUrl`; link clicks: `#` → scroll (reuse today's logic), relative `.md` → open tab, `http(s)`/`mailto:` → `openExternal`, else prevent. Shortcuts: Ctrl+O, Ctrl+W, Ctrl+Tab/Ctrl+Shift+Tab. Drag-drop via `onDragDrop`. Title via `setTitle(windowTitle(state))`. Read errors → app banner with the spec copy. Keep the per-tab scroll position when switching tabs.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Browser check** (serve the repo root with `python3 -m http.server`, open `/dist-desktop/index.html`): start screen shows; Open file opens README in Read; clicking the `guide.md` link opens a second tab; opening README again focuses it; image renders; Ctrl+W closes; `__fake.emit('open-paths', ['/demo/notes/todo.md'])` opens a tab; light + dark; 480px width has no horizontal page scroll.
- [ ] **Step 6:** Commit `feat(desktop): backend layer and tabbed read-only shell`; push.

## Phase 2 — Editing and saving

### Task 5: Editor and Read / Edit / Split modes

**Files:**
- Create: `src/desktop/editor.js`
- Modify: `src/desktop/main.js`, `src/desktop/app.css`, `package.json` (codemirror deps)

**Interfaces:**
- Produces `editor.js`: `createEditor(parent: HTMLElement, { onChange(text) }) -> { show(tabId, text), getText(), focus(), destroyState(tabId) }` — keeps one `EditorState` per tab id (undo history survives tab switches); extensions: `basicSetup` minus line numbers/fold gutter, `markdown({ codeLanguages: languages })`, `EditorView.lineWrapping`, theme via CSS variables from `styles.css`.

- [ ] **Step 1: Failing test** in `tests/tabs.test.mjs`: `setMode accepts read|edit|split and rejects others` (unknown mode leaves state unchanged).
- [ ] **Step 2:** `npm test` → FAIL; **Step 3:** implement `setMode` guard + editor + mode switch (toolbar three-way switch; Ctrl+E, Ctrl+\\ per spec; Split = editor left / preview right, preview debounced 150 ms, falls back to Edit below 900px; only the active tab renders); `npm test` → PASS.
- [ ] **Step 4: Browser check:** typing in Edit marks the tab `●`; Split preview updates after typing stops; switching tabs and back keeps text and undo (Ctrl+Z); Ctrl+F opens search; Review Focus 5 timing with a 5 MB fake file (`__fake.fs['/demo/big.md'] = …`).
- [ ] **Step 5:** Commit `feat(desktop): editor with read/edit/split modes`; push.

### Task 6: Save, Save As, New, close prompts

**Files:**
- Create: `src/desktop/modal.js` (`confirmSave(name) -> Promise<'save'|'discard'|'cancel'>`, focus-trapped, Esc = cancel, Enter = Save)
- Create: `src/desktop/closing.js` (pure: `planWindowClose(state) -> Tab[]` dirty tabs in tab order)
- Modify: `src/desktop/main.js`, `src/desktop/app.css`
- Test: `tests/closing.test.mjs`

**Interfaces:**
- Consumes: `markSaved`, `isDirty`, `closeTab`, `newUntitled` (Task 3); `writeFile`, `pickSavePath`, `recentAdd`, `onCloseRequested`, `closeWindow` (Task 4).

- [ ] **Step 1: Failing tests:** `planWindowClose returns dirty tabs in order` (tabs clean, dirty A, clean, dirty B → `[A, B]`); `no dirty tabs → []`.
- [ ] **Step 2:** `npm test` → FAIL; **Step 3:** implement. `save(tab)`: untitled → Save As; else `writeFile(tab.path, tab.text, tab.eol, tab.bom)` → `markSaved`; on error `setBanner` with `Couldn't save <name>: <reason>`. Save As: `pickSavePath(title + '.md')`, cancelled → return false. `closeTabFlow(tab)`: dirty → `confirmSave` → save (abort close if it fails/cancels) / discard / cancel. Window close: `onCloseRequested` runs `closeTabFlow` for each tab from `planWindowClose`; any cancel → return false. Enable **New file** and Ctrl+N, Ctrl+S, Ctrl+Shift+S. Flush the open-queue when the modal closes. `npm test` → PASS.
- [ ] **Step 4: Browser check:** Ctrl+N → `Untitled-1` in Edit; type; Ctrl+S → saved as `/demo/saved.md`, title updates, no `●`; edit + Ctrl+W → modal with exact copy; Cancel keeps tab; Don't save closes; `?failWrites=1` → banner `Couldn't save README.md: permission denied`, tab stays `●`; `__fake.emit('open-paths', …)` while the modal is open opens the tab after the modal closes.
- [ ] **Step 5:** Commit `feat(desktop): save, save as, new, close prompts`; push.

## Phase 3 — External changes

### Task 7: Watcher and reload decisions

**Files:**
- Create: `src-tauri/folio-core/src/watch.rs` (deps `notify`, `notify-debouncer-mini`)
- Create: `src/desktop/reload.js`
- Modify: `src-tauri/src/lib.rs` (command `watch`, events `file-changed`, `folder-changed`), `src/desktop/main.js`
- Test: Rust tests in `watch.rs`; `tests/reload.test.mjs`

**Interfaces:**
- Produces: `watch::Watcher::new(on_event: impl Fn(WatchEvent) + Send + 'static) -> Result<Watcher, String>`, `Watcher::set(&mut self, files: Vec<PathBuf>, folder: Option<PathBuf>)`; `WatchEvent::File { path, kind: Modified|Removed }`, `WatchEvent::Folder { folder }`. JS: `decide(tab, kind, diskText) -> 'ignore'|'reload'|'ask'|'removed'`.

- [ ] **Step 1: Failing tests:**
  - `reload.test.mjs` — the spec's decision table row by row, plus `CRLF-normalised disk text equal to savedText → ignore` (Review Focus 3).
  - `watch.rs` — `modify_emits_file_event` (watch a temp file, append, receive `File{Modified}` within 3 s); `delete_emits_removed`; `set_replaces_watch_set` (after `set` without the file, modifying it emits nothing within 1.5 s); `folder_add_emits_folder_event`.
- [ ] **Step 2:** run both suites → FAIL; **Step 3:** implement (watch each file's parent dir non-recursively and filter by path, folder recursively; debounce 300 ms files / 500 ms folders; on the JS side re-read with `readFile` then `decide`; banners use the spec copy; *Keep mine* sets `savedText = diskText`; `removed` → `clearSaved`); re-run → PASS. `cargo clippy … -D warnings` clean.
- [ ] **Step 4: Browser check** via `__fake`: change a clean tab's file → reloads silently; change a dirty tab → banner, Reload/Keep mine behave; remove → removed banner and `●`.
- [ ] **Step 5:** Commit `feat(desktop): reload files changed on disk`; push.

## Phase 4 — Sidebar and recent

### Task 8: Folder sidebar and recent files

**Files:**
- Create: `src/desktop/sidebar.js` (`renderTree(container, root, { activePath, expanded: Set, truncated: boolean, onOpen(path), onToggle(path) })`), `src/desktop/recent.js` (`renderRecent(container, recent, { onOpen(path, kind) })`)
- Modify: `src/desktop/main.js`, `src/desktop/app.css`
- Test: `tests/sidebar.test.mjs` (jsdom)

**Interfaces:**
- Consumes: `listTree`, `watch`, `onFolderChanged`, `recentGet/Add/Remove`, `pickFolder` (Task 4); `TreeNode` shape (Task 1).

- [ ] **Step 1: Failing tests (jsdom):** `renders folders collapsed except root`; `clicking a file calls onOpen with its path`; `active file is highlighted`; `expanded set survives re-render`; `truncated shows "Folder too large — showing first 5000 items"`; `renderRecent shows name and dimmed parent`.
- [ ] **Step 2:** `npm test` → FAIL; **Step 3:** implement + wire: Ctrl+Shift+O / start-screen **Open folder** / dropping a folder; Ctrl+B toggle; auto-hide below 700px; `folder-changed` → re-list keeping `expanded`; recent added on open/Save As/open folder; clicking a missing recent entry → `recentRemove` + banner `<name> no longer exists.`; `npm test` → PASS.
- [ ] **Step 4: Browser check:** open `/demo` → tree; click files → tabs; active highlighted; Ctrl+B; start screen recent lists after closing all tabs; missing-entry banner.
- [ ] **Step 5:** Commit `feat(desktop): folder sidebar and recent files`; push.

### Task 9: CI installer build, README, user checklist

**Files:**
- Create: `.github/workflows/desktop.yml`
- Create: `docs/desktop-install-checklist.md`
- Modify: `README.md`

- [ ] **Step 1:** Workflow on `push` to `desktop`/`main`, `pull_request`, `workflow_dispatch`, and tags `v*`: job `test` on `ubuntu-latest` (apt packages, `npm ci`, `npm test`, `cargo test` for folio-core, `cargo clippy` for the app); job `windows` on `windows-latest` (`npm ci`, `npm test`, `npx tauri build`, upload `src-tauri/target/release/bundle/nsis/*.exe` as artifact `Folio-installer`); on `v*` tags use `tauri-apps/tauri-action@v0` to attach the installer to a GitHub Release.
- [ ] **Step 2:** Push; wait for the run (`gh run watch` if `gh` is available, else poll the Actions API). Expected: both jobs green and the `Folio-installer` artifact contains `Folio_0.2.0_x64-setup.exe`. A red run is the code being wrong → systematic-debugging, fix, push again.
- [ ] **Step 3:** README: download/install steps, SmartScreen note, *Open with → Folio → Always*, shortcuts table, build instructions for both targets. Checklist doc = the spec's "User checklist" as checkboxes.
- [ ] **Step 4:** Commit `ci: build windows installer; docs`; push. Open a PR `desktop` → `main` with the checklist in the body.
