# Folio desktop: install checklist

Manual checks that can't be automated in CI. Run on Windows after each
installer build.

## Install

- [ ] Download the `Folio-installer` artifact from the latest Actions run
      (or the Release asset) and unzip it.
- [ ] Run `Folio_0.3.0_x64-setup.exe`. No admin prompt appears. If
      SmartScreen warns (the installer is not code-signed), click
      **More info → Run anyway**.
- [ ] Folio launches and shows the start screen.

## File association

- [ ] Right-click a `.md` file → **Open with → Choose another app → Folio →
      Always**.
- [ ] Double-click a `.md` file: it opens in Folio in **Read** mode.
- [ ] With Folio still open, double-click a second `.md` file: it opens as
      a new tab in the **same** window (no second window).

## Edit and save

- [ ] **Ctrl+E** to edit, type something, **Ctrl+S**. The tab's `●` clears.
- [ ] Open the same file in Notepad: the change is there and line endings
      are unchanged (a CRLF file is still CRLF, an LF file still LF).
- [ ] Edit again, then close the tab (or the window): the prompt
      **`Save changes to <name>?`** appears with **Save** / **Don't save** /
      **Cancel**, and each button behaves accordingly.
- [ ] Press F5 / Ctrl+R with unsaved edits → nothing reloads, edits stay.

## Optional

- [ ] Edit the open file in Notepad and save: Folio reloads it (or shows
      the "changed on disk" banner if you have unsaved edits).
- [ ] **Ctrl+Shift+O** opens a folder; the sidebar lists its Markdown files.
- [ ] A relative image (`![](images/pic.png)`) displays.
- [ ] A file under a path with spaces opens and saves, e.g.
      `C:\Users\Muhammed suhaib\Documents\note.md`.

## 0.3 features

Navigation

- [ ] **Ctrl+Shift+L** shows the outline; clicking a heading jumps to it, and
      the current section is highlighted as you scroll.
- [ ] **Ctrl+F** in Read mode opens the find bar; typing shows `3 of 12`,
      Enter / F3 goes to the next match, Esc closes it and clears highlights.
- [ ] **Ctrl+P** opens quick open; typing part of a file name lists it,
      Enter opens it.
- [ ] **Ctrl+Shift+F** searches the open folder; clicking a result opens
      the file at the match.
- [ ] A link such as `[x](other.md#section)` opens the file and scrolls to
      that section.
- [ ] **Ctrl+Shift+B** hides and shows the sidebar.

Writing

- [ ] In the editor, **Ctrl+B**, **Ctrl+I** and **Ctrl+K** wrap the
      selection in `**bold**`, `*italic*` and `[text](url)`.
- [ ] Paste a screenshot into a saved file's editor: an `images/` file is
      created next to it and `![](images/...)` is inserted.
- [ ] The toolbar shows a word count and reading time, e.g.
      `1,234 words · 6 min read`.
- [ ] Crash recovery: make unsaved edits, wait 3 seconds, kill Folio from
      Task Manager, relaunch. The tab returns with the edits and the banner
      `Recovered unsaved changes.` (**Keep** / **Discard** both work).
- [ ] ⋯ menu → **Autosave** on: edit a saved file and stop typing; after
      about a second the `●` clears and the file on disk has the change.

Viewing

- [ ] ⋯ menu → **Theme** Light / Dark / System changes the whole app, and
      the choice is still applied after quitting and relaunching.
- [ ] **Ctrl+=**, **Ctrl+-**, **Ctrl+0** change the document text size
      (70% to 200%); the size is kept after relaunching.
- [ ] A `mermaid` code block renders as a diagram; `$E=mc^2$` and a
      `$$ ... $$` block render as maths.
- [ ] ⋯ menu → **Export HTML…** writes a file that opens on its own in a
      browser with the network off, with diagrams, maths and images intact.
- [ ] ⋯ menu → **Print…** shows only the document; choosing *Microsoft Print
      to PDF* produces a PDF.

App comfort

- [ ] Open a folder and two files, quit, relaunch: the same tabs, folder and
      sidebar come back.
- [ ] Sidebar right-click → **New file** creates a file and opens it in
      Edit mode; **New folder** creates a folder.
- [ ] **Rename** of a file that is open in a tab updates the tab's name and
      keeps any unsaved text.
- [ ] **Delete** asks `Move <name> to the Recycle Bin?` and the file is in
      the Windows Recycle Bin afterwards.
- [ ] **Show in Explorer** opens Explorer with the file selected.
- [ ] ⋯ menu → **About Folio** shows version 0.3.0.

Auto-update (after the one-time setup in `docs/updater-setup.md` and a
published `v0.3.0` release)

- [ ] Install 0.3.0 from the published release.
- [ ] Push a test tag `v0.3.1`, wait for CI, and publish that release.
- [ ] Relaunch 0.3.0: within about 10 seconds a banner
      `Folio 0.3.1 is available.` appears. **Install and restart**
      downloads it, asks about any unsaved work, restarts, and ⋯ → **About
      Folio** shows 0.3.1.
- [ ] ⋯ → **Check for updates…** on 0.3.1 says `Folio is up to date.`
