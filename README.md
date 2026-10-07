# Folio

A simple, offline Markdown viewer. One HTML file, no install.

Open `folio.html` in Edge or Chrome, then click **Open file**, press
**Ctrl+O**, or drag a `.md` file onto the window.

- GitHub-style rendering: tables, task lists, strikethrough, code highlighting
- Light and dark themes that follow your system setting
- Works with no internet connection
- Safe: HTML inside a Markdown file is sanitised, so a file can't run scripts

## Build

Requires Node.js.

```bash
npm install
npm run build   # writes dist/folio.html
npm test
```

## Known limitations

- Images with relative paths (`![](images/pic.png)`) don't load yet; web
  (`https://`) images do.
- Viewing only. Editing, a folder sidebar and double-click-to-open are
  planned for a Tauri desktop version.

## Layout

- `src/render.js`: Markdown → sanitised HTML (`createRenderer(window)`)
- `src/main.js`: open button, drag-and-drop, anchor links
- `src/index.html`, `src/styles.css`: page template and styles
- `build.mjs`: bundles everything into one file
- `docs/superpowers/`: design spec and implementation plan
