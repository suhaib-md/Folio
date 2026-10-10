// Folder sidebar: renders a list_tree result into a container. Pure with
// respect to app state: it takes the data and callbacks, builds the DOM, and
// reports clicks; the caller owns `expanded` and re-renders. `expanded` holds
// normalizePath() keys, so case and separator differences still match;
// onToggle/onOpen get the node's own path.
//
// Rows are buttons (keyboard reachable); Up/Down move between rows,
// Right/Left expand/collapse a folder. Only expanded folders' children are
// built, so a big collapsed tree stays cheap.
//
// File operations (all optional callbacks): onContextMenu(node, x, y, anchor)
// for a right-click, Shift+F10 / the ContextMenu key and the row's "..."
// button (empty space in the tree: the root node); onRename(node) on F2,
// onDelete(node) on Delete; onNew('file' | 'dir', parentPath) from the header
// buttons. `editing` shows an inline name input: { parent, kind: 'file' |
// 'dir' | 'rename', path?, initial, error? }. A new item's input is the
// first child of `parent` (the caller expands it); a rename's replaces the
// row at `path`. Enter -> onCommit(name), Esc -> onCancel(), blur ->
// onCommit(name, { fromBlur: true }) once. A re-render keeps what was typed.
// `dirtyPaths` (normalizePath() keys) marks files with unsaved edits.
import { normalizePath } from './tabs.js';

export const TRUNCATED_NOTICE = 'Folder too large — showing first 5000 items';

const sameKey = (a, b) => a != null && b != null && normalizePath(a) === normalizePath(b);
const retired = new WeakSet(); // inputs removed by a re-render: their blur is not the user's

const MORE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="13" cy="8" r="1.3" fill="currentColor"/></svg>';
const NEW_FILE_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5 M8 8v4 M6 10h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
const NEW_FOLDER_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z M8 7.5v4 M6 9.5h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

