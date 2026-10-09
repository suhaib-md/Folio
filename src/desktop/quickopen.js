// Quick open (Ctrl+P): a modal palette over the app.
//
// openQuickOpen({ files, recentPaths, onPick(path) }) -> { close() }
// files: { path, rel, name }[] (see fuzzy.js). Up/Down select, Enter picks,
// Esc or a click outside closes; hovering selects, clicking picks. Focus
// returns to where it was. While open the app is inert and the modal hooks
// fire, so incoming file opens wait and app shortcuts are blocked.
import { rankFiles, displayParts } from './fuzzy.js';
import { modalOpened, modalClosed } from './modal.js';

const MAX_ROWS = 50;
let seq = 0;
let active = null;

// Text with `positions` (indices into it) wrapped in <b>, built from DOM nodes.
function highlight(d, parent, text, positions) {
  const set = new Set(positions);
  let run = '';
  let bold = false;
  const flush = () => {
    if (!run) return;
    if (bold) {
      const b = d.createElement('b');
      b.textContent = run;
      parent.append(b);
    } else {
      parent.append(d.createTextNode(run));
    }
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    if (hit !== bold) {
      flush();
      bold = hit;
    }
    run += text[i];
  }
  flush();
}

export function openQuickOpen({ files, recentPaths = [], onPick }) {
  if (active) return active;
  const d = document;
  const id = ++seq;
  const previous = d.activeElement;
  const app = d.querySelector('.app');

  const backdrop = d.createElement('div');
  backdrop.className = 'modal-backdrop quickopen-backdrop';
  const dialog = d.createElement('div');
  dialog.className = 'quickopen';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Quick open');

  const input = d.createElement('input');
  input.type = 'text';
  input.className = 'quickopen-input';
  input.placeholder = 'Go to file…';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', 'Go to file');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', `quickopen-list-${id}`);

  const list = d.createElement('ul');
  list.className = 'quickopen-list';
  list.id = `quickopen-list-${id}`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Files');

  const empty = d.createElement('div');
  empty.className = 'quickopen-empty';
  empty.setAttribute('role', 'status');

  dialog.append(input, list, empty);
  backdrop.append(dialog);

  let results = [];
  let rows = [];
  let selected = 0;

  function select(i, { scroll = true } = {}) {
    if (!rows.length) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    selected = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((row, j) => {
      const on = j === selected;
      row.classList.toggle('selected', on);
      row.setAttribute('aria-selected', String(on));
    });
    input.setAttribute('aria-activedescendant', rows[selected].id);
    if (scroll) rows[selected].scrollIntoView?.({ block: 'nearest' });
  }

  function render() {
    results = rankFiles(input.value, files, recentPaths, MAX_ROWS);
    list.textContent = '';
    rows = results.map((item, i) => {
      const li = d.createElement('li');
      li.id = `quickopen-opt-${id}-${i}`;
      li.className = 'quickopen-row';
      li.setAttribute('role', 'option');
      li.title = item.file.path;
      const parts = displayParts(item.file, item.positions, item.inName);
      const name = d.createElement('span');
      name.className = 'quickopen-name';
      highlight(d, name, item.file.name, parts.namePositions);
      li.append(name);
      if (parts.folder) {
        const folder = d.createElement('span');
        folder.className = 'quickopen-folder';
        highlight(d, folder, parts.folder, parts.folderPositions);
        li.append(folder);
      }
      li.addEventListener('mousemove', () => {
        if (selected !== i) select(i, { scroll: false });
      });
      li.addEventListener('click', () => pick(i));
      return li;
    });
    list.append(...rows);
    list.hidden = !rows.length;
    empty.hidden = rows.length > 0;
    empty.textContent = files.length ? 'No matching files' : 'No files';
    select(0);
    list.scrollTop = 0;
  }

  function pick(i) {
    const item = results[i];
    if (!item) return;
    const path = item.file.path;
    close();
    onPick(path);
  }

  function onKey(e) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      select(selected + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      select(selected - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(selected);
    } else if (e.key === 'Tab') {
      e.preventDefault(); // the input is the only stop
    }
    e.stopPropagation(); // nothing behind the palette sees its keys
  }

  // Click outside the dialog closes; clicks inside must not steal focus from
  // the input.
  function onMouseDown(e) {
    if (!dialog.contains(e.target)) {
      e.preventDefault();
      close();
    } else if (e.target !== input) {
      e.preventDefault();
    }
  }

  function onFocusOut(e) {
    if (!e.relatedTarget || !dialog.contains(e.relatedTarget)) {
      queueMicrotask(() => {
        if (backdrop.isConnected && !dialog.contains(d.activeElement)) input.focus();
      });
    }
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    active = null;
    backdrop.remove();
    if (app) app.inert = false;
    if (previous && previous.isConnected && typeof previous.focus === 'function') {
      previous.focus({ preventScroll: true });
    }
    modalClosed();
  }

  input.addEventListener('input', render);
  backdrop.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', onMouseDown);
  dialog.addEventListener('focusout', onFocusOut);

  modalOpened();
  if (app) app.inert = true;
  d.body.append(backdrop);
  render();
  input.focus();
  active = { close };
  return active;
}
