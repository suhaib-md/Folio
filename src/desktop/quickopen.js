// The palette (Ctrl+P): quick open and commands in one modal over the app.
//
// openQuickOpen({ files, recentPaths, onPick(path, { newTab }), commands,
//   startInCommands, scope }) -> { close() }
// files: { path, rel, name }[] (see fuzzy.js). commands: { label, group,
// key, run() }[], in the order they list for an empty query. Typing ">"
// first switches to commands (Backspace on the empty query switches back);
// startInCommands opens there (Ctrl+Shift+P). Up/Down select, Enter picks
// (Ctrl+Enter: a file opens in a new tab), Esc or a click outside closes;
// hovering selects, clicking picks. Focus returns to where it was. While
// open the app is inert and the modal hooks fire, so incoming file opens
// wait and app shortcuts are blocked.
import { createRanker, displayParts, fuzzyMatch } from './fuzzy.js';
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

export function openQuickOpen({
  files, recentPaths = [], onPick, commands = [], startInCommands = false, scope = '',
}) {
  if (active) return active;
  const d = document;
  const id = ++seq;
  const previous = d.activeElement;
  const app = d.querySelector('.app');
  const el = (tag, className, text) => {
    const e = d.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };

  const backdrop = el('div', 'modal-backdrop quickopen-backdrop');
  const dialog = el('div', 'quickopen');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Quick open');

  const headRow = el('div', 'quickopen-head');
  const prefix = el('span', 'quickopen-prefix', '>');
  prefix.setAttribute('aria-hidden', 'true');
  const input = el('input', 'quickopen-input');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', `quickopen-list-${id}`);
  const hint = el('span', 'quickopen-hint');
  headRow.append(prefix, input, hint);

  const bodyEl = el('div', 'quickopen-body');
  const group = el('div', 'quickopen-group');
  group.id = `quickopen-group-${id}`;
  const list = el('ul', 'quickopen-list');
  list.id = `quickopen-list-${id}`;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-labelledby', group.id);
  const empty = el('div', 'quickopen-empty');
  empty.setAttribute('role', 'status');
  bodyEl.append(group, list, empty);

  const foot = el('div', 'quickopen-foot');
  const footMode = el('span', '');
  foot.append(
    el('span', '', '↑↓ to move'),
    el('span', '', 'Enter to open'),
    el('span', '', 'Ctrl Enter opens in a new tab'),
    el('span', 'spacer'),
    footMode,
  );

  dialog.append(headRow, bodyEl, foot);
  backdrop.append(dialog);

  const rank = createRanker(files, recentPaths);
  let inCommands = !!startInCommands;
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

  // Commands matching the query, best first (registry order when tied or
  // when the query is empty).
  function rankCommands(query) {
    const q = query.trim();
    const out = [];
    commands.forEach((cmd, order) => {
      const m = q ? fuzzyMatch(q, cmd.label) : { score: 0, positions: [] };
      if (m) out.push({ cmd, positions: m.positions, score: m.score, order });
    });
    if (q) out.sort((a, b) => b.score - a.score || a.order - b.order);
    return out.slice(0, MAX_ROWS);
  }

  function row(i, nameText, namePositions, meta, metaPositions, key, title) {
    const li = el('li', 'quickopen-row');
    li.id = `quickopen-opt-${id}-${i}`;
    li.setAttribute('role', 'option');
    if (title) li.title = title;
    const name = el('span', 'quickopen-name');
    highlight(d, name, nameText, namePositions);
    li.append(name);
    const folder = el('span', 'quickopen-folder');
    if (meta) highlight(d, folder, meta, metaPositions);
    li.append(folder);
    if (key) li.append(el('span', 'quickopen-key', key));
    li.addEventListener('mousemove', () => {
      if (selected !== i) select(i, { scroll: false });
    });
    li.addEventListener('click', (e) => pick(i, { newTab: e.ctrlKey || e.metaKey }));
    return li;
  }

  function render() {
    prefix.hidden = !inCommands;
    input.placeholder = inCommands ? 'Run a command…' : 'Go to file…';
    input.setAttribute('aria-label', inCommands ? 'Run a command' : 'Go to file');
    hint.textContent = inCommands ? 'Commands' : scope ? `Files in ${scope}` : 'Open files';
    group.textContent = inCommands ? 'Commands' : 'Files';
    footMode.textContent = inCommands ? 'Delete > for files' : 'Type > for commands';
    list.textContent = '';
    if (inCommands) {
      results = rankCommands(input.value);
      rows = results.map((r, i) => row(i, r.cmd.label, r.positions, r.cmd.group || '', [], r.cmd.key || ''));
    } else {
      results = rank(input.value, MAX_ROWS);
      rows = results.map((item, i) => {
        const parts = displayParts(item.file, item.positions, item.inName);
        return row(i, item.file.name, parts.namePositions, parts.folder, parts.folderPositions, '', item.file.path);
      });
    }
    list.append(...rows);
    list.hidden = !rows.length;
    empty.hidden = rows.length > 0;
    empty.textContent = inCommands
      ? 'No matching commands'
      : files.length ? 'No matching files' : 'No files';
    select(0);
    bodyEl.scrollTop = 0;
  }

  function pick(i, { newTab = false } = {}) {
    const item = results[i];
    if (!item) return;
    close();
    if (inCommands) item.cmd.run();
    else onPick(item.file.path, { newTab });
  }

  function setMode(commandsMode) {
    inCommands = commandsMode;
    render();
  }

  function onInput() {
    if (!inCommands && input.value.startsWith('>')) {
      input.value = input.value.slice(1).trimStart();
      setMode(true);
      return;
    }
    render();
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
      pick(selected, { newTab: e.ctrlKey || e.metaKey });
    } else if (e.key === 'Backspace' && inCommands && input.value === '') {
      e.preventDefault();
      setMode(false);
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
  let opened = false;
  function close() {
    if (closed) return;
    closed = true;
    active = null;
    backdrop.remove();
    if (app) app.inert = false;
    if (previous && previous.isConnected && typeof previous.focus === 'function') {
      previous.focus({ preventScroll: true });
    }
    if (opened) modalClosed();
  }

  input.addEventListener('input', onInput);
  backdrop.addEventListener('keydown', onKey);
  backdrop.addEventListener('mousedown', onMouseDown);
  dialog.addEventListener('focusout', onFocusOut);

  // Build everything first: if rendering throws, nothing global has changed.
  render();
  active = { close };
  try {
    modalOpened();
    opened = true;
    if (app) app.inert = true;
    d.body.append(backdrop);
    input.focus();
  } catch (err) {
    close();
    throw err;
  }
  return active;
}
