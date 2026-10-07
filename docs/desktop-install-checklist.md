# Folio desktop: install checklist

Manual checks that can't be automated in CI. Run on Windows after each
installer build.

## Install

- [ ] Download the `Folio-installer` artifact from the latest Actions run
      (or the Release asset) and unzip it.
- [ ] Run `Folio_0.2.0_x64-setup.exe`. No admin prompt appears. If
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
