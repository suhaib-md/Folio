# Markdown Viewer — Design (v1)

Date: 2026-10-07
Status: Draft — awaiting review

## Goal

A local, offline app for opening and reading Markdown files on Windows.
Viewing only for v1. Editing, a folder sidebar and double-click-to-open
are planned for later, via a Tauri desktop app that reuses this page.

## Success criteria

- Opening `md-viewer.html` in Edge or Chrome shows an empty screen with an
  **Open file** button and a drop zone.
- Choosing or dropping a `.md` / `.markdown` / `.txt` file renders it as
  formatted Markdown within a second for typical files (< 1 MB).
- Works with no internet connection.
- A Markdown file cannot run scripts in the page.

## Approach

One self-contained HTML file. All libraries are inlined so it works offline
and can be copied anywhere.

Libraries (inlined, minified):

- **marked**: Markdown → HTML, GitHub-flavoured (tables, task lists,
  strikethrough, autolinks).
- **DOMPurify**: cleans the generated HTML before it's inserted.
- **highlight.js** (common languages bundle): syntax highlighting for
  fenced code blocks.

## Units

The page's script is split into small functions with one job each:

| Unit | Job | Input → Output |
|---|---|---|
| `readFile(file)` | Read a `File` as UTF-8 text | `File` → `Promise<string>` |
| `renderMarkdown(text)` | Parse + sanitise + highlight | `string` → safe HTML `string` |
| `showDocument(name, html)` | Put the result on screen, set title | — |
| `showError(message)` | Show a readable error in place of the doc | — |
| Open button / drag-drop handlers | Get a `File` from the user, call the above | — |

`renderMarkdown` is the piece the future Tauri app and editor will reuse
unchanged.

## UI

- **Empty state:** centred "Open file" button, plus "or drop a .md file
  here". The whole window accepts drops.
- **Document view:** a slim top bar with the file name and an **Open**
  button. The rendered document sits in a centred column (~760px max) with
  comfortable line height. Dropping another file replaces the current one.
- **Window title** is set to the file name.
- **Theme:** light and dark follow the Windows/browser setting
  (`prefers-color-scheme`). Code highlighting colours match each theme.
- **Links:** external links open in a new tab. In-page `#anchor` links
  scroll to the heading, so headings get ids.
- Usable at narrow window widths (no horizontal page scroll; wide tables
  and code blocks scroll inside themselves).

## Error handling

- Non-text or unreadable file → message: "Couldn't read <name>. Is it a
  text/Markdown file?" The previous document stays if there was one.
- More than one file dropped → open the first one.
- Empty file → render an empty document with the file name shown (not an
  error).

## Known limitations (v1)

- Images with relative paths (`![](images/pic.png)`) won't load, because a
  browser page can't read neighbouring files. Absolute `https://` images
  and `data:` images work. Fixed later by folder access / Tauri.
- No file association: you open the HTML first, then the Markdown file.
- No editing, no saving, no recent-files list.

## Out of scope (later)

- Tauri desktop app with double-click-to-open
- Folder sidebar
- Editing and saving

## Testing

- A `sample.md` covering headings, emphasis, lists, task lists, tables,
  fenced code in several languages, blockquotes, links, an `https` image, a
  relative image (expected to be broken), and an inline `<script>` /
  `onerror` payload (expected to be stripped).
- Load the page in the built-in browser, open `sample.md`, check that it
  renders correctly in light and dark, that no script runs, and that it
  looks right at phone width.
- Check the page works offline (no network requests after load).