export function renderTree(container, root, {
  activePath, expanded, truncated, onOpen, onToggle, dirtyPaths = null,
  onContextMenu, onRename, onDelete, onNew, editing = null, onCommit, onCancel,
}) {
  const d = container.ownerDocument;
  const active = activePath != null ? normalizePath(activePath) : null;

  // A rebuild must not lose the user's place: keep the scroll position and
  // the focused row.
  const oldScroll = container.querySelector('.tree-scroll');
  const scrollTop = oldScroll ? oldScroll.scrollTop : 0;
  const focused = container.contains(d.activeElement) ? d.activeElement?.dataset?.path : undefined;
  // An open name input: what was typed (and whether it had focus) survives
  // a re-render of the same edit.
  const editKey = editing ? `${editing.kind}|${editing.path ?? editing.parent}` : null;
  const oldInput = container.querySelector('input.tree-input');
  const carry = oldInput && editKey && oldInput.dataset.key === editKey
    ? { value: oldInput.value, start: oldInput.selectionStart, end: oldInput.selectionEnd, focus: d.activeElement === oldInput }
    : null;
  if (oldInput) retired.add(oldInput);
  const nodeOf = new WeakMap(); // row element -> its tree node

  const header = d.createElement('div');
  header.className = 'sidebar-header';
  const title = d.createElement('span');
  title.className = 'sidebar-title';
  title.textContent = root.name;
  title.title = root.path;
  header.append(title);
  if (onNew) {
    for (const [kind, cls, label, icon] of [
      ['file', 'sidebar-new-file', 'New file', NEW_FILE_ICON],
      ['dir', 'sidebar-new-folder', 'New folder', NEW_FOLDER_ICON],
    ]) {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = `icon-btn sidebar-new ${cls}`;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = icon;
      b.addEventListener('click', () => onNew(kind, root.path));
      header.append(b);
    }
  }

  const scroll = d.createElement('div');
  scroll.className = 'tree-scroll';
  const list = d.createElement('ul');
  list.className = 'tree';
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', root.name);
  if (editing && editing.kind !== 'rename' && sameKey(editing.parent, root.path)) list.append(editRow(0));
  addChildren(list, root.children || [], 0);
  scroll.append(list);
  scroll.addEventListener('contextmenu', (e) => {
    if (!onContextMenu || e.target.closest('.tree-edit, .tree-more')) return;
    const row = e.target.closest('.tree-row');
    e.preventDefault();
    onContextMenu(row ? nodeOf.get(row) : root, e.clientX, e.clientY, row || scroll);
  });

  const parts = [header];
  if (truncated) {
    const notice = d.createElement('div');
    notice.className = 'sidebar-notice';
    notice.textContent = TRUNCATED_NOTICE;
    parts.push(notice);
  }
  parts.push(scroll);
  container.replaceChildren(...parts);
  scroll.scrollTop = scrollTop;
  if (editing) {
    const input = scroll.querySelector('input.tree-input');
    if (input && (!carry || carry.focus)) {
      input.focus({ preventScroll: false });
      if (carry) input.setSelectionRange(carry.start, carry.end);
      else input.setSelectionRange(0, selectEnd(editing));
    }
  } else if (focused) {
    for (const row of scroll.querySelectorAll('.tree-row')) {
      if (row.dataset.path === focused) {
        row.focus({ preventScroll: true });
        break;
      }
    }
  }

  function selectEnd(e) {
    const text = e.initial || '';
    const dot = text.lastIndexOf('.');
    return e.kind === 'rename' && !e.isDir && dot > 0 ? dot : text.length;
  }

  // The inline name input, as a tree row (never a button: it holds an input).
  function editRow(depth) {
    const li = d.createElement('li');
    li.setAttribute('role', 'none');
    const isDir = editing.kind === 'dir' || (editing.kind === 'rename' && editing.isDir);
    const row = d.createElement('div');
    row.className = `tree-row tree-edit tree-${isDir ? 'dir' : 'file'}`;
    row.style.setProperty('--depth', String(depth));
    if (isDir) {
      const twisty = d.createElement('span');
      twisty.className = 'tree-twisty';
      twisty.setAttribute('aria-hidden', 'true');
      row.append(twisty);
    }
    const input = d.createElement('input');
    input.type = 'text';
    input.className = 'tree-input';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.dataset.key = editKey;
    input.value = carry ? carry.value : editing.initial || '';
    input.setAttribute('aria-label', editing.kind === 'rename'
      ? `Rename ${editing.initial}`
      : `New ${isDir ? 'folder' : 'file'} name`);
    let finished = false;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        onCommit?.(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finished = true;
        onCancel?.();
      }
    });
    input.addEventListener('blur', () => {
      if (finished || retired.has(input)) return;
      finished = true;
      onCommit?.(input.value, { fromBlur: true });
    });
    row.append(input);
    li.append(row);
    if (editing.error) {
      input.setAttribute('aria-invalid', 'true');
      const err = d.createElement('div');
      err.className = 'tree-error';
      err.setAttribute('role', 'alert');
      err.style.setProperty('--depth', String(depth));
      err.textContent = editing.error;
      li.append(err);
    }
    return li;
  }

  function addChildren(ul, nodes, depth) {
    for (const node of nodes) {
      if (editing?.kind === 'rename' && sameKey(editing.path, node.path)) {
        ul.append(editRow(depth));
        continue;
      }
      const li = d.createElement('li');
      li.setAttribute('role', 'none');
      const row = d.createElement('button');
      row.type = 'button';
      row.className = `tree-row tree-${node.kind === 'dir' ? 'dir' : 'file'}`;
      row.setAttribute('role', 'treeitem');
      row.dataset.path = node.path;
      nodeOf.set(row, node);
      row.title = node.path;
      row.style.setProperty('--depth', String(depth));
      const label = d.createElement('span');
      label.className = 'tree-name';
      label.textContent = node.name;
      if (node.kind === 'dir') {
        const open = expanded.has(normalizePath(node.path));
        row.setAttribute('aria-expanded', String(open));
        const twisty = d.createElement('span');
        twisty.className = 'tree-twisty';
        twisty.setAttribute('aria-hidden', 'true');
        row.append(twisty, label);
        row.addEventListener('click', () => onToggle(node.path));
        li.append(row);
        addMore(li, node, row);
        if (open) {
          const sub = d.createElement('ul');
          sub.setAttribute('role', 'group');
          if (editing && editing.kind !== 'rename' && sameKey(editing.parent, node.path)) sub.append(editRow(depth + 1));
          addChildren(sub, node.children || [], depth + 1);
          li.append(sub);
        }
      } else {
        if (active != null && normalizePath(node.path) === active) {
          row.classList.add('active');
          row.setAttribute('aria-current', 'page');
        }
        row.append(label);
        if (dirtyPaths?.has(normalizePath(node.path))) {
          const dot = d.createElement('span');
          dot.className = 'tree-dirty';
          dot.textContent = '●';
          dot.setAttribute('aria-label', 'unsaved changes');
          row.append(dot);
        }
        row.addEventListener('click', () => onOpen(node.path));
        li.append(row);
        addMore(li, node, row);
      }
      ul.append(li);
    }
  }

  // The hover "..." button: a sibling of the row (a button can't hold one).
  function addMore(li, node, row) {
    if (!onContextMenu) return;
    const more = d.createElement('button');
    more.type = 'button';
    more.className = 'tree-more';
    more.tabIndex = -1; // keyboard users have Shift+F10
    more.title = 'More actions';
    more.setAttribute('aria-label', `More actions for ${node.name}`);
    more.innerHTML = MORE_ICON;
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = more.getBoundingClientRect();
      onContextMenu(node, r.right, r.bottom, row);
    });
    li.append(more);
  }

  scroll.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('.tree-row');
    if (!row || row.classList.contains('tree-edit') || e.ctrlKey || e.altKey || e.metaKey) return;
    const rows = [...scroll.querySelectorAll('.tree-row')];
    const i = rows.indexOf(row);
    const isDir = row.hasAttribute('aria-expanded');
    const open = row.getAttribute('aria-expanded') === 'true';
    let next = null;
    const node = nodeOf.get(row);
    if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && onContextMenu) {
      e.preventDefault();
      const r = row.getBoundingClientRect();
      onContextMenu(node, r.left + 24, r.bottom, row);
      return;
    }
    if (e.key === 'F2' && onRename && !e.shiftKey) {
      e.preventDefault();
      onRename(node);
      return;
    }
    if (e.key === 'Delete' && onDelete && !e.shiftKey) {
      e.preventDefault();
      onDelete(node);
      return;
    }
    if (e.key === 'ArrowDown') next = rows[i + 1];
    else if (e.key === 'ArrowUp') next = rows[i - 1];
    else if (e.key === 'Home') next = rows[0];
    else if (e.key === 'End') next = rows[rows.length - 1];
    else if (e.key === 'ArrowRight' && isDir && !open) onToggle(row.dataset.path);
    else if (e.key === 'ArrowLeft' && isDir && open) onToggle(row.dataset.path);
    else return;
    e.preventDefault();
    next?.focus();
  });
}
