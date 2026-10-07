// Folder sidebar: renders a list_tree result into a container. Pure with
// respect to app state: it takes the data and callbacks, builds the DOM, and
// reports clicks; the caller owns `expanded` and re-renders.
//
// Rows are buttons (keyboard reachable); Up/Down move between rows,
// Right/Left expand/collapse a folder. Only expanded folders' children are
// built, so a big collapsed tree stays cheap.
import { normalizePath } from './tabs.js';

export const TRUNCATED_NOTICE = 'Folder too large — showing first 5000 items';

export function renderTree(container, root, { activePath, expanded, truncated, onOpen, onToggle }) {
  const d = container.ownerDocument;
  const active = activePath != null ? normalizePath(activePath) : null;

  // A rebuild must not lose the user's place: keep the scroll position and
  // the focused row.
  const oldScroll = container.querySelector('.tree-scroll');
  const scrollTop = oldScroll ? oldScroll.scrollTop : 0;
  const focused = container.contains(d.activeElement) ? d.activeElement?.dataset?.path : undefined;

  const header = d.createElement('div');
  header.className = 'sidebar-header';
  const title = d.createElement('span');
  title.className = 'sidebar-title';
  title.textContent = root.name;
  title.title = root.path;
  header.append(title);

  const scroll = d.createElement('div');
  scroll.className = 'tree-scroll';
  const list = d.createElement('ul');
  list.className = 'tree';
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', root.name);
  addChildren(list, root.children || [], 0);
  scroll.append(list);

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
  if (focused) {
    for (const row of scroll.querySelectorAll('.tree-row')) {
      if (row.dataset.path === focused) {
        row.focus({ preventScroll: true });
        break;
      }
    }
  }

  function addChildren(ul, nodes, depth) {
    for (const node of nodes) {
      const li = d.createElement('li');
      li.setAttribute('role', 'none');
      const row = d.createElement('button');
      row.type = 'button';
      row.className = `tree-row tree-${node.kind === 'dir' ? 'dir' : 'file'}`;
      row.setAttribute('role', 'treeitem');
      row.dataset.path = node.path;
      row.title = node.path;
      row.style.setProperty('--depth', String(depth));
      const label = d.createElement('span');
      label.className = 'tree-name';
      label.textContent = node.name;
      if (node.kind === 'dir') {
        const open = expanded.has(node.path);
        row.setAttribute('aria-expanded', String(open));
        const twisty = d.createElement('span');
        twisty.className = 'tree-twisty';
        twisty.setAttribute('aria-hidden', 'true');
        row.append(twisty, label);
        row.addEventListener('click', () => onToggle(node.path));
        li.append(row);
        if (open) {
          const sub = d.createElement('ul');
          sub.setAttribute('role', 'group');
          addChildren(sub, node.children || [], depth + 1);
          li.append(sub);
        }
      } else {
        if (active != null && normalizePath(node.path) === active) {
          row.classList.add('active');
          row.setAttribute('aria-current', 'page');
        }
        row.append(label);
        row.addEventListener('click', () => onOpen(node.path));
        li.append(row);
      }
      ul.append(li);
    }
  }

  scroll.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('.tree-row');
    if (!row || e.ctrlKey || e.altKey || e.metaKey) return;
    const rows = [...scroll.querySelectorAll('.tree-row')];
    const i = rows.indexOf(row);
    const isDir = row.hasAttribute('aria-expanded');
    const open = row.getAttribute('aria-expanded') === 'true';
    let next = null;
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
