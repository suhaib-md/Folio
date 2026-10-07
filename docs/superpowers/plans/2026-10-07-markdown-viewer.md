# Markdown Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single offline `md-viewer.html` that opens a Markdown file (Open button or drag-drop) and renders it safely.

**Architecture:** Source lives in `src/` as small ES modules. `src/render.js` is a pure renderer (Markdown text → sanitised HTML) that takes a `window` so it can be tested under jsdom and reused by the future Tauri app. `src/main.js` wires up the UI. `build.mjs` bundles with esbuild and inlines the JS and CSS into `dist/md-viewer.html`.

**Tech Stack:** Node 24, esbuild 0.28, marked 18 + marked-highlight 2 + marked-gfm-heading-id 4, DOMPurify 3, highlight.js 11 (`lib/common`), node:test + jsdom 30 for tests.

**Spec:** `docs/superpowers/specs/2026-10-07-markdown-viewer-design.md`

## Global Constraints

- Output is ONE file, `dist/md-viewer.html`, with no external requests (no CDN, no fonts, no `<script src>`/`<link href>` to the network).
- Accepted file types in the picker: `.md`, `.markdown`, `.txt`.
- Error copy, verbatim: `Couldn't read <name>. Is it a text/Markdown file?`
- Empty-state copy: button `Open file`, text `or drop a .md file here`.
- Content column max width `760px`; light/dark via `prefers-color-scheme`.
- No horizontal page scroll at 375px width; tables and `pre` scroll inside themselves.

## Review Focus

1. A heading whose slug clashes with a `document` property (`# Images`, `# Links`, `# Forms`) — DOMPurify's clobbering guard would strip its id; with `SANITIZE_NAMED_PROPS` ids get a `user-content-` prefix, and `#images` links must still scroll to it. (Task 1 test + Task 2 click handler.)
2. Two headings with the same text — ids must be unique (`intro`, `intro-1`) and must not carry over between files. (Task 1 test.)
3. A file saved by Windows Notepad with a UTF-8 BOM and CRLF line endings — the first heading must still render as a heading. (Task 1 test.)
4. `[x](javascript:alert(1))`, `<img src=x onerror=...>`, `<script>`, `<iframe>` in a file — all neutralised. (Task 1 test.)
5. Dragging something that isn't a file (selected text, a link) onto the window — nothing breaks, current document stays. (Task 2 manual check.)

---

### Task 1: Project setup + renderer

**Files:**
- Create: `package.json`, `.gitignore` (`node_modules/`, `dist/`)
- Create: `src/render.js`
- Test: `tests/render.test.mjs`

**Interfaces:**
- Produces: `export function createRenderer(win: Window): (text: string) => string` in `src/render.js`. Each call to the returned function renders one full document.

- [ ] **Step 1:** `git init`; create `package.json` (`"type": "module"`, scripts `"test": "node --test tests/"`, `"build": "node build.mjs"`); `npm i marked marked-highlight marked-gfm-heading-id dompurify highlight.js`; `npm i -D esbuild jsdom`.

- [ ] **Step 2: Write the failing tests** in `tests/render.test.mjs`, with `const render = createRenderer(new JSDOM('').window)`:
  - `renders GFM`: a table → contains `<table>`; `- [x] done` → contains `type="checkbox"` and `checked`; `~~s~~` → `<del>`.
  - `highlights code`: ```` ```js\nconst a = 1\n``` ```` → contains `class="hljs language-js"` and `hljs-keyword`.
  - `heading ids`: `# Hello World` → `id="user-content-hello-world"`.
  - `clashing heading keeps id`: `# Images` → `id="user-content-images"`.
  - `duplicate headings unique`: `# Intro\n# Intro` → contains `user-content-intro"` and `user-content-intro-1"`; a second `render('# Intro')` call → `user-content-intro"` (no `-2`, slugger resets).
  - `BOM and CRLF`: `'﻿# Title\r\n\r\ntext'` → starts with `<h1`.
  - `sanitises`: input with `<script>alert(1)</script>`, `<img src=x onerror="alert(1)">`, `[x](javascript:alert(1))`, `<iframe src="https://e.com">` → output has no `<script`, no `onerror`, no `javascript:`, no `<iframe`.
  - `external links open in new tab`: `[a](https://example.com)` → contains `target="_blank"` and `rel="noopener noreferrer"`; `[b](#intro)` → no `target`.
  - `empty input`: `render('')` → `''`.

