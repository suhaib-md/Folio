// Outline panel: renders buildOutline() nodes into a container. Like
// renderTree it takes data + callbacks, builds the DOM and reports clicks; the
// caller owns `current` and `collapsed` (node indexes) and re-renders.
//
// Each heading is a button (keyboard reachable); Up/Down move between the
// visible ones, Right/Left expand/collapse a heading that has sub-headings.

export const EMPTY_OUTLINE = 'No headings';

export function renderOutline(container, outline, { current = -1, collapsed, onJump, onToggle }) {
  const d = container.ownerDocument;
  // A rebuild must not lose the user's place: keep scroll and focused item.
  const scrollTop = container.scrollTop;
  const focused = container.contains(d.activeElement) ? d.activeElement?.dataset?.index : undefined;

  if (!outline.length) {
    const empty = d.createElement('p');
    empty.className = 'sidebar-empty-text';
    empty.textContent = EMPTY_OUTLINE;
    container.replaceChildren(empty);
    return;
  }

  const list = d.createElement('ul');
  list.className = 'outline';
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Outline');
  addNodes(list, outline, 1);
  container.replaceChildren(list);
  container.scrollTop = scrollTop;
  if (focused !== undefined) {
    list.querySelector(`.outline-item[data-index="${focused}"]`)?.focus({ preventScroll: true });
  }

  function addNodes(ul, nodes, depth) {
    for (const node of nodes) {
      const li = d.createElement('li');
      li.setAttribute('role', 'none');
      const row = d.createElement('div');
      row.className = 'outline-row';
      row.style.setProperty('--depth', String(node.level - 1));

      const parent = node.children.length > 0;
      const open = parent && !collapsed.has(node.index);
      const twisty = d.createElement('button');
      twisty.type = 'button';
      twisty.className = 'outline-twisty';
      twisty.tabIndex = -1;
      if (parent) {
        twisty.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${node.text}`);
        twisty.setAttribute('aria-expanded', String(open));
        twisty.addEventListener('click', () => onToggle(node.index));
      } else {
        twisty.disabled = true;
        twisty.setAttribute('aria-hidden', 'true');
      }

      const item = d.createElement('button');
      item.type = 'button';
      item.className = 'outline-item';
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-level', String(depth));
      item.dataset.index = String(node.index);
      item.title = node.text;
      item.textContent = node.text;
      if (parent) item.setAttribute('aria-expanded', String(open));
      if (node.index === current) {
        item.classList.add('active');
        item.setAttribute('aria-current', 'location');
      }
      item.addEventListener('click', () => onJump(node));
      row.append(twisty, item);
      li.append(row);
      if (open) {
        const sub = d.createElement('ul');
        sub.setAttribute('role', 'group');
        addNodes(sub, node.children, depth + 1);
        li.append(sub);
      }
      ul.append(li);
    }
  }

  list.addEventListener('keydown', (e) => {
    const item = e.target.closest?.('.outline-item');
    if (!item || e.ctrlKey || e.altKey || e.metaKey) return;
    const items = [...list.querySelectorAll('.outline-item')];
    const i = items.indexOf(item);
    const parent = item.hasAttribute('aria-expanded');
    const open = item.getAttribute('aria-expanded') === 'true';
    const index = Number(item.dataset.index);
    let next = null;
    if (e.key === 'ArrowDown') next = items[i + 1];
    else if (e.key === 'ArrowUp') next = items[i - 1];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if (e.key === 'ArrowRight' && parent && !open) onToggle(index);
    else if (e.key === 'ArrowLeft' && parent && open) onToggle(index);
    else return;
    e.preventDefault();
    next?.focus();
  });
}