- [ ] **Step 3:** Run `npm test`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `createRenderer(win)`** in `src/render.js`: a new `Marked` instance with `markedHighlight({ emptyLangClass: 'hljs', langPrefix: 'hljs language-', highlight })` (highlight with `hljs.highlight` when the language is registered, else `hljs.highlightAuto`) and `gfmHeadingId()`; `DOMPurify(win)` with `SANITIZE_NAMED_PROPS: true` and an `afterSanitizeAttributes` hook that adds `target="_blank"` + `rel="noopener noreferrer"` to `a[href^="http"]`. Strip a leading `﻿` before parsing. If the slugger doesn't reset between calls, call `resetHeadings()` from `marked-gfm-heading-id` before each parse.

- [ ] **Step 5:** Run `npm test`. Expected: all PASS.

- [ ] **Step 6:** Commit `feat: markdown renderer with sanitising and highlighting`.

### Task 2: Page, UI and build

**Files:**
- Create: `src/index.html` (template with `/*__CSS__*/` and `/*__JS__*/` markers), `src/styles.css`, `src/main.js`, `build.mjs`, `tests/sample.md`

**Interfaces:**
- Consumes: `createRenderer(window)` from Task 1.
- Produces: `dist/md-viewer.html`.

- [ ] **Step 1:** `src/main.js` holds the units from the spec: `readFile(file): Promise<string>` (`file.text()`), `showDocument(name, html)` (fills `<article>`, shows top bar with name, sets `document.title` to the name, scrolls to top), `showError(message)` (shows a banner; keeps any current document). Open button triggers a hidden `<input type=file accept=".md,.markdown,.txt">`. `dragover`/`drop` on `window` with a visible drop highlight; on drop take `dataTransfer.files[0]`, ignore drops with no files. A file that fails to read, or whose text contains `\u0000`, gets the error copy from Global Constraints. Clicks on `a[href^="#"]` scroll to `#user-content-<hash>` (falling back to `#<hash>`).

- [ ] **Step 2:** `src/styles.css`: CSS variables on `:root` for light, redefined under `@media (prefers-color-scheme: dark)`; system font stack; 760px column, 16px side gutter; `table` and `pre` get `overflow-x: auto` and `display: block` for tables; images `max-width: 100%`; highlight.js token colours for both themes (copy the `github` and `github-dark` palettes as variables).

- [ ] **Step 3:** `build.mjs`: esbuild bundle `src/main.js` (iife, minify, `write: false`), read `styles.css`, substitute both into `src/index.html`, write `dist/md-viewer.html`. Escape any `</script` in the bundle as `<\/script`.

- [ ] **Step 4:** `tests/sample.md` covering every item in the spec's Testing section, including a `# Images` heading with a `[jump](#images)` link and two `## Intro` headings.

- [ ] **Step 5:** Run `npm test && npm run build`. Expected: tests pass; `dist/md-viewer.html` exists; `grep -c 'src="http\|href="http' dist/md-viewer.html` on the template portion shows no external resources.

- [ ] **Step 6: Browser check** (built-in browser, `file:///…/dist/md-viewer.html`): empty state shows; load `sample.md` via the file input (`form_input`/JS `DataTransfer`) → renders; no `alert` fired; `#images` link scrolls; dark scheme readable; at 375px wide `document.documentElement.scrollWidth <= 375`; simulate a drop with no files → current doc unchanged; no network requests listed.

- [ ] **Step 7:** Commit `feat: md-viewer page with open and drag-drop`.
